import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/lib/api';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('admin API', () => {
  it('deduplicates identical GETs until the request finishes', async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const first = api('/admin/api/state');
    const second = api('/admin/api/state');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(json({ ok: true }));
    expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
    const third = api('/admin/api/state');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finish(json({ ok: true }));
    await third;
  });

  it('reads the current tab password for each request and serializes objects', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.setItem('deepaicode2api_pw', 'first');
    await api('/admin/api/settings', { method: 'POST', body: { admin_password: 'next' } });
    sessionStorage.setItem('deepaicode2api_pw', 'next');
    await api('/admin/api/settings');
    expect(fetchMock.mock.calls[0][1].headers['X-Admin-Password']).toBe('first');
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ admin_password: 'next' }));
    expect(fetchMock.mock.calls[1][1].headers['X-Admin-Password']).toBe('next');
  });

  it('does not share an in-flight GET across a password change', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.setItem('deepaicode2api_pw', 'first');
    const first = api('/admin/api/state');
    sessionStorage.setItem('deepaicode2api_pw', 'next');
    const second = api('/admin/api/state');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await Promise.all([first, second]);
  });

  it('rejects non-2xx responses with gateway details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: 'bad request', type: 'invalid_request_error' } }, 400)));
    await expect(api('/admin/api/settings')).rejects.toMatchObject({ status: 400, detail: 'bad request', type: 'invalid_request_error' });
  });

  it('clears the current tab password and redirects after an unauthorized response', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { pathname: '/', hash: '#accounts?group=team&page=2', replace });
    sessionStorage.setItem('deepaicode2api_pw', 'expired');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: 'unauthorized' } }, 401)));
    await expect(api('/admin/api/state')).rejects.toMatchObject({ status: 401 });
    expect(sessionStorage.getItem('deepaicode2api_pw')).toBeNull();
    expect(replace).toHaveBeenCalledWith('/login#accounts?group=team&page=2');
  });

  it.each([['GET', 15_000], ['POST', 90_000]] as const)('aborts %s after %i ms', async (method, timeout) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_path: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const result = api('/admin/api/slow', { method });
    const assertion = expect(result).rejects.toBeInstanceOf(ApiError);
    await vi.advanceTimersByTimeAsync(timeout - 1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
