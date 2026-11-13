import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CirclePlus, Download, Ellipsis, RefreshCw, Search, SlidersHorizontal, UsersRound, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import AccountActions from './AccountActions';
import OAuthPanel, { type LoginResult, type LoginSession } from './OAuthPanel';
import { displayAccount, formatTime, maskWord, type Account } from './account-utils';

interface AccountPageResponse { items: Account[] | null; total: number }
interface Filters { group: string; status: string; q: string; page: number }
interface CheckinResponse { probed: number; remaining: number; skipped?: number; results: { id: string; name?: string; ok: boolean; err?: string; skipped?: boolean }[] }
type Notice = { kind: 'success' | 'error' | 'info'; text: string };
type Sort = { key: string; desc: boolean };

const buttonBase = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';
const button = `${buttonBase} bg-secondary text-foreground hover:bg-muted`;
const primaryButton = `${buttonBase} bg-primary text-primary-foreground hover:opacity-90`;
const field = 'min-h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const filterField = 'h-9 w-full rounded-md border-0 bg-muted px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const iconButton = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50';

function readFilters(): Filters {
  const [tab, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(tab === 'accounts' ? query : '');
  const rawPage = params.get('page') || '0';
  const parsed = /^\d+$/.test(rawPage) ? Number(rawPage) : 0;
  return { group: params.get('group') || '', status: params.get('status') || '', q: params.get('q') || '', page: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0 };
}

function writeFilters(filters: Filters) {
  if (window.location.hash.split('?')[0] !== '#accounts') return;
  const params = new URLSearchParams();
  if (filters.page > 0) params.set('page', String(filters.page));
  if (filters.group.trim()) params.set('group', filters.group.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  const next = `#accounts${params.size ? `?${params}` : ''}`;
  if (next !== window.location.hash) window.history.replaceState(null, '', next);
}

function savedSize(): number {
  try { const size = Number(localStorage.getItem('deepaicode2api_acct_page_size')); return [20, 50, 100].includes(size) ? size : 20; } catch { return 20; }
}
function savedMask(): boolean {
  try { return localStorage.getItem('deepaicode2api_acct_mask') === '1'; } catch { return false; }
}
function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Storage can be unavailable in private browsing. */ }
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export default function AccountsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(readFilters);
  const [groupDraft, setGroupDraft] = useState(filters.group);
  const [queryDraft, setQueryDraft] = useState(filters.q);
  const [size, setSize] = useState(savedSize);
  const [mask, setMask] = useState(savedMask);
  const [sort, setSort] = useState<Sort>({ key: '', desc: false });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [selected, setSelected] = useState<Account | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [session, setSession] = useState<LoginSession | null>(null);

  const path = useMemo(() => {
    const params = new URLSearchParams({ offset: String(filters.page * size), limit: String(size) });
    if (filters.group.trim()) params.set('group', filters.group.trim());
    if (filters.status) params.set('status', filters.status);
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (sort.key) { params.set('sort', sort.key); params.set('order', sort.desc ? 'desc' : 'asc'); }
    return `/admin/api/accounts?${params}`;
  }, [filters, size, sort]);
  const accounts = useQuery({ queryKey: ['accounts', path], queryFn: () => api<AccountPageResponse>(path), retry: false });
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<{ accounts: number; ready: number }>('/admin/api/overview'), retry: false });
  const total = accounts.data?.total || 0;
  const items = accounts.data?.items || [];
  const pages = Math.max(1, Math.ceil(total / size));

  useEffect(() => {
    let timer: number | undefined;
    const syncClock = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      const now = Date.now();
      setClock(now);
      const next = (accounts.data?.items || []).reduce((earliest, account) => {
        const until = account.enabled && typeof account.quota_until === 'number' ? account.quota_until * 1000 : 0;
        return until > now ? Math.min(earliest, until) : earliest;
      }, Infinity);
      if (Number.isFinite(next)) timer = window.setTimeout(syncClock, Math.min(next - now, 2_147_483_647));
    };
    syncClock();
    document.addEventListener('visibilitychange', syncClock);
    return () => { if (timer !== undefined) window.clearTimeout(timer); document.removeEventListener('visibilitychange', syncClock); };
  }, [accounts.data]);

  function apply(next: Filters) { setFilters(next); writeFilters(next); }
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash.split('?')[0] !== '#accounts') return;
      const restored = readFilters(); setFilters(restored); setGroupDraft(restored.group); setQueryDraft(restored.q);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (groupDraft === filters.group && queryDraft === filters.q) return;
    const timer = setTimeout(() => apply({ ...filters, group: groupDraft, q: queryDraft, page: 0 }), 250);
    return () => clearTimeout(timer);
  }, [groupDraft, queryDraft, filters]);
  useEffect(() => {
    if (accounts.isSuccess && filters.page >= pages) apply({ ...filters, page: pages - 1 });
  }, [accounts.isSuccess, pages, filters]);

  async function refreshData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['accounts'] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
      queryClient.invalidateQueries({ queryKey: ['health'] }),
    ]);
  }
  async function accountAction(operation: { action: string; extra?: Record<string, unknown> }): Promise<boolean> {
    setBusy(true); setNotice(null);
    try {
      const result = await api<{ ok?: boolean; assigned?: number; cleared?: number; moved?: number; count?: number }>('/admin/api/accounts', { method: 'POST', body: { action: operation.action, ...operation.extra } });
      if (result.ok === false) throw new Error(t('账号不存在或未更改', 'Account not found or not changed'));
      let message = t('操作成功', 'Operation completed');
      if (operation.action === 'import') { const count = result.count ?? 0; message = t(`已导入 ${count} 个账号`, `Imported ${count} ${count === 1 ? 'account' : 'accounts'}`); }
      if (operation.action === 'assign-machine' && result.assigned === 0) message = t('没有需要分配指纹的账号', 'No account needed a fingerprint');
      if (operation.action === 'assign-proxy' && (result.assigned === 0 || result.cleared === 0)) message = t('没有账号发生更改', 'No account was changed');
      if (operation.action === 'set-group' && result.moved === 0) message = t('账号分组未发生更改', 'The account group was unchanged');
      setNotice({ kind: 'success', text: message }); await refreshData(); return true;
    } catch (error) { setNotice({ kind: 'error', text: `${t('操作失败', 'Operation failed')}: ${errorText(error)}` }); return false; }
    finally { setBusy(false); }
  }
  async function refreshQuota(id?: string): Promise<boolean> {
    setBusy(true); setNotice({ kind: 'info', text: t('正在刷新配额…', 'Refreshing quota…') });
    let done = 0; let remaining = 0; let rounds = 0; let skipped = 0;
    const failures: CheckinResponse['results'] = [];
    try {
      do {
        const result = await api<CheckinResponse>('/admin/api/checkin', { method: 'POST', body: id ? { id } : { limit: 100 } });
        done += result.probed || 0; remaining = result.remaining || 0; skipped += result.skipped || 0;
        failures.push(...(result.results || []).filter((item) => !item.ok && !item.skipped)); rounds++;
        if (!id && remaining > 0 && rounds < 30) setNotice({ kind: 'info', text: t(`已查询 ${done} 个账号，剩余 ${remaining} 个…`, `Checked ${done} accounts; ${remaining} remaining…`) });
      } while (!id && remaining > 0 && rounds < 30);
      const details = failures.slice(0, 5).map((item) => `${mask ? maskWord(item.name || item.id) : item.name || item.id}: ${item.err || t('未知错误', 'Unknown error')}`).join('\n');
      const partial = remaining > 0 && !id ? t(`；仍有 ${remaining} 个待处理，请再次刷新`, `; ${remaining} remain, refresh again`) : '';
      const skippedText = skipped ? t(`；跳过 ${skipped} 个正在查询的账号`, `; ${skipped} already being checked`) : '';
      const text = t(`配额刷新完成：查询 ${done} 个，失败 ${failures.length}`, `Quota refresh complete: ${done} checked, ${failures.length} failed`) + skippedText + partial + (details ? `\n${details}` : '');
      setNotice({ kind: failures.length || partial ? 'error' : 'success', text }); await refreshData(); return failures.length === 0 && !partial;
    } catch (error) {
      setNotice({ kind: 'error', text: `${t('配额刷新失败', 'Quota refresh failed')}: ${errorText(error)}${done ? t(`（已查询 ${done} 个）`, ` (${done} checked)`) : ''}` });
      await refreshData(); return false;
    } finally { setBusy(false); }
  }
  async function addManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = manualKey.trim();
    if (!key) { setNotice({ kind: 'error', text: t('请填写 API Key', 'Enter an API key') }); return; }
    if (await accountAction({ action: 'manual', extra: { api_key: key, name: manualName.trim() } })) { setManualKey(''); setManualName(''); setManualOpen(false); }
  }
  async function startLogin() {
    // Open synchronously to keep popup blockers from suppressing the sign-in tab.
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setBusy(true); setNotice(null); setSession(null);
    try {
      const started = await api<LoginSession>('/admin/api/login/start', { method: 'POST', body: {} });
      if (!started.session_id) throw new Error(t('登录会话无效', 'Invalid login session'));
      const url = new URL(started.open_url || `/login/open?id=${encodeURIComponent(started.session_id)}`, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error(t('登录链接无效', 'Invalid sign-in link'));
      if (popup) popup.location.replace(url.href);
      setSession(started);
    } catch (error) { popup?.close(); setNotice({ kind: 'error', text: `${t('发起登录失败', 'Could not start sign-in')}: ${errorText(error)}` }); }
    finally { setBusy(false); }
  }
  function loginSucceeded(result: LoginResult) {
    setSession(null);
    const user = result.username ? `: ${mask ? maskWord(result.username) : result.username}` : '';
    setNotice({ kind: 'success', text: t('登录成功', 'Signed in successfully') + user + (result.is_pro ? ' (Pro)' : '') });
    void refreshData();
  }
  function changeSort(key: string) {
    setSort((old) => ({ key, desc: old.key === key ? !old.desc : false }));
    apply({ ...filters, page: 0 });
  }
  function sortHeading(key: string, label: string) {
    const current = sort.key === key;
    return <th key={key} scope="col" aria-sort={current ? (sort.desc ? 'descending' : 'ascending') : undefined} className="whitespace-nowrap px-2 py-2.5 text-left font-normal"><button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => changeSort(key)}>{label}{current && (sort.desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}</button></th>;
  }
  const quotaWaiting = (account: Account) => account.enabled && account.status !== 'blocked' && typeof account.quota_until === 'number' && account.quota_until * 1000 > clock;
  const status = (account: Account) => !account.enabled ? t('已停用', 'Disabled') : quotaWaiting(account) ? t('付费额度耗尽', 'Paid quota exhausted') : account.status === 'unknown' ? t('未探测', 'Unprobed') : account.status || 'error';
  const quota = (account: Account) => account.theos ? account.theos.balance || account.theos.granted || '0' : '—';
  const plan = (account: Account) => `${account.is_pro ? 'Pro' : account.plan || 'Free'} · ${account.email_verified ? t('已验证', 'Verified') : t('未验证', 'Unverified')}`;
  const statusClass = (account: Account) => !account.enabled ? 'bg-muted text-muted-foreground' : quotaWaiting(account) || account.status === 'unknown' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : account.status === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/10 text-red-700 dark:text-red-400';
  const recovery = (account: Account) => quotaWaiting(account) ? <div className="mt-1 text-xs text-muted-foreground"><p>{t('免费模型仍可用', 'Free models remain available')}</p><p>{t('恢复时间', 'Recovers at')} {formatTime(account.quota_until)}</p></div> : null;
  const selectAccount = (account: Account) => { setNotice(null); setSelected(account); };
  const sortOptions = [ ['account', t('账号', 'Account')], ['group', t('分组', 'Group')], ['source', t('来源', 'Source')], ['plan', t('套餐', 'Plan')], ['theos', 'Theos'], ['status', t('状态', 'Status')], ['failures', t('失败次数', 'Failures')], ['last_used', t('最近使用', 'Last used')] ];
  const summary = [
    { label: t('账号总数', 'Total accounts'), value: overview.data?.accounts, detail: t('账号池中的全部账号', 'All accounts in the pool'), icon: UsersRound, color: 'text-sky-500' },
    { label: t('就绪账号', 'Ready accounts'), value: overview.data?.ready, detail: t('可参与调度', 'Available for routing'), icon: CircleCheck, color: 'text-emerald-500' },
    { label: t('未就绪账号', 'Not ready'), value: overview.data ? overview.data.accounts - overview.data.ready : undefined, detail: t('已停用或暂不可用', 'Disabled or unavailable'), icon: CircleAlert, color: 'text-amber-500' },
    { label: t('当前筛选', 'Matching accounts'), value: accounts.data?.total, detail: t('符合当前筛选条件', 'Matching the current filters'), icon: SlidersHorizontal, color: 'text-muted-foreground' },
  ];

  return <div className="space-y-5">
    <header className="flex min-h-8 items-center"><h1 className="text-xl font-medium">{t('账号池', 'Accounts')}</h1></header>
    <section className="grid grid-cols-2 gap-2 xl:grid-cols-4" aria-label={t('账号摘要', 'Account summary')}>
      {summary.map(({ label, value, detail, icon: Icon, color }) => <div key={label} className="min-w-0 rounded-lg bg-card p-4"><div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{label}</span><Icon size={15} className={`shrink-0 ${color}`} aria-hidden="true" /></div><div className="mt-3 text-2xl font-medium tabular-nums">{value ?? '—'}</div><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>)}
    </section>
    {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 whitespace-pre-wrap rounded-lg border p-3 text-sm ${notice.kind === 'error' ? 'border-destructive text-destructive' : 'border-border bg-muted text-foreground'}`}><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label={t('关闭提示', 'Dismiss message')}><X size={16} /></button></div>}
    {manualOpen && <form onSubmit={(event) => void addManual(event)} className="rounded-lg bg-card p-5"><h2 className="font-medium">{t('手动添加账号', 'Add an account')}</h2><div className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]"><label className="text-sm">{t('账号名称（可选）', 'Name (optional)')}<input className={`${field} mt-1`} value={manualName} onChange={(event) => setManualName(event.target.value)} autoComplete="off" /></label><label className="text-sm">{t('DeepAI API Key', 'DeepAI API key')}<input className={`${field} mt-1`} type="password" value={manualKey} onChange={(event) => setManualKey(event.target.value)} autoComplete="off" required /></label><button type="submit" className={`${primaryButton} self-end`} disabled={busy}>{t('添加 API Key', 'Add API key')}</button></div></form>}
    {session && <OAuthPanel session={session} onClose={() => setSession(null)} onSuccess={loginSucceeded} />}
    <section className="space-y-4" aria-labelledby="accounts-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="accounts-title" className="text-sm font-medium">{t('账号列表', 'Account list')} <span className="ml-1 font-normal text-muted-foreground">{accounts.data ? total : '—'}</span></h2><button type="button" className={primaryButton} onClick={() => setManualOpen((value) => !value)}><CirclePlus size={15} />{t('添加账号', 'Add account')}</button></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block min-w-0 flex-1 basis-full sm:max-w-64 sm:basis-auto"><span className="sr-only">{t('搜索', 'Search')}</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className={`${filterField} pl-9`} value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder={t('邮箱、名称、用户名或 ID', 'Email, name, username or ID')} /></label>
        <label className="min-w-0 flex-1 sm:w-36 sm:flex-none"><span className="sr-only">{t('分组', 'Group')}</span><input className={filterField} value={groupDraft} onChange={(event) => setGroupDraft(event.target.value)} placeholder={t('全部分组', 'All groups')} /></label>
        <label className="min-w-0 flex-1 sm:w-36 sm:flex-none"><span className="sr-only">{t('状态', 'Status')}</span><select className={filterField} value={filters.status} onChange={(event) => apply({ ...filters, group: groupDraft, q: queryDraft, status: event.target.value, page: 0 })}><option value="">{t('全部状态', 'All statuses')}</option><option value="ok">ok</option><option value="error">error</option><option value="unknown">unknown</option><option value="blocked">blocked</option></select></label>
        <button type="button" className={button} onClick={() => { setGroupDraft(''); setQueryDraft(''); apply({ group: '', status: '', q: '', page: 0 }); }}>{t('清除筛选', 'Clear filters')}</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs"><div className="flex flex-wrap items-center gap-3"><label className="inline-flex min-h-9 items-center gap-2 text-muted-foreground"><input type="checkbox" checked={mask} onChange={(event) => { setMask(event.target.checked); savePreference('deepaicode2api_acct_mask', event.target.checked ? '1' : '0'); }} />{t('脱敏显示', 'Mask identities')}</label><label className="flex items-center gap-2 whitespace-nowrap lg:hidden">{t('排序', 'Sort')}<select className={`${filterField} w-auto`} value={sort.key} onChange={(event) => { setSort({ key: event.target.value, desc: false }); apply({ ...filters, page: 0 }); }}><option value="">{t('默认', 'Default')}</option>{sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{sort.key && <button type="button" className={iconButton} onClick={() => setSort({ ...sort, desc: !sort.desc })} aria-label={sort.desc ? t('降序，点击切换升序', 'Descending, switch to ascending') : t('升序，点击切换降序', 'Ascending, switch to descending')}>{sort.desc ? <ArrowDown size={15} /> : <ArrowUp size={15} />}</button>}</label></div><div className="flex flex-wrap gap-1.5"><button type="button" className={button} disabled={busy} onClick={() => void accountAction({ action: 'import' })}><Download size={14} />{t('导入本机桌面端', 'Import desktop')}</button><button type="button" className={button} disabled={busy} onClick={() => void startLogin()}>{t('浏览器登录', 'Browser sign-in')}</button><button type="button" className={button} disabled={busy} onClick={() => void refreshQuota()}><RefreshCw size={14} />{t('刷新全部配额', 'Refresh all quotas')}</button><button type="button" className={button} disabled={accounts.isFetching} onClick={() => void accounts.refetch()}>{t('刷新列表', 'Refresh list')}</button></div></div>
      {accounts.isError && <div role="alert" className="py-4 text-sm text-destructive">{t('加载失败', 'Could not load accounts')}: {errorText(accounts.error)}</div>}
      {accounts.isLoading ? <p className="py-4 text-sm text-muted-foreground">{t('加载中…', 'Loading…')}</p> : !accounts.isError && !items.length ? <p className="py-4 text-sm text-muted-foreground">{total ? t('本页没有账号', 'No accounts on this page') : t('没有匹配的账号。可导入桌面端、使用浏览器登录或手动添加。', 'No matching accounts. Import desktop credentials, sign in, or add an account.')}</p> : null}
      {!!items.length && <>
        <div className="hidden overflow-x-auto lg:block"><table className="w-full text-xs"><thead className="border-b border-border text-xs text-muted-foreground"><tr>{sortHeading('account', t('账号', 'Account'))}{sortHeading('group', t('分组', 'Group'))}{sortHeading('source', t('来源', 'Source'))}<th scope="col" className="px-3 py-3 text-left font-medium">Key</th>{sortHeading('plan', t('套餐 / 验证', 'Plan / verification'))}{sortHeading('theos', 'Theos')}{sortHeading('status', t('状态', 'Status'))}{sortHeading('failures', t('失败', 'Failures'))}{sortHeading('last_used', t('最近使用', 'Last used'))}<th scope="col" className="px-3 py-3 text-left font-medium">{t('操作', 'Actions')}</th></tr></thead><tbody>{items.map((account) => <tr key={account.id} className="border-b border-border last:border-0"><td className="max-w-56 px-3 py-3"><div className="break-all font-medium">{displayAccount(account, mask)}</div>{account.username && <div className="mt-1 break-all text-xs text-muted-foreground">{mask ? maskWord(account.username) : account.username}</div>}{account.proxy && <div className="mt-1 break-all text-xs text-muted-foreground">{account.proxy}{account.fingerprint ? ` · ${account.fingerprint}` : ''}</div>}</td><td className="px-3 py-3">{account.group || 'default'}</td><td className="px-3 py-3 text-muted-foreground">{account.source || '—'}</td><td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{account.key || '—'}</td><td className="whitespace-nowrap px-3 py-3">{plan(account)}</td><td className="px-3 py-3">{quota(account)}</td><td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs ${statusClass(account)}`}>{status(account)}</span>{recovery(account)}</td><td className="px-3 py-3">{account.failures || 0}</td><td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatTime(account.last_used)}</td><td className="px-3 py-3"><button type="button" className={iconButton} onClick={() => selectAccount(account)} aria-label={`${t('账号操作', 'Account actions')}: ${displayAccount(account, mask)}`}><Ellipsis size={17} /><span className="sr-only">{t('操作', 'Actions')}</span></button></td></tr>)}</tbody></table></div>
        <div className="divide-y divide-border lg:hidden">{items.map((account) => <article key={account.id} className="py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-all text-sm font-medium">{displayAccount(account, mask)}</h3>{account.username && <p className="mt-1 break-all text-xs text-muted-foreground">{mask ? maskWord(account.username) : account.username}</p>}</div><span className={`shrink-0 rounded-full px-2 py-1 text-xs ${statusClass(account)}`}>{status(account)}</span></div>{recovery(account)}<dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">{t('分组', 'Group')}</dt><dd className="mt-1 break-all">{account.group || 'default'}</dd></div><div><dt className="text-muted-foreground">Theos</dt><dd className="mt-1">{quota(account)}</dd></div><div><dt className="text-muted-foreground">{t('套餐 / 验证', 'Plan / verification')}</dt><dd className="mt-1">{plan(account)}</dd></div><div><dt className="text-muted-foreground">{t('失败', 'Failures')}</dt><dd className="mt-1">{account.failures || 0}</dd></div><div><dt className="text-muted-foreground">{t('来源', 'Source')}</dt><dd className="mt-1">{account.source || '—'}</dd></div><div><dt className="text-muted-foreground">Key</dt><dd className="mt-1 break-all font-mono text-xs">{account.key || '—'}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">{t('最近使用', 'Last used')}</dt><dd className="mt-1">{formatTime(account.last_used)}</dd></div></dl><button type="button" className={`${button} mt-3`} onClick={() => selectAccount(account)}>{t('账号操作', 'Account actions')}</button></article>)}</div>
      </>}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-muted-foreground"><div className="flex items-center gap-1"><button type="button" className={iconButton} disabled={filters.page <= 0 || accounts.isFetching} onClick={() => apply({ ...filters, page: filters.page - 1 })} aria-label={t('上一页', 'Previous')}><ChevronLeft size={16} /></button><span className="whitespace-nowrap px-2">{t(`第 ${Math.min(filters.page + 1, pages)} / ${pages} 页`, `Page ${Math.min(filters.page + 1, pages)} of ${pages}`)}</span><button type="button" className={iconButton} disabled={filters.page >= pages - 1 || accounts.isFetching} onClick={() => apply({ ...filters, page: filters.page + 1 })} aria-label={t('下一页', 'Next')}><ChevronRight size={16} /></button>{total > 0 && <span className="ml-2">{filters.page * size + 1}–{Math.min((filters.page + 1) * size, total)} / {total}</span>}</div><label className="flex items-center gap-2 whitespace-nowrap">{t('每页', 'Per page')}<select className={`${filterField} w-auto`} value={size} onChange={(event) => { const value = Number(event.target.value); setSize(value); savePreference('deepaicode2api_acct_page_size', String(value)); apply({ ...filters, page: 0 }); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
    </section>
    {selected && <AccountActions account={selected} mask={mask} busy={busy} error={notice?.kind === 'error' ? notice.text : undefined} onClose={() => setSelected(null)} onAction={accountAction} onCheckin={refreshQuota} />}
  </div>;
}
