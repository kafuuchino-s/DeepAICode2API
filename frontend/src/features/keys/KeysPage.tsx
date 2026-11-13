import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CirclePlus, Copy, Ellipsis, RefreshCw, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

interface GatewayKey {
  key: string;
  name: string;
  group: string;
  enabled: boolean;
  requests: number;
  created_at: number;
  last_used: number;
}
type SortKey = 'key' | 'name' | 'group' | 'enabled' | 'requests' | 'created_at' | 'last_used';
type Notice = { kind: 'success' | 'error'; text: string };
const buttonBase = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';
const button = `${buttonBase} bg-secondary text-foreground hover:bg-muted`;
const primaryButton = `${buttonBase} bg-primary text-primary-foreground hover:opacity-90`;
const field = 'min-h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const iconButton = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50';

function formatTime(seconds: number): string {
  if (!seconds) return '—';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function KeyDialog({ item, busy, error, onClose, onToggle, onGroup, onDelete }: {
  item: GatewayKey; busy: boolean; error?: string; onClose: () => void;
  onToggle: () => Promise<boolean>; onGroup: (group: string) => Promise<boolean>; onDelete: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [group, setGroup] = useState(item.group || '');
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="key-actions-title" className="!m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/25">
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4"><div className="min-w-0"><h2 id="key-actions-title" className="text-lg font-semibold">{t('密钥操作', 'Key actions')}</h2><p className="mt-1 break-all font-mono text-sm text-muted-foreground">{item.key}</p></div><button type="button" className={`${button} h-10 w-10 p-0`} onClick={onClose} disabled={busy} aria-label={t('关闭', 'Close')}><X size={17} /></button></div>
    <div className="space-y-5 p-5">
      {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
      <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">{t('名称', 'Name')}</dt><dd className="mt-1 break-all">{item.name || '—'}</dd></div><div><dt className="text-muted-foreground">{t('当前分组', 'Current group')}</dt><dd className="mt-1 break-all">{item.group || t('全部分组（历史密钥）', 'All groups (legacy key)')}</dd></div></dl>
      <button type="button" className={`${button} w-full`} disabled={busy} onClick={async () => { if (await onToggle()) onClose(); }}>{item.enabled ? t('停用密钥', 'Disable key') : t('启用密钥', 'Enable key')}</button>
      <form className="space-y-2 rounded-lg bg-muted p-3" onSubmit={async (event) => { event.preventDefault(); if (await onGroup(group.trim())) onClose(); }}>
        <label htmlFor="key-edit-group" className="block text-sm font-medium">{t('更改绑定分组', 'Change group')}</label>
        <p className="text-sm text-muted-foreground">{t('留空将绑定 default 分组。', 'Leaving this blank binds the key to the default group.')}{!item.group && ` ${t('此历史密钥当前可使用全部分组；保存后将按新分组调度。', 'This legacy key currently uses all groups; saving will change its scope.')}`}</p>
        <div className="flex flex-wrap gap-2"><input id="key-edit-group" className={`${field} min-w-0 flex-1`} value={group} onChange={(event) => setGroup(event.target.value)} placeholder="default" disabled={busy} /><button type="submit" className={button} disabled={busy}>{t('保存', 'Save')}</button></div>
      </form>
      <div className="border-t border-border pt-4"><button type="button" className={`${button} text-destructive`} disabled={busy} onClick={async () => { if (window.confirm(t('确定删除该密钥？使用它的客户端将无法继续访问。', 'Delete this key? Clients using it will lose access.')) && await onDelete()) onClose(); }}>{t('删除密钥', 'Delete key')}</button></div>
    </div>
  </dialog>;
}

function CreateKeyDialog({ name, group, busy, error, onName, onGroup, onClose, onSubmit }: {
  name: string; group: string; busy: boolean; error?: string; onName: (value: string) => void; onGroup: (value: string) => void;
  onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="create-key-title" className="!m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/25">
    <form className="space-y-5 p-5" onSubmit={onSubmit}>
      <div className="flex items-start justify-between gap-3"><div><h2 id="create-key-title" className="text-base font-medium">{t('创建密钥', 'Create key')}</h2><p className="mt-1 text-xs text-muted-foreground">{t('为客户端创建访问密钥。', 'Create an access key for a client.')}</p></div><button type="button" className={iconButton} onClick={onClose} disabled={busy} aria-label={t('关闭', 'Close')}><X size={16} /></button></div>
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}
      <label className="block text-xs text-muted-foreground">{t('名称（可选）', 'Name (optional)')}<input className={`${field} mt-1.5`} value={name} onChange={(event) => onName(event.target.value)} autoComplete="off" /></label>
      <label className="block text-xs text-muted-foreground">{t('绑定分组', 'Group')}<input className={`${field} mt-1.5`} value={group} onChange={(event) => onGroup(event.target.value)} placeholder="default" autoComplete="off" /></label>
      <p className="text-xs text-muted-foreground">{t('分组留空时绑定 default。', 'Leaving the group blank binds this key to default.')}</p>
      <div className="flex justify-end gap-2"><button type="button" className={button} onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button><button type="submit" className={primaryButton} disabled={busy}>{busy ? t('创建中…', 'Creating…') : t('创建', 'Create')}</button></div>
    </form>
  </dialog>;
}

function CreatedKey({ value, onClose }: { value: string; onClose: () => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  async function copy() {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); copied = true; }
    } catch { /* Try the selection-based copy for insecure origins or denied permission. */ }
    if (!copied) {
      input.current?.focus(); input.current?.select();
      try { copied = !!input.current && document.execCommand('copy'); } catch { /* Keep the selection for manual copying. */ }
    }
    setMessage(copied ? t('密钥已复制', 'Key copied') : t('请复制已选中的密钥', 'Copy the selected key'));
  }
  return <section className="rounded-lg bg-card p-5" aria-labelledby="new-key-title"><div className="flex items-start justify-between gap-4"><div><h2 id="new-key-title" className="font-semibold">{t('密钥已创建', 'Key created')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('完整密钥只显示这一次，请立即复制并妥善保存。', 'The full key is shown only once. Copy and save it now.')}</p></div><button type="button" className={`${button} h-10 w-10 p-0`} onClick={onClose} aria-label={t('关闭并清除完整密钥', 'Close and clear the full key')}><X size={17} /></button></div><label className="sr-only" htmlFor="created-key">{t('完整密钥', 'Full key')}</label><div className="mt-4 flex flex-wrap gap-2"><input id="created-key" ref={input} className={`${field} min-w-0 flex-1 font-mono`} value={value} readOnly spellCheck={false} onFocus={(event) => event.currentTarget.select()} /><button type="button" className={button} onClick={() => void copy()}><Copy size={16} />{t('复制', 'Copy')}</button></div>{message && <p role="status" className="mt-2 text-sm text-muted-foreground">{message}</p>}</section>;
}

export default function KeysPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ['keys'], queryFn: () => api<{ keys: GatewayKey[] | null }>('/admin/api/keys'), retry: false });
  const [sort, setSort] = useState<{ key: SortKey | ''; desc: boolean }>({ key: '', desc: false });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [created, setCreated] = useState('');
  const [selected, setSelected] = useState<GatewayKey | null>(null);
  const items = useMemo(() => {
    const list = [...(keys.data?.keys || [])];
    if (!sort.key) return list;
    const key = sort.key;
    return list.sort((a, b) => {
      const av = a[key] ?? ''; const bv = b[key] ?? '';
      const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : typeof av === 'boolean' && typeof bv === 'boolean' ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
      return sort.desc ? -result : result;
    });
  }, [keys.data, sort]);
  const sortOptions: [SortKey, string][] = [['key', t('密钥', 'Key')], ['name', t('名称', 'Name')], ['group', t('分组', 'Group')], ['enabled', t('状态', 'Status')], ['requests', t('请求数', 'Requests')], ['created_at', t('创建时间', 'Created')], ['last_used', t('最近使用', 'Last used')]];
  function changeSort(key: SortKey) { setSort((old) => ({ key, desc: old.key === key ? !old.desc : false })); }
  function heading(key: SortKey, label: string) {
    const current = sort.key === key;
    return <th scope="col" key={key} aria-sort={current ? (sort.desc ? 'descending' : 'ascending') : undefined} className="whitespace-nowrap px-2 py-2.5 text-left font-normal"><button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => changeSort(key)}>{label}{current && (sort.desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}</button></th>;
  }
  async function refreshData() {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['keys'] }), queryClient.invalidateQueries({ queryKey: ['overview'] })]);
  }
  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice(null);
    try {
      const result = await api<{ ok: boolean; key: string }>('/admin/api/keys', { method: 'POST', body: { name: name.trim(), group: group.trim() } });
      if (!result.ok || !result.key) throw new Error(t('创建响应中没有密钥', 'The response did not contain a key'));
      setCreated(result.key); setName(''); setGroup(''); setCreateOpen(false);
      void refreshData();
    } catch (error) { setNotice({ kind: 'error', text: `${t('创建失败', 'Could not create key')}: ${errorText(error)}` }); }
    finally { setBusy(false); }
  }
  async function mutate(operation: 'toggle' | 'group' | 'delete', item: GatewayKey, newGroup = ''): Promise<boolean> {
    setBusy(true); setNotice(null);
    try {
      const response = operation === 'group'
        ? await api<{ ok: boolean }>('/admin/api/keys', { method: 'POST', body: { action: 'set-group', key: item.key, group: newGroup } })
        : await api<{ ok: boolean }>(`/admin/api/keys?${operation === 'delete' ? 'key' : 'toggle'}=${encodeURIComponent(item.key)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(t('密钥不存在或未更改', 'Key not found or unchanged'));
      setNotice({ kind: 'success', text: operation === 'group' ? t('分组已更新', 'Group updated') : operation === 'delete' ? t('密钥已删除', 'Key deleted') : t('密钥状态已更新', 'Key status updated') });
      void refreshData(); return true;
    } catch (error) {
      setNotice({ kind: 'error', text: `${t('操作失败', 'Operation failed')}: ${errorText(error)}` });
      void refreshData(); return false;
    } finally { setBusy(false); }
  }
  const showItem = (item: GatewayKey) => { setNotice(null); setSelected(item); };
  const status = (item: GatewayKey) => <span className={`inline-flex rounded-full px-2 py-1 text-xs ${item.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{item.enabled ? t('启用', 'Enabled') : t('停用', 'Disabled')}</span>;
  const groupName = (item: GatewayKey) => item.group || t('全部分组', 'All groups');

  return <div className="space-y-5">
    <header className="flex min-h-8 items-center"><h1 className="text-xl font-medium">{t('API 密钥', 'API keys')}</h1></header>
    {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${notice.kind === 'error' ? 'border-destructive text-destructive' : 'border-border bg-muted text-foreground'}`}><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label={t('关闭提示', 'Dismiss message')}><X size={16} /></button></div>}
    {created && <CreatedKey value={created} onClose={() => setCreated('')} />}
    {createOpen && <CreateKeyDialog name={name} group={group} busy={busy} error={notice?.kind === 'error' ? notice.text : undefined} onName={setName} onGroup={setGroup} onClose={() => setCreateOpen(false)} onSubmit={(event) => void createKey(event)} />}
    <section className="space-y-4" aria-labelledby="keys-title"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="keys-title" className="text-sm font-medium">{t('密钥列表', 'Keys')} <span className="ml-1 font-normal text-muted-foreground">{keys.data ? items.length : '—'}</span></h2><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={keys.isFetching} onClick={() => void keys.refetch()}><RefreshCw size={14} />{t('刷新列表', 'Refresh list')}</button><button type="button" className={primaryButton} disabled={!!created} onClick={() => { setNotice(null); setCreateOpen(true); }}><CirclePlus size={15} />{t('创建密钥', 'Create key')}</button></div></div>
      <div className="flex flex-wrap items-center gap-2 text-xs lg:hidden"><label htmlFor="key-sort">{t('排序', 'Sort')}</label><select id="key-sort" className={`${field} w-auto border-transparent bg-muted text-xs`} value={sort.key} onChange={(event) => setSort({ key: event.target.value as SortKey | '', desc: false })}><option value="">{t('默认', 'Default')}</option>{sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{sort.key && <button type="button" className={button} onClick={() => setSort({ ...sort, desc: !sort.desc })} aria-label={sort.desc ? t('降序，点击切换升序', 'Descending, switch to ascending') : t('升序，点击切换降序', 'Ascending, switch to descending')}>{sort.desc ? <ArrowDown size={15} /> : <ArrowUp size={15} />}</button>}</div>
      {keys.isError && <div role="alert" className="py-4 text-sm text-destructive">{t('加载失败', 'Could not load keys')}: {errorText(keys.error)}</div>}
      {keys.isLoading ? <p className="py-4 text-sm text-muted-foreground">{t('加载中…', 'Loading…')}</p> : !keys.isError && !items.length ? <p className="py-4 text-sm text-muted-foreground">{t('暂无密钥。未签发密钥时，/v1 仅允许本机调用；远程访问需要先创建密钥。', 'No keys yet. Until a key is issued, /v1 only accepts local requests; create a key for remote access.')}</p> : null}
      {!!items.length && <><div className="hidden overflow-x-auto lg:block"><table className="w-full text-xs"><thead className="border-b border-border text-xs text-muted-foreground"><tr>{sortOptions.map(([key, label]) => heading(key, label))}<th scope="col" className="px-3 py-3 text-left font-medium">{t('操作', 'Actions')}</th></tr></thead><tbody>{items.map((item) => <tr key={item.key} className="border-b border-border last:border-0"><td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{item.key}</td><td className="max-w-44 break-all px-3 py-3">{item.name || '—'}</td><td className="px-3 py-3">{groupName(item)}</td><td className="px-3 py-3">{status(item)}</td><td className="px-3 py-3">{item.requests || 0}</td><td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatTime(item.created_at)}</td><td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatTime(item.last_used)}</td><td className="px-3 py-3"><button type="button" className={iconButton} onClick={() => showItem(item)} aria-label={`${t('密钥操作', 'Key actions')}: ${item.key}`}><Ellipsis size={17} /><span className="sr-only">{t('操作', 'Actions')}</span></button></td></tr>)}</tbody></table></div><div className="divide-y divide-border lg:hidden">{items.map((item) => <article key={item.key} className="py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-all font-mono text-sm font-medium">{item.key}</h3><p className="mt-1 break-all text-sm text-muted-foreground">{item.name || '—'}</p></div>{status(item)}</div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">{t('分组', 'Group')}</dt><dd className="mt-1 break-all">{groupName(item)}</dd></div><div><dt className="text-muted-foreground">{t('请求数', 'Requests')}</dt><dd className="mt-1">{item.requests || 0}</dd></div><div><dt className="text-muted-foreground">{t('创建时间', 'Created')}</dt><dd className="mt-1">{formatTime(item.created_at)}</dd></div><div><dt className="text-muted-foreground">{t('最近使用', 'Last used')}</dt><dd className="mt-1">{formatTime(item.last_used)}</dd></div></dl><button type="button" className={`${button} mt-3`} onClick={() => showItem(item)}>{t('密钥操作', 'Key actions')}</button></article>)}</div></>}
    </section>
    {selected && <KeyDialog item={selected} busy={busy} error={notice?.kind === 'error' ? notice.text : undefined} onClose={() => setSelected(null)} onToggle={() => mutate('toggle', selected)} onGroup={(value) => mutate('group', selected, value)} onDelete={() => mutate('delete', selected)} />}
  </div>;
}
