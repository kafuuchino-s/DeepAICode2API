import { getLang } from './i18n';

const PASSWORD_KEY = 'deepaicode2api_pw';
const inflight = new Map<string, Promise<unknown>>();
const englishErrors: Record<string, string> = {
  setup_required: 'Gateway has no API keys yet — create one in the console first',
  invalid_request_error: 'Request rejected by the gateway',
  upstream_error: 'Upstream request failed', server_error: 'Internal gateway error',
  rate_limit_error: 'Rate limited — please retry later',
  email_unverified: 'All accounts need email verification upstream',
  social_login_required: 'Upstream now requires Google/Apple sign-in',
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public detail = message, public type = '') {
    super(message);
    this.name = 'ApiError';
  }
}
export function password(): string {
  try { return (sessionStorage.getItem(PASSWORD_KEY) || '').trim(); } catch { return ''; }
}
export function setPassword(value: string): void {
  try { sessionStorage.setItem(PASSWORD_KEY, value); } catch { /* Storage may be unavailable. */ }
}
export function clearPassword(): void {
  try { sessionStorage.removeItem(PASSWORD_KEY); } catch { /* Storage may be unavailable. */ }
}

export function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const secret = password();
  const key = method + ' ' + path + '\0' + secret;
  const existing = method === 'GET' ? inflight.get(key) : undefined;
  if (existing) return existing as Promise<T>;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), method === 'GET' ? 15_000 : 90_000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Admin-Password'] = secret;
  const handleResponse = ({ response, text }: { response: Response; text: string }): T => {
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* Keep plain-text error details. */ }
    if (!response.ok) {
      if (response.status === 401) {
        clearPassword();
        if (location.pathname !== '/login') location.replace('/login' + location.hash);
      }
      const detail = json?.error?.message || text || 'HTTP ' + response.status;
      const type = json?.error?.type || '';
      const message = getLang() === 'en' ? (englishErrors[type] || 'Request failed') + ' (HTTP ' + response.status + ')' : detail;
      throw new ApiError(message, response.status, detail, type);
    }
    return json as T;
  };
  let responseStatus: number | undefined;
  const fetchOnce = async (body: string | undefined) => {
    responseStatus = undefined;
    const response = await fetch(path, { method, headers, signal: controller.signal, body });
    responseStatus = response.status;
    return { response, text: await response.text() };
  };
  const waitToRetry = () => new Promise<void>((resolve, reject) => {
    if (controller.signal.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    const abort = () => { window.clearTimeout(retryTimer); reject(new DOMException('aborted', 'AbortError')); };
    const retryTimer = window.setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, 300);
    controller.signal.addEventListener('abort', abort, { once: true });
  });
  const request = (async () => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    let result: Awaited<ReturnType<typeof fetchOnce>>;
    try {
      result = await fetchOnce(body);
    } catch (error) {
      if (method !== 'GET' || controller.signal.aborted || (error as Error)?.name === 'AbortError' || (responseStatus !== undefined && responseStatus >= 400 && responseStatus < 500)) throw error;
      await waitToRetry();
      return handleResponse(await fetchOnce(body));
    }
    if (method === 'GET' && result.response.status >= 500 && result.response.status <= 599) {
      await waitToRetry();
      result = await fetchOnce(body);
    }
    return handleResponse(result);
  })().catch(error => {
    if (error?.name === 'AbortError') throw new ApiError(getLang() === 'en' ? 'Request timed out' : '请求超时（服务端未在限定时间内响应）', 0);
    throw error;
  }).finally(() => { window.clearTimeout(timer); });
  if (method === 'GET') {
    inflight.set(key, request);
    const done = () => { if (inflight.get(key) === request) inflight.delete(key); };
    void request.then(done, done);
  }
  return request;
}
