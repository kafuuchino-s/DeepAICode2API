// Browser regression test for the in-memory fixture. Run with ?lang=en#accounts?group=alpha&page=1.
type Request = { method: string; url: string; body: Record<string, unknown> };
type Fixture = {
  requests: Request[];
  accounts: { id: string; group: string; enabled: boolean; failures: number; email_verified: boolean; has_machine: boolean; proxy: string }[];
  keys: { key: string; group: string; enabled: boolean }[];
  pollInFlight: boolean;
  callbackOverlapped: boolean;
  failNext: string;
  checkinSequence: object[];
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function waitFor<T>(message: string, fn: () => T, timeout = 5000): Promise<NonNullable<T>> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = fn();
    if (value) return value as NonNullable<T>;
    await pause(25);
  }
  throw new Error(`Timed out: ${message}`);
}
function button(text: string, parent: ParentNode = document): HTMLButtonElement {
  const found = [...parent.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);
  assert(found, `Button missing: ${text}`);
  return found;
}
function control(label: string): HTMLInputElement | HTMLSelectElement {
  const parent = [...document.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith(label));
  const found = parent?.querySelector('input, select');
  assert(found instanceof HTMLInputElement || found instanceof HTMLSelectElement, `Control missing: ${label}`);
  return found;
}
function inputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
function selectValue(element: HTMLSelectElement, value: string) { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); }
function shownDialog(): HTMLDialogElement | null { return document.querySelector('dialog[open]'); }
function assertReadableButton(element: HTMLButtonElement) {
  const style = getComputedStyle(element);
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    assert(channels?.length === 3, `Cannot inspect button color: ${color}`);
    const linear = channels.map((channel) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const foreground = luminance(style.color); const background = luminance(style.backgroundColor);
  const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  assert(ratio >= 4.5, `Primary button contrast is too low: ${ratio.toFixed(2)}`);
}
function assertCenteredDialog(dialog: HTMLDialogElement) {
  const rect = dialog.getBoundingClientRect();
  assert(Math.abs(rect.top - (innerHeight - rect.bottom)) < 2, 'Dialog is not vertically centered');
}
async function openAccount(key: string) {
  const row = [...document.querySelectorAll('table tbody tr')].find((item) => item.textContent?.includes(key));
  assert(row, `Account row missing: ${key}`);
  const trigger = row.querySelector('button'); assert(trigger, 'Account action trigger missing'); trigger.click();
  return waitFor('account dialog', shownDialog);
}
async function openKey(key: string) {
  const row = [...document.querySelectorAll('table tbody tr')].find((item) => item.textContent?.includes(key));
  assert(row, `Key row missing: ${key}`);
  const trigger = row.querySelector('button'); assert(trigger, 'Key action trigger missing'); trigger.click();
  return waitFor('key dialog', shownDialog);
}
async function dialogClosed() { await waitFor('dialog to close', () => !shownDialog()); }
async function navigate(hash: string, heading: string) {
  location.hash = hash;
  await waitFor(heading, () => [...document.querySelectorAll('h1')].some((item) => item.textContent === heading));
}

export async function runFixtureTests(): Promise<string[]> {
  const qa = (window as unknown as { qa: Fixture }).qa;
  const passed: string[] = [];
  const originalConfirm = window.confirm;
  const originalOpen = window.open;
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalExecCommand = document.execCommand;
  try {
    await waitFor('deep-linked account page', () => qa.requests.some((item) => item.url.includes('offset=20&limit=20&group=alpha')) && document.querySelector('table tbody tr'));
    assert(location.hash === '#accounts?group=alpha&page=1', 'Account deep link was not preserved');
    assert(document.body.textContent?.includes('person21@example.test'), 'Deep link did not show expected account');
    const summary = await waitFor('account summary', () => {
      const section = document.querySelector('[aria-label="Account summary"]');
      return section?.textContent?.includes('43') && section.textContent.includes('42') && section.textContent.includes('21') ? section : null;
    });
    assert(summary.textContent?.includes('Not ready') && summary.textContent.includes('Matching accounts'), 'Account summary did not use the overview and filtered totals');
    (control('Mask identities') as HTMLInputElement).click();
    assert(localStorage.getItem('deepaicode2api_acct_mask') === '1', 'Mask preference was not stored');
    await waitFor('masked identity', () => document.body.textContent?.includes('p***@example.test'));
    selectValue(control('Per page') as HTMLSelectElement, '50');
    await waitFor('page size update', () => qa.requests.some((item) => item.url.includes('offset=0&limit=50&group=alpha')));
    assert(localStorage.getItem('deepaicode2api_acct_page_size') === '50' && !location.hash.includes('page='), 'Page size or page reset was not saved');
    passed.push('deep link, pagination and mask preferences');

    button('Clear filters').click();
    await waitFor('filter reset', () => location.hash === '#accounts' && qa.requests.some((item) => item.url === '/admin/api/accounts?offset=0&limit=50'));
    button('Failures').click();
    await waitFor('ascending account sort', () => qa.requests.some((item) => item.url.includes('sort=failures&order=asc')));
    button('Failures').click();
    await waitFor('descending account sort', () => qa.requests.some((item) => item.url.includes('sort=failures&order=desc')));
    selectValue(control('Status') as HTMLSelectElement, 'error');
    await waitFor('status filter', () => qa.requests.some((item) => item.url.includes('status=error')) && document.body.textContent?.includes('sk-acct...0'));
    let dialog = await openAccount('sk-acct...0');
    assertCenteredDialog(dialog);
    qa.failNext = '/admin/api/accounts';
    button('Disable account', dialog).click();
    await waitFor('account action error', () => dialog.querySelector('[role=alert]')?.textContent?.includes('HTTP 503'));
    assert(qa.accounts[0].enabled, 'A failed action changed the account');
    button('Disable account', dialog).click();
    await dialogClosed();
    assert(!qa.accounts[0].enabled, 'Account was not disabled');
    dialog = await openAccount('sk-acct...0');
    button('Refresh quota', dialog).click();
    await dialogClosed();
    assert(qa.requests.some((item) => item.url === '/admin/api/checkin' && item.body.id === 'account-1'), 'Single-account quota request missing');
    dialog = await openAccount('sk-acct...0');
    button('Clear errors', dialog).click();
    await dialogClosed();
    assert(qa.accounts[0].failures === 0, 'Errors were not cleared');
    passed.push('status filtering, action errors, toggle, quota and clear errors');

    button('Clear filters').click();
    inputValue(control('Search') as HTMLInputElement, 'person2@example.test');
    await waitFor('search result', () => qa.requests.some((item) => item.url.includes('q=person2%40example.test')) && document.body.textContent?.includes('sk-acct...1'));
    const target = qa.accounts.find((item) => item.id === 'account-2')!;
    dialog = await openAccount('sk-acct...1');
    let confirms = 0;
    window.confirm = () => { confirms++; return false; };
    const count = qa.requests.length;
    button('Assign fingerprint', dialog).click();
    await pause(100);
    assert(confirms === 1 && qa.requests.length === count && !target.has_machine, 'Cancelled fingerprint action was executed');
    window.confirm = () => true;
    button('Assign fingerprint', dialog).click(); await dialogClosed(); assert(target.has_machine, 'Fingerprint was not assigned');
    dialog = await openAccount('sk-acct...1'); button('Assign proxy', dialog).click(); await dialogClosed(); assert(target.proxy, 'Proxy was not assigned');
    dialog = await openAccount('sk-acct...1'); button('Reassign proxy', dialog).click(); await dialogClosed();
    assert(qa.requests.some((item) => item.body.action === 'assign-proxy' && item.body.id === 'account-2' && item.body.reassign === true), 'Proxy reassignment request missing');
    dialog = await openAccount('sk-acct...1'); button('Clear proxy', dialog).click(); await dialogClosed(); assert(!target.proxy, 'Proxy was not cleared');
    dialog = await openAccount('sk-acct...1'); button('Mark verified', dialog).click(); await dialogClosed(); assert(target.email_verified, 'Verification flag was not saved');
    dialog = await openAccount('sk-acct...1'); button('Change group', dialog).click();
    const group = await waitFor('account group field', () => document.getElementById('account-new-group') as HTMLInputElement | null);
    inputValue(group, 'beta'); button('Save', dialog).click(); await dialogClosed(); assert(target.group === 'beta', 'Account group was not changed');
    dialog = await openAccount('sk-acct...1'); button('Delete account', dialog).click(); await dialogClosed();
    assert(!qa.accounts.includes(target), 'Account was not deleted');
    passed.push('sort, confirmation, fingerprint, proxy, verification, group and account deletion');

    assertReadableButton(button('Add account'));
    button('Add account').click();
    await waitFor('manual account form', () => document.querySelector('input[type=password]'));
    inputValue(control('Name (optional)') as HTMLInputElement, 'Fixture manual');
    inputValue(document.querySelector('input[type=password]') as HTMLInputElement, 'test-deepai-key');
    button('Add API key').click();
    await waitFor('manual account request', () => qa.requests.some((item) => item.body.action === 'manual' && item.body.api_key === 'test-deepai-key'));
    await waitFor('manual form closes', () => !document.querySelector('input[type=password]'));
    button('Import desktop').click();
    await waitFor('import result', () => document.body.textContent?.includes('Imported 1 account'));
    qa.checkinSequence.push({ probed: 2, remaining: 1, skipped: 0, results: [{ id: 'x', name: 'x', ok: true }] }, { probed: 1, remaining: 0, skipped: 0, results: [{ id: 'y', name: 'y', ok: false, err: 'fixture error' }] });
    const checkinsBefore = qa.requests.filter((item) => item.url === '/admin/api/checkin').length;
    button('Refresh all quotas').click();
    await waitFor('batch quota results', () => document.body.textContent?.includes('1 failed') && document.body.textContent?.includes('fixture error'));
    assert(qa.requests.filter((item) => item.url === '/admin/api/checkin').length === checkinsBefore + 2, 'Batch quota did not consume both pages');
    passed.push('manual add, import and multi-batch quota failure feedback');

    await navigate('#keys', 'API keys');
    await waitFor('legacy key', () => document.body.textContent?.includes('sk-leg...0001'));
    button('Name').click();
    await waitFor('key sorting', () => document.querySelector('table tbody tr')?.textContent?.includes('sk-def...0002'));
    dialog = await openKey('sk-leg...0001');
    assertCenteredDialog(dialog);
    assert(dialog.textContent?.includes('All groups (legacy key)') && dialog.textContent.includes('blank binds the key to the default group'), 'Legacy key scope or default guidance missing');
    button('Save', dialog).click(); await dialogClosed();
    assert(qa.keys[0].group === 'default' && qa.requests.some((item) => item.body.action === 'set-group' && item.body.group === ''), 'Blank legacy group did not become default');
    assertReadableButton(button('Create key'));
    button('Create key').click();
    let createDialog = await waitFor('key creation dialog', shownDialog);
    assert(createDialog.getAttribute('aria-labelledby') === 'create-key-title', 'Key creation did not open a dialog');
    assertCenteredDialog(createDialog);
    qa.failNext = '/admin/api/keys';
    button('Create', createDialog).click();
    await waitFor('key creation error in dialog', () => createDialog.querySelector('[role=alert]')?.textContent?.includes('HTTP 503'));
    button('Cancel', createDialog).click(); await dialogClosed();
    button('Create key').click();
    createDialog = await waitFor('key creation dialog reopened', shownDialog);
    await waitFor('key creation form', () => [...createDialog.querySelectorAll('label')].some((item) => item.textContent?.startsWith('Name (optional)')));
    inputValue(control('Name (optional)') as HTMLInputElement, 'Fixture key');
    button('Create', createDialog).click();
    const created = await waitFor('full key', () => document.getElementById('created-key') as HTMLInputElement | null);
    assert(created.value === 'sk-fixture-full-secret-for-test-0003', 'Full key was not displayed');
    assert(qa.keys.find((item) => item.key === 'sk-new...0003')?.group === 'default', 'Blank new group did not become default');
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
    button('Copy').click();
    await waitFor('key copied', () => copied === created.value && document.body.textContent?.includes('Key copied'));
    copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = (command: string) => { copied = (document.activeElement as HTMLInputElement).value; return command === 'copy'; };
    button('Copy').click();
    await waitFor('key copied on insecure origin', () => copied === created.value);
    const closeFullKey = document.querySelector<HTMLButtonElement>('button[aria-label="Close and clear the full key"]'); assert(closeFullKey, 'Full key close button missing'); closeFullKey.click();
    await waitFor('full key cleared', () => !document.getElementById('created-key'));
    dialog = await openKey('sk-new...0003'); button('Disable key', dialog).click(); await dialogClosed();
    assert(!qa.keys.find((item) => item.key === 'sk-new...0003')!.enabled, 'Key was not disabled');
    dialog = await openKey('sk-new...0003'); button('Delete key', dialog).click(); await dialogClosed();
    assert(!qa.keys.some((item) => item.key === 'sk-new...0003'), 'Key was not deleted');
    passed.push('legacy/default key scope, one-time creation, toggle and delete');

    await navigate('#accounts', 'Accounts');
    window.open = (() => ({ opener: null, location: { replace() {} }, close() {} })) as unknown as typeof window.open;
    button('Browser sign-in').click();
    const callback = await waitFor('OAuth callback field', () => document.getElementById('oauth-callback') as HTMLTextAreaElement | null);
    copied = '';
    button('Copy link').click();
    await waitFor('OAuth link copied on insecure origin', () => copied.includes('/login/open?id=test-session'));
    inputValue(callback, 'http://127.0.0.1:34105/auth-callback?code=fixture&state=fixture');
    await waitFor('in-flight OAuth poll', () => qa.pollInFlight);
    button('Submit callback URL').click();
    await waitFor('OAuth completion', () => qa.requests.some((item) => item.url === '/admin/api/login/callback'));
    await waitFor('OAuth success message', () => document.body.textContent?.includes('Signed in successfully'));
    assert(!qa.callbackOverlapped, 'OAuth callback raced the in-flight poll');
    passed.push('OAuth callback waits for in-flight polling');
    return passed;
  } finally {
    window.confirm = originalConfirm;
    window.open = originalOpen;
    document.execCommand = originalExecCommand;
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard); else Reflect.deleteProperty(navigator, 'clipboard');
  }
}
