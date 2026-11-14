import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, CircleAlert, Database, UsersRound } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { cacheRate, reportedValue, summarize, type Trend, type TrendDay } from './overview-utils';

type Stats = {
  total_requests: number; failed_requests: number; total_tokens_in: number; total_tokens_out: number;
  total_cost: number; total_chars_out: number; day?: string; day_tokens_in?: number; day_tokens_out?: number;
  started_at: number; reset_at?: number;
};
type Latency = { p50_ms?: number; p95_ms?: number; p99_ms?: number };
type Checkin = { attempts?: number; blocked?: number; timeouts?: number; p50_ms?: number; p95_ms?: number };
type UpstreamError = { path: string; code: string; status: number; count: number };
type Overview = { accounts: number; ready: number; stats: Stats; default_model?: string; models_updated?: number;
  latency?: Latency; latency_by_endpoint?: Record<string, Latency> | null; checkin?: Checkin;
  fallback_total?: number; upstream_errors?: UpstreamError[] | null };
type Health = { degraded: number; blocked: number; quota_fresh: number; quota_due: number };
type Model = { id: string; name?: string; free?: boolean; api?: string; contextWindow?: number };
type Models = { models: Model[] | null; default_model?: string; models_updated?: number };

const card = 'rounded-lg bg-card';
const quietButton = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function PanelTitle({ title, detail, action }: { title: string; detail?: ReactNode; action?: ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold tracking-tight">{title}</h2>{detail && <p className="mt-1 text-sm leading-5 text-muted-foreground">{detail}</p>}</div>{action}</div>;
}

function StatCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: ReactNode; icon: typeof Activity }) {
  return <div className={`${card} min-w-0 p-4 sm:p-5`}><div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{label}</p><Icon size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" /></div><p className="mt-3 break-words text-2xl font-normal tracking-tight tabular-nums">{value}</p><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{detail}</p></div>;
}

