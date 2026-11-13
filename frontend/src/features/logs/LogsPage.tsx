import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowDown, ArrowUp, CircleAlert, ListFilter, Radio, RefreshCw, RotateCcw, Search, Trash2, Unplug, X } from 'lucide-react';
import { api } from '../../lib/api';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { useI18n } from '../../lib/i18n';
import { emptyFilters, filtersFromHash, filtersToHash, filtersToQuery, formatCost, logOutcome, observedValue, type LogEntry, type LogFilters } from './log-utils';

const inputClass = 'h-9 w-full rounded-lg border border-transparent bg-muted/70 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary';
const buttonClass = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-full bg-muted px-4 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';
type SortKey = 'time' | 'endpoint' | 'model' | 'stream' | 'status' | 'latency' | 'chars' | 'tokens' | 'cached' | 'cost' | 'account' | 'err';
type LogResponse = { logs?: LogEntry[] | null };

function numberText(value: number | undefined, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }).format(value ?? 0);
}
function timeText(seconds: number, locale: string): string {
  return seconds ? new Date(seconds * 1000).toLocaleString(locale) : '—';
}
function sortValue(log: LogEntry, key: SortKey): string | number | null {
  switch (key) {
    case 'time': return log.time || 0;
    case 'endpoint': return log.endpoint || '';
    case 'model': return log.model || '';
    case 'stream': return log.stream ? 1 : 0;
    case 'status': return log.status || 0;
    case 'latency': return log.latency_ms || 0;
    case 'chars': return (log.prompt_len || 0) + (log.output_len || 0);
    case 'tokens': {
      const input = observedValue(log.tokens_in, log.tokens_in_reported);
      const output = observedValue(log.tokens_out, log.tokens_out_reported);
      return input === null || output === null ? null : input + output;
    }
    case 'cached': return observedValue(log.cached_tokens, log.cached_tokens_known);
    case 'cost': return observedValue(log.cost, log.cost_known);
    case 'account': return log.account || '';
    case 'err': return log.err || '';
  }
}

