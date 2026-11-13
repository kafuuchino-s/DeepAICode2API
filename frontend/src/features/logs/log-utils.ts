export type LogEntry = {
  time: number;
  endpoint?: string;
  account?: string;
  model?: string;
  stream?: boolean;
  status: number;
  latency_ms?: number;
  prompt_len?: number;
  output_len?: number;
  tokens_in?: number;
  tokens_out?: number;
  tokens_in_reported?: boolean;
  tokens_out_reported?: boolean;
  cached_tokens?: number;
  cost?: number;
  cached_tokens_known?: boolean;
  cost_known?: boolean;
  err?: string;
};

export type LogFilters = {
  endpoint: string;
  account: string;
  min_status: string;
  q: string;
  since: string;
  limit: string;
};

export const emptyFilters: LogFilters = {
  endpoint: '', account: '', min_status: '', q: '', since: '', limit: '200',
};

// 旧链接的 limit=0 在后端也表示默认 200，不表示全部。
export function filtersFromHash(hash: string): LogFilters {
  const [tab, query = ''] = hash.replace(/^#/, '').split('?', 2);
  if (tab !== 'logs') return { ...emptyFilters };
  const params = new URLSearchParams(query);
  const limit = Number(params.get('limit'));
  return {
    endpoint: params.get('endpoint') || '',
    account: params.get('account') || '',
    min_status: params.get('min_status') || '',
    q: params.get('q') || '',
    since: params.get('since') || '',
    limit: Number.isInteger(limit) && limit > 0 ? String(limit) : '200',
  };
}

export function filtersToHash(filters: LogFilters): string {
  const params = new URLSearchParams();
  for (const key of ['endpoint', 'account', 'min_status', 'q', 'since', 'limit'] as const) {
    const value = filters[key].trim();
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return '#logs' + (query ? `?${query}` : '');
}

export function filtersToQuery(filters: LogFilters): string {
  const params = new URLSearchParams();
  const limit = Number(filters.limit);
  params.set('limit', Number.isInteger(limit) && limit > 0 ? String(limit) : '200');
  for (const key of ['endpoint', 'account', 'min_status', 'q'] as const) {
    const value = filters[key].trim();
    if (value) params.set(key, value);
  }
  if (filters.since) {
    const seconds = Math.floor(new Date(filters.since).getTime() / 1000);
    if (Number.isFinite(seconds) && seconds > 0) params.set('since', String(seconds));
  }
  return params.toString();
}

// 历史值没有 presence 标识；只有非零值可确认。
export function observedValue(value: number | undefined, known?: boolean): number | null {
  if (known === true) return value ?? 0; // cached_tokens 为零时可能被 omitempty 省略
  if (known === false) return null;
  return typeof value === 'number' && Number.isFinite(value) && value !== 0 ? value : null;
}

export function formatCost(value: number | undefined, known: boolean | undefined, unknown: string): string {
  const observed = observedValue(value, known);
  if (observed === null) return unknown;
  return `$${observed === 0 ? observed.toFixed(6) : String(observed)}`;
}

export function logOutcome(entry: Pick<LogEntry, 'status' | 'err'>): 'client-gone' | 'failed' | 'success' {
  if (entry.status === 499) return 'client-gone';
  return entry.status >= 400 || !!entry.err ? 'failed' : 'success';
}