function ProcessMetrics({ data, loading, format }: { data?: Overview; loading: boolean; format: (n: number) => string }) {
  const { t } = useI18n();
  const ms = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${format(value)} ms` : '—';
  const count = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? format(value) : '—';
  const available = !!data && (data.latency !== undefined || data.checkin !== undefined || data.fallback_total !== undefined || data.upstream_errors !== undefined || data.latency_by_endpoint !== undefined);
  const endpoints = Object.entries(data?.latency_by_endpoint || {});
  const latency = data?.latency;
  const checkin = data?.checkin;
  return <section className={`${card} min-w-0 p-4 sm:p-5`} aria-label={t('进程运行指标', 'Process metrics')}>
    <PanelTitle title={t('进程运行指标', 'Process metrics')} detail={t('当前进程期间的直方图分桶估计，重启后重置；— 表示暂无样本或数据不可用。', 'Histogram bucket estimates for the current process; reset on restart. — means no samples or data unavailable.')} />
    {loading ? <p className="mt-5 text-sm text-muted-foreground">{t('正在加载运行指标…', 'Loading process metrics…')}</p> : !available ? <p className="mt-5 text-sm text-muted-foreground">{t('当前服务未提供运行指标。', 'Process metrics are unavailable from this server.')}</p> : <>
      <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <div><h3 className="text-sm font-medium">{t('请求耗时', 'Request latency')}</h3><p className="mt-2 text-xs text-muted-foreground">P50 / P95 / P99</p><p className="mt-1 text-sm tabular-nums">{ms(latency?.p50_ms)} / {ms(latency?.p95_ms)} / {ms(latency?.p99_ms)}</p></div>
        <div><h3 className="text-sm font-medium">{t('签到等待', 'Check-in wait')}</h3><p className="mt-2 text-xs text-muted-foreground">P50 / P95</p><p className="mt-1 text-sm tabular-nums">{ms(checkin?.p50_ms)} / {ms(checkin?.p95_ms)}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t('尝试', 'Attempts')} {count(checkin?.attempts)} · {t('阻塞', 'Blocked')} {count(checkin?.blocked)} · {t('超时', 'Timeouts')} {count(checkin?.timeouts)}</p></div>
        <div><h3 className="text-sm font-medium">{t('请求形状兜底', 'Request shape fallbacks')}</h3><p className="mt-2 text-lg tabular-nums">{count(data?.fallback_total)}</p></div>
      </div>
      <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-2">
        <div className="min-w-0"><h3 className="text-sm font-medium">{t('按端点的耗时', 'Latency by endpoint')}</h3><p className="mt-1 text-xs text-muted-foreground">P50 / P95 / P99</p>{endpoints.length ? <dl className="mt-2 divide-y divide-border">{endpoints.map(([endpoint, item]) => <div key={endpoint} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><dt className="break-all text-muted-foreground">{endpoint}</dt><dd className="tabular-nums">{ms(item.p50_ms)} / {ms(item.p95_ms)} / {ms(item.p99_ms)}</dd></div>)}</dl> : <p className="mt-2 text-sm text-muted-foreground">{data?.latency_by_endpoint == null ? t('数据不可用。', 'Data unavailable.') : t('暂无端点样本。', 'No endpoint samples yet.')}</p>}</div>
        <div className="min-w-0"><h3 className="text-sm font-medium">{t('上游错误', 'Upstream errors')}</h3>{data?.upstream_errors?.length ? <ul className="mt-2 divide-y divide-border">{data.upstream_errors.map((error, index) => <li key={`${error.path}-${error.code}-${error.status}-${index}`} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className="min-w-0 break-all text-muted-foreground">{error.path} · {error.code} · {error.status}</span><span className="tabular-nums">{count(error.count)}</span></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">{data?.upstream_errors == null ? t('数据不可用。', 'Data unavailable.') : t('暂无上游错误。', 'No upstream errors yet.')}</p>}<p className="mt-2 text-xs text-muted-foreground">{t('最多显示数量最多的 8 类。', 'Up to the 8 most frequent categories are shown.')}</p></div>
      </div>
    </>}
  </section>;
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
  const day = payload[0].payload as TrendDay;
  return <div className="rounded-lg border border-border bg-background p-3 text-xs shadow-sm">
    <p className="font-medium">{day.date}{day.partial ? ' *' : ''}</p>
    <p className="mt-1">{t('请求', 'Requests')}: {day.requests.toLocaleString()}</p>
    <p>{t('失败', 'Failed')}: {day.failed.toLocaleString()}</p>
  </div>;
}

function RequestChart({ days }: { days: TrendDay[] }) {
  const { t } = useI18n();
  if (!days.length) return <div className="grid h-56 place-items-center text-sm text-muted-foreground">{t('此时间范围内暂无覆盖数据。', 'No coverage in this date range.')}</div>;
  const peak = Math.max(1, ...days.map(d => Math.max(d.requests, d.failed)));
  return <div className="mt-5">
    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{t('每日请求', 'Requests per day')}</span><span>{t('最高', 'Peak')} {peak}</span></div>
    <div className="mt-2 h-48 w-full" role="img" aria-label={t('按 UTC 日期的请求与失败趋势，详细数据可在下方展开。', 'Daily requests and failures in UTC; expand the details below for values.')}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={days} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Line type="linear" dataKey="requests" stroke="hsl(var(--foreground))" strokeWidth={2} dot={days.length === 1} isAnimationActive={false} />
          <Line type="linear" dataKey="failed" stroke="hsl(var(--destructive))" strokeWidth={1.5} dot={days.length === 1} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="h-0.5 w-4 bg-foreground" />{t('请求', 'Requests')}</span><span className="flex items-center gap-2"><span className="h-0.5 w-4 bg-destructive" />{t('失败', 'Failed')}</span><span>{t('* 日期未完全覆盖', '* Partial day')}</span></div>
  </div>;
}

function DailyDetails({ days, format }: { days: TrendDay[]; format: (n: number) => string }) {
  const { t } = useI18n();
  if (!days.length) return null;
  return <details className="mt-4 border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium">{t('查看每日数据', 'View daily data')}</summary><div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-border">{[...days].reverse().map(day => <div key={day.date} className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 text-sm last:border-0 sm:grid-cols-4"><span className="font-medium tabular-nums">{day.date}{day.partial ? ' *' : ''}</span><span>{t('请求', 'Requests')} <b className="font-medium tabular-nums">{format(day.requests)}</b></span><span className="text-muted-foreground">{t('失败', 'Failed')} {format(day.failed)}</span><span className="text-muted-foreground">499 {format(day.client_gone)}</span></div>)}</div></details>;
}

export default function OverviewPage() {
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState(30);
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const format = (n: number) => new Intl.NumberFormat(locale).format(n);
  const money = (n: number) => n !== 0 && Math.abs(n) < 0.00000001 ? `$${n.toExponential(2)}` : `$${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(n)}`;
  const gatewayCost = (n: number) => n !== 0 && (Math.abs(n) < 0.00000001 || Math.abs(n) >= 1e9) ? n.toExponential() : new Intl.NumberFormat(locale, { maximumSignificantDigits: 12 }).format(n);
  const date = (timestamp?: number) => timestamp ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(timestamp * 1000) + ' UTC' : '—';
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/admin/api/overview'), refetchInterval: 30_000 });
  // Shell 通过同一 query key 每 20 秒刷新健康状态；此处只订阅缓存。
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health'), staleTime: 20_000, retry: false });
  const models = useQuery({ queryKey: ['models'], queryFn: () => api<Models>('/admin/api/models'), refetchInterval: 60_000 });
  const trend = useQuery({ queryKey: ['stats-trend', period], queryFn: () => api<Trend>(`/admin/api/stats?trend=days&days=${period}`), refetchInterval: 30_000, retry: false });
  const data = overview.data;
  const stats = data?.stats;
  const days = trend.data?.days ?? [];
  const totals = summarize(days);
  const ready = data ? `${format(data.ready)} / ${format(data.accounts)}` : '—';
  const observed = (n: number) => t(`${format(n)} / ${format(totals.requests)} 次请求有上报`, `${format(n)} of ${format(totals.requests)} requests reported`);
  const legacyStart = stats?.reset_at || stats?.started_at;
  const modelList = models.data?.models ?? [];
  const defaultModel = models.data?.default_model || data?.default_model;
  return <div className="space-y-6">
    <header><h1 className="text-xl font-medium tracking-tight">{t('概览', 'Overview')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('查看网关运行状态与实际记录的用量。', 'A view of gateway health and recorded usage.')}</p></header>
    {overview.isError && <div role="alert" className={`${card} p-4 text-sm text-destructive`}>{t('无法加载概览：', 'Could not load overview: ')}{overview.error instanceof Error ? overview.error.message : ''} <button className="underline" onClick={() => void overview.refetch()}>{t('重试', 'Retry')}</button></div>}
    {overview.isPending && <p role="status" className="text-sm text-muted-foreground">{t('正在加载概览…', 'Loading overview…')}</p>}
    <section aria-label={t('累计统计', 'Lifetime statistics')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label={t('累计请求', 'Total requests')} value={stats ? format(stats.total_requests) : '—'} detail={t('已记录的 API 请求', 'Recorded API requests')} icon={Activity} />
      <StatCard label={t('累计失败', 'Failed requests')} value={stats ? format(stats.failed_requests) : '—'} detail={t('不含客户端中断（499）', 'Excludes client disconnects (499)')} icon={CircleAlert} />
      <StatCard label={t('累计 Token 入 / 出', 'Total tokens in / out')} value={stats ? `${format(stats.total_tokens_in)} / ${format(stats.total_tokens_out)}` : '—'} detail={t('已记录值；上游上报覆盖未知', 'Recorded values; upstream reporting coverage unknown')} icon={Database} />
      <StatCard label={t('就绪账号 / 总数', 'Ready accounts / total')} value={ready} detail={t('可用于调度的账号', 'Accounts available for scheduling')} icon={UsersRound} />
    </section>
    {stats && <div className="-mt-3 space-y-1 text-xs leading-5 text-muted-foreground"><p>{t('累计统计自', 'Cumulative statistics since')} {date(legacyStart)} · {t('累计已记录费用', 'Cumulative reported cost')} {stats.total_cost !== 0 ? money(stats.total_cost) : '—'} · {t('输出字符', 'Output characters')} {format(stats.total_chars_out)}</p><p>{t('本地日期', 'Local date')} {stats.day || '—'} · {t('今日已记录 Token 入 / 出', 'Today’s recorded tokens in / out')} {stats.day_tokens_in ? format(stats.day_tokens_in) : '—'} / {stats.day_tokens_out ? format(stats.day_tokens_out) : '—'} · {t('历史上报覆盖未知', 'Historical reporting coverage unknown')}</p></div>}

    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <section className={`${card} min-w-0 p-4 sm:p-5`}>
        <PanelTitle title={t('请求趋势', 'Request activity')} detail={t('按请求完成时间归入 UTC 日期。', 'Grouped by completion date in UTC.')} action={<div className="flex rounded-md border border-border p-0.5" role="group" aria-label={t('趋势时间范围', 'Trend period')}>{[7, 30, 90].map(n => <button key={n} type="button" aria-pressed={period === n} onClick={() => setPeriod(n)} className={`min-h-8 rounded px-2.5 text-xs font-medium ${period === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t(`${n} 天`, `${n}d`)}</button>)}</div>} />
        {trend.isPending ? <div role="status" className="grid h-56 place-items-center text-sm text-muted-foreground">{t('正在加载趋势…', 'Loading activity…')}</div> : trend.isError ? <div role="alert" className="mt-5 rounded-lg border border-border p-4 text-sm text-destructive">{t('无法加载趋势数据。', 'Could not load activity data.')} <button className="underline" onClick={() => void trend.refetch()}>{t('重试', 'Retry')}</button></div> : <><RequestChart days={days} /><div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4"><div><p className="text-xs text-muted-foreground">{t('请求', 'Requests')}</p><p className="mt-1 text-lg font-semibold tabular-nums">{format(totals.requests)}</p></div><div><p className="text-xs text-muted-foreground">{t('失败', 'Failed')}</p><p className="mt-1 text-lg font-semibold tabular-nums">{format(totals.failed)}</p></div><div><p className="text-xs text-muted-foreground">{t('客户端中断', 'Client gone')} · 499</p><p className="mt-1 text-lg font-semibold tabular-nums">{format(totals.clientGone)}</p></div></div><DailyDetails days={days} format={format} /></>}
      </section>
      <section className={`${card} min-w-0 p-4 sm:p-5`}>
        <PanelTitle title={t('账号状态', 'Account health')} detail={t('按当前账号池状态统计。', 'Current account pool status.')} action={<a href="#accounts" className="inline-flex items-center gap-1 text-sm font-medium hover:underline">{t('管理', 'Manage')} <ArrowRight size={15} aria-hidden="true" /></a>} />
        <div className="mt-6"><p className="text-3xl font-semibold tracking-tight tabular-nums">{ready}</p><p className="mt-1 text-sm text-muted-foreground">{t('就绪 / 账号总数', 'Ready / total accounts')}</p></div>
        {health.isError ? <p role="alert" className="mt-6 text-sm text-destructive">{t('无法加载账号健康状态。', 'Could not load account health.')} <button className="underline" onClick={() => void health.refetch()}>{t('重试', 'Retry')}</button></p> : <dl className="mt-6 divide-y divide-border text-sm">{[[t('近期失败', 'Recently failed'), health.data?.degraded], [t('受限', 'Blocked'), health.data?.blocked], [t('额度待刷新', 'Quota refresh due'), health.data?.quota_due], [t('额度已更新', 'Quota fresh'), health.data?.quota_fresh]].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{typeof value === 'number' ? format(value) : '—'}</dd></div>)}</dl>}
      </section>
    </div>

    <ProcessMetrics data={data} loading={overview.isPending} format={format} />

    <section className={`${card} p-4 sm:p-5`}>
      <PanelTitle title={t('已观察用量', 'Observed usage')} detail={t(`所选 ${period} 天内，上游实际提供的数据。`, `Values supplied by upstream during the selected ${period} days.`)} />
      {trend.data ? <><div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <div className="min-w-0"><p className="text-sm text-muted-foreground">{t('输入 Token', 'Input tokens')}</p><p className="mt-2 text-xl font-semibold tabular-nums">{reportedValue(totals.tokensIn, totals.inputReported, format)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{observed(totals.inputReported)}</p></div>
        <div className="min-w-0"><p className="text-sm text-muted-foreground">{t('输出 Token', 'Output tokens')}</p><p className="mt-2 text-xl font-semibold tabular-nums">{reportedValue(totals.tokensOut, totals.outputReported, format)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{observed(totals.outputReported)}</p></div>
        <div className="min-w-0"><p className="text-sm text-muted-foreground">{t('缓存 Token', 'Cached tokens')}</p><p className="mt-2 text-xl font-semibold tabular-nums">{reportedValue(totals.cachedTokens, totals.cacheReported, format)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{observed(totals.cacheReported)}</p></div>
        <div className="min-w-0"><p className="text-sm text-muted-foreground">{t('缓存命中率', 'Cache hit rate')}</p><p className="mt-2 text-xl font-semibold tabular-nums">{cacheRate(totals.pairedCached, totals.pairedInput, totals.paired)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t(`${format(totals.paired)} 次同时上报缓存与输入`, `${format(totals.paired)} reported both cache and input`)}</p></div>
        <div className="min-w-0"><p className="text-sm text-muted-foreground">{t('上游已上报费用', 'Reported upstream cost')}</p><p className="mt-2 text-xl font-semibold tabular-nums">{reportedValue(totals.cost, totals.costReported, money)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{observed(totals.costReported)}</p></div>
        <div className="min-w-0"><p className="text-sm text-muted-foreground">{t('上游网关成本', 'Upstream gateway cost')}</p><p className="mt-2 break-all text-xl font-semibold tabular-nums">{reportedValue(totals.gatewayCost, totals.gatewayCostReported, gatewayCost)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t(`${format(totals.gatewayCostReported)} / ${format(totals.requests)} 次请求已记录 · 单位未确认`, `${format(totals.gatewayCostReported)} of ${format(totals.requests)} requests recorded · Unit unconfirmed`)}</p></div>
      </div><div className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground"><p>{t('覆盖起点：', 'Coverage begins: ')}{date(trend.data.started_at)} · {t(`当前范围覆盖 ${days.length} 个 UTC 日期`, `${days.length} UTC dates covered in this range`)}</p><p className="mt-1">{t('范围为网关请求日志中已记录的请求；499 计入请求总数但不计入失败。缺失的上游字段不计作零；费用仅为已上报部分。', 'Counts cover API requests recorded by the gateway. A 499 counts as a request but not a failure. Missing upstream fields are not zero; cost includes reported values only.')}</p><p className="mt-1">{t('每日汇总与累计统计按现有周期保存；异常退出可能丢失最近未保存的数据。', 'Daily and cumulative statistics are saved periodically; an unexpected shutdown can lose unsaved data.')}</p></div></> : <p className="mt-5 text-sm text-muted-foreground">{trend.isError ? t('趋势数据不可用。', 'Activity data unavailable.') : t('正在加载用量…', 'Loading usage…')}</p>}
    </section>

    <section className={`${card} p-4 sm:p-5`}>
      <PanelTitle title={t('模型目录', 'Model catalog')} detail={t('查看默认模型及当前可用目录。', 'Default model and the current catalog.')} action={<a href="#models" className={quietButton}>{t('查看全部', 'View all')} <ArrowRight size={15} aria-hidden="true" /></a>} />
      {models.isError ? <p role="alert" className="mt-5 text-sm text-destructive">{t('无法加载模型目录。', 'Could not load the model catalog.')} <button className="underline" onClick={() => void models.refetch()}>{t('重试', 'Retry')}</button></p> : models.isPending ? <p role="status" className="mt-5 text-sm text-muted-foreground">{t('正在加载模型…', 'Loading models…')}</p> : <><div className="mt-5 grid gap-4 border-b border-border pb-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">{t('默认模型', 'Default model')}</p><p className="mt-1 break-all text-sm font-medium">{defaultModel || '—'}</p></div><div><p className="text-xs text-muted-foreground">{t('目录模型', 'Catalog models')}</p><p className="mt-1 text-sm font-medium tabular-nums">{format(modelList.length)}</p></div><div><p className="text-xs text-muted-foreground">{t('更新时间', 'Last updated')}</p><p className="mt-1 text-sm font-medium">{date(models.data?.models_updated || data?.models_updated)}</p></div></div>
        {!modelList.length ? <p className="py-5 text-sm text-muted-foreground">{t('暂无模型。', 'No models available.')}</p> : <ul className="divide-y divide-border">{modelList.slice(0, 5).map(model => <li key={model.id} className="flex min-w-0 items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{model.name || model.id}</p><p className="truncate text-xs text-muted-foreground">{model.id}</p></div><div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{typeof model.free === 'boolean' && <span className="rounded-md bg-muted px-2 py-1">{model.free ? t('免费', 'Free') : t('付费', 'Paid')}</span>}<span className="hidden sm:inline">{model.contextWindow ? format(model.contextWindow) : '—'} {t('上下文', 'context')}</span></div></li>)}</ul>}</>}
    </section>
  </div>;
}