export default function LogsPage() {
  const { lang, t } = useI18n();
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const client = useQueryClient();
  const [draft, setDraft] = useState<LogFilters>(() => filtersFromHash(window.location.hash));
  const [filters, setFilters] = useState<LogFilters>(() => filtersFromHash(window.location.hash));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'time', desc: true });
  const [detail, setDetail] = useState<LogEntry | null>(null);
  const [notice, setNotice] = useState(false);
  const [live, setLive] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters(draft), 250);
    return () => window.clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    if (window.location.hash.replace(/^#/, '').split('?')[0] !== 'logs') return;
    const next = filtersToHash(filters);
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }, [filters]);
  useEffect(() => {
    const restore = () => {
      if (window.location.hash.replace(/^#/, '').split('?')[0] !== 'logs') return;
      const next = filtersFromHash(window.location.hash);
      setDraft(next); setFilters(next);
    };
    window.addEventListener('hashchange', restore);
    return () => window.removeEventListener('hashchange', restore);
  }, []);

  const queryString = filtersToQuery(filters);
  const logs = useQuery({ queryKey: ['logs', queryString], queryFn: () => api<LogResponse>(`/admin/api/logs?${queryString}`) });
  useEffect(() => {
    if (!live) return;
    let timer: number | undefined;
    const sync = () => {
      if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
      const active = window.location.hash.replace(/^#/, '').split('?')[0] === 'logs';
      if (active && document.visibilityState === 'visible') timer = window.setInterval(() => void logs.refetch(), 5_000);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, [live, logs.refetch]);
  const clear = useMutation({
    mutationFn: () => api('/admin/api/logs', { method: 'DELETE' }),
    onSuccess: async () => { setNotice(true); setDetail(null); await client.invalidateQueries({ queryKey: ['logs'] }); },
  });
  const rows = useMemo(() => [...(logs.data?.logs || [])].sort((a, b) => {
    const left = sortValue(a, sort.key), right = sortValue(b, sort.key);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return sort.desc ? -order : order;
  }), [logs.data, sort]);
  const columns: { key: SortKey; label: string }[] = [
    { key: 'time', label: t('时间', 'Time') }, { key: 'endpoint', label: t('端点', 'Endpoint') },
    { key: 'model', label: t('模型', 'Model') }, { key: 'stream', label: t('流式', 'Stream') },
    { key: 'status', label: t('状态', 'Status') }, { key: 'latency', label: t('耗时', 'Latency') },
    { key: 'chars', label: t('字符 入 / 出', 'Chars in / out') }, { key: 'tokens', label: t('Token 入 / 出', 'Tokens in / out') },
    { key: 'cached', label: t('缓存 Token', 'Cached tokens') }, { key: 'cost', label: t('成本', 'Cost') },
    { key: 'account', label: t('账号', 'Account') }, { key: 'err', label: t('错误', 'Error') },
  ];
  const update = (key: keyof LogFilters, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const activeFilters = [draft.endpoint, draft.account, draft.min_status, draft.since, draft.limit !== '200' ? draft.limit : ''].filter(Boolean).length;
  const costText = (log: LogEntry) => formatCost(log.cost, log.cost_known, t('未知', 'Unknown'));
  const tokenText = (value: number | undefined, known?: boolean) => {
    const observed = observedValue(value, known);
    return observed === null ? t('未知', 'Unknown') : numberText(observed, locale);
  };
  const formatCached = (log: LogEntry) => {
    const value = observedValue(log.cached_tokens, log.cached_tokens_known);
    return value === null ? t('未知', 'Unknown') : numberText(value, locale);
  };
  const status = (log: LogEntry) => {
    const outcome = logOutcome(log);
    const label = outcome === 'client-gone' ? t('客户端断开', 'Client disconnected') : outcome === 'failed' ? t('失败', 'Failed') : t('成功', 'Succeeded');
    const colors = outcome === 'client-gone' ? 'text-amber-700 dark:text-amber-400' : outcome === 'failed' ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400';
    const dot = outcome === 'client-gone' ? 'bg-amber-500' : outcome === 'failed' ? 'bg-red-500' : 'bg-emerald-500';
    return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${colors}`}><span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />{log.status} · {label}</span>;
  };
  const err = logs.error || clear.error;
  const errorText = err instanceof Error ? err.message : String(err || '');
  const summaries = [
    { label: t('已返回', 'Returned'), value: rows.length, icon: Activity },
    { label: t('失败', 'Failed'), value: rows.filter(log => logOutcome(log) === 'failed').length, icon: CircleAlert },
    { label: t('客户端断开', 'Client disconnected'), value: rows.filter(log => logOutcome(log) === 'client-gone').length, icon: Unplug },
    { label: t('流式请求', 'Streamed'), value: rows.filter(log => log.stream).length, icon: Radio },
  ];
  const sortHead = (key: SortKey, label: string) => <th scope="col" className="whitespace-nowrap px-2 py-3 text-left font-normal" aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}><button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort(current => ({ key, desc: current.key === key ? !current.desc : false }))}>{label}{sort.key === key && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}</button></th>;
  const usageCell = (label: string, value: string) => <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/60 px-2 py-1 text-xs"><span className="truncate text-muted-foreground">{label}</span><span className="whitespace-nowrap tabular-nums">{value}</span></div>;
  const detailItem = (label: string, value: React.ReactNode) => <div className="min-w-0 rounded-lg bg-muted/45 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-normal tracking-tight">{t('请求日志', 'Request logs')}</h1><div className="flex flex-wrap gap-2"><label className="flex min-h-9 items-center gap-2 px-2 text-sm"><input type="checkbox" className="size-4 accent-current" checked={live} onChange={event => setLive(event.target.checked)} />{t('实时刷新（5 秒）', 'Live refresh (5 seconds)')}</label><button className={buttonClass} type="button" onClick={() => void logs.refetch()} disabled={logs.isFetching}><RefreshCw className="size-4" aria-hidden="true" />{t('刷新', 'Refresh')}</button><button className={`${buttonClass} text-destructive`} type="button" disabled={clear.isPending} onClick={() => { setNotice(false); returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setConfirmClear(true); }}><Trash2 className="size-4" aria-hidden="true" />{t('清空日志', 'Clear logs')}</button></div></div>
    {err && <div role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{t('操作失败：', 'Request failed: ')}{errorText}</div>}
    {notice && <div role="status" className="rounded-lg bg-muted/70 p-3 text-sm">{t('日志已清空。', 'Logs cleared.')}</div>}
    <section aria-label={t('当前返回结果', 'Currently returned results')}><div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{summaries.map(({ label, value, icon: Icon }) => <div key={label} className="min-w-0 rounded-lg bg-muted/60 p-4"><div className="flex items-start justify-between gap-2 text-xs text-muted-foreground"><span>{label}</span><Icon className="size-4 shrink-0" aria-hidden="true" /></div><p className="mt-3 text-2xl tabular-nums">{logs.data ? value.toLocaleString(locale) : '—'}</p></div>)}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('统计仅针对当前返回的记录。499 表示客户端断开，不计入失败；有错误信息的请求计入失败。', 'Counts cover only the returned entries. A 499 is a client disconnect, not a failure; requests with errors count as failures.')}</p></section>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><label className="relative min-w-[12rem] flex-1 sm:max-w-72"><span className="sr-only">{t('模型或错误关键字', 'Model or error keyword')}</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input className={`${inputClass} pl-9`} value={draft.q} onChange={e => update('q', e.target.value)} placeholder={t('搜索模型或错误', 'Search model or error')} /></label><button type="button" className={buttonClass} aria-expanded={filtersOpen} aria-controls="log-filters" onClick={() => setFiltersOpen(value => !value)}><ListFilter className="size-4" aria-hidden="true" />{t('筛选', 'Filters')}{activeFilters > 0 && <span className="text-xs text-muted-foreground">{activeFilters}</span>}</button><div className="ml-auto flex items-center gap-2"><label className="flex items-center gap-2 text-sm"><span className="sr-only">{t('排序', 'Sort')}</span><select className={`${inputClass} max-w-44`} value={sort.key} onChange={e => setSort({ key: e.target.value as SortKey, desc: false })}>{columns.map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</select></label><button type="button" className={`${buttonClass} !px-3`} aria-label={sort.desc ? t('降序，点击切换升序', 'Descending, switch to ascending') : t('升序，点击切换降序', 'Ascending, switch to descending')} onClick={() => setSort(current => ({ ...current, desc: !current.desc }))}>{sort.desc ? <ArrowDown className="size-4" aria-hidden="true" /> : <ArrowUp className="size-4" aria-hidden="true" />}</button></div></div>
      <form id="log-filters" className={`${filtersOpen ? 'grid' : 'hidden'} gap-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-2 xl:grid-cols-5`} onSubmit={event => { event.preventDefault(); setFilters(draft); }}>
        <label className="space-y-1.5 text-xs text-muted-foreground"><span>{t('端点', 'Endpoint')}</span><select className={inputClass} value={draft.endpoint} onChange={e => update('endpoint', e.target.value)}><option value="">{t('全部端点', 'All endpoints')}</option>{['chat', 'responses', 'messages', 'audio', 'theos', 'usage'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="space-y-1.5 text-xs text-muted-foreground"><span>{t('账号（精确匹配）', 'Account (exact match)')}</span><input className={inputClass} value={draft.account} onChange={e => update('account', e.target.value)} /></label>
        <label className="space-y-1.5 text-xs text-muted-foreground"><span>{t('最低状态码', 'Minimum status')}</span><input className={inputClass} type="number" min="100" max="599" value={draft.min_status} onChange={e => update('min_status', e.target.value)} placeholder="400" /></label>
        <label className="space-y-1.5 text-xs text-muted-foreground"><span>{t('起始时间', 'From time')}</span><input className={inputClass} type="datetime-local" value={draft.since} onChange={e => update('since', e.target.value)} /></label>
        <label className="space-y-1.5 text-xs text-muted-foreground"><span>{t('最多返回条数', 'Maximum results')}</span><input className={inputClass} type="number" min="1" step="1" value={draft.limit} onChange={e => update('limit', e.target.value)} /></label>
        <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-5"><button className={`${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`} type="submit">{t('筛选', 'Apply')}</button><button className={buttonClass} type="button" onClick={() => { const next = { ...emptyFilters }; setDraft(next); setFilters(next); }}><RotateCcw className="size-4" aria-hidden="true" />{t('重置筛选', 'Reset filters')}</button></div>
      </form>
      <p className="text-xs leading-5 text-muted-foreground">{t('默认最多 200 条。查询限于当前日志文件尾部最多 4 MiB；轮转文件不在查询范围内。', 'Default: up to 200 entries. Queries scan at most the last 4 MiB of the current log file; rotated files are excluded.')}</p>
    </div>
    {logs.isLoading ? <p className="py-5 text-sm text-muted-foreground">{t('加载中…', 'Loading…')}</p> : !rows.length ? <p className="py-5 text-sm text-muted-foreground">{t('没有符合条件的日志。', 'No matching logs.')}</p> : <>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[920px] text-left text-xs"><thead className="border-b border-border text-muted-foreground"><tr>{sortHead('model', t('模型 / 端点', 'Model / endpoint'))}{sortHead('account', t('账号', 'Account'))}{sortHead('cost', t('成本', 'Cost'))}{sortHead('tokens', t('用量', 'Usage'))}{sortHead('status', t('状态', 'Status'))}{sortHead('latency', t('耗时', 'Latency'))}{sortHead('time', t('时间', 'Time'))}<th scope="col"><span className="sr-only">{t('详情', 'Details')}</span></th></tr></thead><tbody className="divide-y divide-border">{rows.map((log, index) => <tr key={`${log.time}-${index}`} className="align-top"><td className="px-2 py-4"><button type="button" className="break-all text-left font-medium hover:underline" onClick={() => setDetail(log)}>{log.model || '—'}</button><p className="mt-1 text-muted-foreground">{log.endpoint || '—'}</p></td><td className="max-w-40 break-all px-2 py-4 text-muted-foreground">{log.account || '—'}</td><td className="whitespace-nowrap px-2 py-4 tabular-nums">{costText(log)}</td><td className="min-w-48 px-2 py-3"><div className="grid grid-cols-2 gap-1">{usageCell(t('输入', 'In'), tokenText(log.tokens_in, log.tokens_in_reported))}{usageCell(t('输出', 'Out'), tokenText(log.tokens_out, log.tokens_out_reported))}{usageCell(t('缓存', 'Cached'), formatCached(log))}{usageCell(t('字符 入/出', 'Chars in/out'), `${numberText(log.prompt_len, locale)} / ${numberText(log.output_len, locale)}`)}</div></td><td className="px-2 py-4">{status(log)}<p className="mt-1 text-muted-foreground">{log.stream ? t('流式', 'Streaming') : t('非流式', 'Non-streaming')}</p>{log.err && <p className="mt-1 max-w-40 truncate text-destructive" title={log.err}>{log.err}</p>}</td><td className="whitespace-nowrap px-2 py-4 tabular-nums">{log.latency_ms ?? 0} ms</td><td className="whitespace-nowrap px-2 py-4 text-muted-foreground">{timeText(log.time, locale)}</td><td className="px-2 py-4"><button type="button" className="whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline" onClick={() => setDetail(log)}>{t('详情', 'Details')}</button></td></tr>)}</tbody></table></div>
      <div className="divide-y divide-border lg:hidden">{rows.map((log, index) => <article className="space-y-3 py-4" key={`${log.time}-${index}`}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><button type="button" className="break-all text-left font-medium hover:underline" onClick={() => setDetail(log)}>{log.model || '—'}</button><p className="mt-1 text-xs text-muted-foreground">{timeText(log.time, locale)} · {log.endpoint || '—'}</p></div>{status(log)}</div><dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><div><dt className="text-muted-foreground">{t('账号', 'Account')}</dt><dd className="break-all">{log.account || '—'}</dd></div><div><dt className="text-muted-foreground">{t('耗时 / 流式', 'Latency / stream')}</dt><dd>{log.latency_ms ?? 0} ms / {log.stream ? t('是', 'Yes') : t('否', 'No')}</dd></div><div><dt className="text-muted-foreground">{t('字符 入 / 出', 'Chars in / out')}</dt><dd>{numberText(log.prompt_len, locale)} / {numberText(log.output_len, locale)}</dd></div><div><dt className="text-muted-foreground">{t('Token 入 / 出', 'Tokens in / out')}</dt><dd>{tokenText(log.tokens_in, log.tokens_in_reported)} / {tokenText(log.tokens_out, log.tokens_out_reported)}</dd></div><div><dt className="text-muted-foreground">{t('缓存 Token', 'Cached tokens')}</dt><dd>{formatCached(log)}</dd></div><div><dt className="text-muted-foreground">{t('成本', 'Cost')}</dt><dd>{costText(log)}</dd></div></dl>{log.err && <p className="break-words text-sm text-destructive">{log.err}</p>}<button type="button" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setDetail(log)}>{t('查看详情', 'View details')}</button></article>)}</div>
    </>}
    <ConfirmDialog open={confirmClear} onOpenChange={setConfirmClear} returnFocus={returnFocus} title={t('清空日志', 'Clear logs')} description={t('此操作无法撤销。', 'This cannot be undone.')} confirmLabel={t('清空日志', 'Clear logs')} onConfirm={() => clear.mutate()} />
    <Dialog.Root open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90vh] overflow-y-auto rounded-t-xl bg-background p-5 shadow-xl focus:outline-none md:bottom-auto md:left-1/2 md:top-1/2 md:w-[min(48rem,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl"><div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-base font-medium">{t('请求详情', 'Request details')}</Dialog.Title><Dialog.Description className="mt-1 text-xs text-muted-foreground">{detail && <>{timeText(detail.time, locale)} · {detail.endpoint || '—'}</>}</Dialog.Description></div><Dialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t('关闭', 'Close')}><X className="size-4" /></Dialog.Close></div>{detail && <dl className="mt-6 grid gap-2 sm:grid-cols-2">{detailItem(t('模型', 'Model'), detail.model || '—')}{detailItem(t('账号', 'Account'), detail.account || '—')}{detailItem(t('状态', 'Status'), status(detail))}{detailItem(t('流式', 'Stream'), detail.stream ? t('是', 'Yes') : t('否', 'No'))}{detailItem(t('耗时', 'Latency'), `${detail.latency_ms ?? 0} ms`)}{detailItem(t('成本', 'Cost'), costText(detail))}{detailItem(t('Token 入 / 出', 'Tokens in / out'), `${tokenText(detail.tokens_in, detail.tokens_in_reported)} / ${tokenText(detail.tokens_out, detail.tokens_out_reported)}`)}{detailItem(t('缓存 Token', 'Cached tokens'), formatCached(detail))}{detailItem(t('字符 入 / 出', 'Chars in / out'), `${numberText(detail.prompt_len, locale)} / ${numberText(detail.output_len, locale)}`)}{detail.err && detailItem(t('错误', 'Error'), detail.err)}</dl>}</Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
