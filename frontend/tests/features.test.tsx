import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { api } from '../src/lib/api';
import { I18nProvider, useI18n } from '../src/lib/i18n';
import { formatTime } from '../src/features/accounts/account-utils';
import AccountsPage from '../src/features/accounts/AccountsPage';
import ModelsPage from '../src/features/models/ModelsPage';
import LogsPage from '../src/features/logs/LogsPage';

const account = { id: 'acct-1', email: 'ada@example.test', group: 'team', enabled: true, status: 'ok', email_verified: false, has_machine: false };
function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200 }); }
function renderPage(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><I18nProvider>{page}</I18nProvider></QueryClientProvider>);
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('account list compatibility', () => {
  it('shows active quota recovery on desktop and mobile, then restores the original status at expiry', async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 0, 1) / 1000;
    vi.setSystemTime(now * 1000);
    const items = [
      { ...account, id: 'waiting', email: 'waiting@example.test', quota_until: now + 10 },
      { ...account, id: 'failure', email: 'failure@example.test', status: 'error', quota_until: now + 20 },
      { ...account, id: 'disabled', email: 'disabled@example.test', enabled: false, quota_until: now + 20 },
      { ...account, id: 'blocked', email: 'blocked@example.test', status: 'blocked', quota_until: now + 20 },
      { ...account, id: 'expired', email: 'expired@example.test', quota_until: now - 1 },
      { ...account, id: 'zero', email: 'zero@example.test', quota_until: 0 },
      { ...account, id: 'legacy', email: 'legacy@example.test' },
    ];
    const fetchMock = vi.fn((path: string) => Promise.resolve(json(path === '/admin/api/overview' ? { accounts: 7, ready: 3 } : { items, total: 7 })));
    vi.stubGlobal('fetch', fetchMock);
    history.replaceState(null, '', '/#accounts');
    function LanguageSwitch() {
      const { lang, setLang } = useI18n();
      return <button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>Language</button>;
    }
    renderPage(<><LanguageSwitch /><AccountsPage /></>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const row = (email: string) => screen.getByRole('row', { name: new RegExp(email) });
    const card = (email: string) => screen.getAllByRole('article').find(item => item.textContent?.includes(email))!;
    const waitingRow = row('waiting@example.test');
    const badge = within(waitingRow).getByText('Paid quota exhausted');
    expect(badge.className).toContain('amber');
    expect(badge.className).not.toContain('emerald');
    expect(within(waitingRow).getByText('Free models remain available')).toBeTruthy();
    expect(within(waitingRow).getByText(`Recovers at ${formatTime(now + 10)}`)).toBeTruthy();
    expect(within(card('waiting@example.test')).getByText('Paid quota exhausted')).toBeTruthy();
    expect(within(card('waiting@example.test')).getByText('Free models remain available')).toBeTruthy();
    expect(within(card('waiting@example.test')).getByText(`Recovers at ${formatTime(now + 10)}`)).toBeTruthy();
    expect(within(row('disabled@example.test')).getByText('Disabled')).toBeTruthy();
    expect(within(row('blocked@example.test')).getByText('blocked')).toBeTruthy();
    expect(within(card('blocked@example.test')).getByText('blocked')).toBeTruthy();
    expect(within(card('blocked@example.test')).queryByText('Free models remain available')).toBeNull();
    for (const name of ['expired', 'zero', 'legacy']) expect(within(row(`${name}@example.test`)).getByText('ok')).toBeTruthy();
    expect(String(fetchMock.mock.calls[0][0])).toBe('/admin/api/accounts?offset=0&limit=20');
    expect(location.hash).toBe('#accounts');
    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    expect(within(waitingRow).getByText('付费额度耗尽')).toBeTruthy();
    expect(within(waitingRow).getByText('免费模型仍可用')).toBeTruthy();
    expect(within(waitingRow).getByText(`恢复时间 ${formatTime(now + 10)}`)).toBeTruthy();
    expect(within(card('waiting@example.test')).getByText('付费额度耗尽')).toBeTruthy();
    expect(within(card('waiting@example.test')).getByText('免费模型仍可用')).toBeTruthy();
    expect(within(card('waiting@example.test')).getByText(`恢复时间 ${formatTime(now + 10)}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(9_990); });
    expect(within(row('waiting@example.test')).getByText('ok').className).toContain('emerald');
    expect(within(card('waiting@example.test')).queryByText('Paid quota exhausted')).toBeNull();
    expect(within(card('waiting@example.test')).queryByText('Free models remain available')).toBeNull();
    expect(within(row('failure@example.test')).getByText('Paid quota exhausted')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(within(row('failure@example.test')).getByText('error')).toBeTruthy();
  });

  it('restores hash filters, sends pagination and sorting to the server, and persists page size', async () => {
    history.replaceState(null, '', '/#accounts?group=team&status=ok&page=2');
    const fetchMock = vi.fn(() => Promise.resolve(json({ items: [{ ...account, quota_until: Math.floor(Date.now() / 1000) + 3600 }], total: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const view = renderPage(<AccountsPage />);
    expect(await screen.findAllByText('ada@example.test')).toHaveLength(2);
    expect(screen.getAllByText('Paid quota exhausted')).toHaveLength(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/admin/api/accounts?offset=40&limit=20&group=team&status=ok');
    expect((screen.getByLabelText('Group') as HTMLInputElement).value).toBe('team');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('ok');
    const size = screen.getByLabelText('Per page') as HTMLSelectElement;
    expect([...size.options].map(option => option.value)).toEqual(['20', '50', '100']);
    fireEvent.change(size, { target: { value: '50' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes('offset=0&limit=50&group=team&status=ok'))).toBe(true));
    expect(localStorage.getItem('deepaicode2api_acct_page_size')).toBe('50');
    expect(location.hash).toBe('#accounts?group=team&status=ok');
    await screen.findAllByText('ada@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Account', exact: true }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes('sort=account&order=asc'))).toBe(true));
    await screen.findAllByText('ada@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Account', exact: true }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes('sort=account&order=desc'))).toBe(true));
    view.unmount();
    renderPage(<AccountsPage />);
    expect((await screen.findByLabelText('Per page') as HTMLSelectElement).value).toBe('50');
  });

  it('refreshes the shared health status after disabling and enabling an account', async () => {
    let enabled = true;
    vi.stubGlobal('fetch', vi.fn((path: string, options?: RequestInit) => {
      if (path === '/health') return Promise.resolve(json({ ready: enabled ? 1 : 0 }));
      if (options?.method === 'POST') {
        if (JSON.parse(String(options.body)).action === 'toggle') enabled = !enabled;
        return Promise.resolve(json({ ok: true }));
      }
      if (path === '/admin/api/overview') return Promise.resolve(json({ accounts: 1, ready: enabled ? 1 : 0 }));
      return Promise.resolve(json({ items: [{ ...account, enabled }], total: 1 }));
    }));
    function Health() {
      const health = useQuery({ queryKey: ['health'], queryFn: () => api<{ ready: number }>('/health') });
      return <div>Ready: {health.data?.ready ?? 'loading'}</div>;
    }
    history.replaceState(null, '', '/#accounts');
    renderPage(<><Health /><AccountsPage /></>);
    await screen.findByText('Ready: 1');
    await screen.findAllByText('ada@example.test');
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Account actions: ada@example.test' }));
    open();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Account actions' })).getByRole('button', { name: 'Disable account' }));
    await screen.findByText('Ready: 0');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    open();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Account actions' })).getByRole('button', { name: 'Enable account' }));
    await screen.findByText('Ready: 1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('sends account management operations and refreshes the list after success', async () => {
    const fetchMock = vi.fn((path: string, options?: RequestInit) => {
      if (options?.method === 'POST') return Promise.resolve(json({ ok: true, assigned: 1, moved: 1 }));
      return Promise.resolve(json({ items: [account], total: 1 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    history.replaceState(null, '', '/#accounts');
    renderPage(<AccountsPage />);
    await screen.findAllByText('ada@example.test');
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Account actions: ada@example.test' }));
    const actions: Array<[string, object]> = [
      ['Assign proxy', { action: 'assign-proxy', id: 'acct-1', reassign: false }],
      ['Assign fingerprint', { action: 'assign-machine', id: 'acct-1' }],
      ['Mark verified', { action: 'mark-verified', id: 'acct-1', email: 'ada@example.test' }],
    ];
    for (const [label, body] of actions) {
      open();
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Account actions' })).getByRole('button', { name: label }));
      await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST' && JSON.stringify(JSON.parse(String(call[1]?.body))) === JSON.stringify(body))).toBe(true));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    open();
    const dialog = screen.getByRole('dialog', { name: 'Account actions' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change group' }));
    fireEvent.change(within(dialog).getByLabelText('New group'), { target: { value: 'research' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST' && JSON.parse(String(call[1]?.body)).action === 'set-group' && JSON.parse(String(call[1]?.body)).group === 'research')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock.mock.calls.filter(call => !call[1]?.method || call[1]?.method === 'GET').length).toBeGreaterThan(1);
  });
});

describe('request log usage', () => {
  it('distinguishes missing, explicit zero, and historical nonzero token values', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ logs: [
      { time: 3, model: 'missing', status: 200, tokens_in_reported: false, tokens_out_reported: false },
      { time: 2, model: 'zero', status: 200, tokens_in_reported: true, tokens_out_reported: true },
      { time: 1, model: 'history', status: 200, tokens_in: 42, tokens_out: 0 },
    ] }))));
    history.replaceState(null, '', '/#logs');
    renderPage(<LogsPage />);
    const usage = async (model: string) => (await screen.findByRole('row', { name: new RegExp(model) })).querySelectorAll('td')[4].textContent;
    expect(await usage('missing')).toContain('InUnknownOutUnknown');
    expect(await usage('zero')).toContain('In0Out0');
    expect(await usage('history')).toContain('In42OutUnknown');
  });
});

describe('model catalog compatibility', () => {
  it('renders upstream camelCase pricing, token limits and input capabilities', async () => {
    vi.stubGlobal('fetch', vi.fn((path: string) => Promise.resolve(json(path === '/admin/api/models' ? {
      models: [{ id: 'example-model', name: 'Example', contextWindow: 128000, maxTokens: 4096, theosPerRequest: 2.5, theosPerSecond: { output: 0.25 }, input: ['text', 'image'], reasoning: true, free: false, api: 'responses' }],
      default_model: 'example-model',
    } : { model_aliases: {} }))));
    renderPage(<ModelsPage />);
    expect(await screen.findAllByText('128,000')).toHaveLength(2);
    expect(screen.getAllByText('4,096')).toHaveLength(2);
    expect(screen.getAllByText('2.5')).toHaveLength(2);
    expect(screen.getAllByText('0.25')).toHaveLength(2);
    expect(screen.getAllByText('text · image · Reasoning')).toHaveLength(2);
    expect(screen.getAllByText('responses')).toHaveLength(2);
  });
});
