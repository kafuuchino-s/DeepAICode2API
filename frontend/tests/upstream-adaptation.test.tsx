import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../src/lib/i18n';
import OverviewPage from '../src/features/overview/OverviewPage';
import SettingsPage from '../src/features/settings/SettingsPage';
import LogsPage from '../src/features/logs/LogsPage';

const baseSettings = { request_timeout_sec: 600, max_retries: 3, log_keep: 500, cors_origin: '', fallback_model: '', strict_model: false, rate_limit_rps: 0, rate_limit_burst: 0, key_concurrency: 0, model_aliases: {}, admin_password_set: false };
const stats = { total_requests: 4, failed_requests: 0, total_tokens_in: 0, total_tokens_out: 0, total_cost: 0, total_chars_out: 0, started_at: 0 };
function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200 }); }
function renderPage(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
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
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('settings v0.1.4', () => {
  it('loads, validates, saves and displays the new settings', async () => {
    let current = { ...baseSettings, checkin_block_ms: 0, preset_desktop_shape: false };
    const fetchMock = vi.fn((_path: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        current = { ...current, ...JSON.parse(String(options.body)) };
        return Promise.resolve(json({ ok: true, settings: current }));
      }
      return Promise.resolve(json(current));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<SettingsPage />);
    const wait = await screen.findByLabelText(/Check-in wait limit \(ms\)/) as HTMLInputElement;
    const shape = screen.getByLabelText(/Preset desktop request shape/) as HTMLInputElement;
    expect(wait.value).toBe('0');
    expect(shape.checked).toBe(false);
    fireEvent.change(wait, { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByRole('alert').textContent).toContain('Check numeric values');
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0);
    fireEvent.change(wait, { target: { value: '1250' } });
    fireEvent.click(shape);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByRole('status');
    const post = fetchMock.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ checkin_block_ms: 1250, preset_desktop_shape: true });
    expect(wait.value).toBe('1250');
    expect(shape.checked).toBe(true);
  });

  it('shows defaults and disables unsupported controls on an older server', async () => {
    const fetchMock = vi.fn((_path: string, options?: RequestInit) => Promise.resolve(json(options?.method === 'POST' ? { settings: baseSettings } : baseSettings)));
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<SettingsPage />);
    const wait = await screen.findByLabelText(/Check-in wait limit \(ms\)/) as HTMLInputElement;
    const shape = screen.getByLabelText(/Preset desktop request shape/) as HTMLInputElement;
    expect(wait.value).toBe('0'); expect(wait.disabled).toBe(true); expect(shape.checked).toBe(false); expect(shape.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByRole('status');
    const post = fetchMock.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).not.toHaveProperty('checkin_block_ms');
    expect(JSON.parse(String(post?.[1]?.body))).not.toHaveProperty('preset_desktop_shape');
  });
});

describe('process metrics', () => {
  function setup(overview: object) {
    vi.stubGlobal('fetch', vi.fn((path: string) => Promise.resolve(json(path === '/admin/api/overview' ? { accounts: 1, ready: 1, stats, ...overview } : path === '/health' ? { degraded: 0, blocked: 0, quota_fresh: 0, quota_due: 0 } : path === '/admin/api/models' ? { models: [] } : { days: [], started_at: 0 }))));
    renderPage(<OverviewPage />);
  }
  it('renders process quantiles, endpoints and errors without changing persistent trends', async () => {
    setup({ latency: { p50_ms: 50, p95_ms: 500, p99_ms: 1000 }, latency_by_endpoint: { chat: { p50_ms: 50, p95_ms: 500, p99_ms: 1000 } }, checkin: { attempts: 3, blocked: 2, timeouts: 1, p50_ms: 100, p95_ms: 250 }, fallback_total: 7, upstream_errors: [{ path: '/chat/completions', code: 'shape', status: 400, count: 4 }] });
    const metrics = await screen.findByRole('region', { name: 'Process metrics' });
    await waitFor(() => expect(within(metrics).getAllByText('50 ms / 500 ms / 1,000 ms')).toHaveLength(2));
    expect(metrics.textContent).toContain('100 ms / 250 ms');
    expect(metrics.textContent).toContain('Attempts 3 · Blocked 2 · Timeouts 1');
    expect(metrics.textContent).toContain('/chat/completions · shape · 400');
    expect(metrics.textContent).toContain('reset on restart');
    expect(screen.getByText('Request activity')).toBeTruthy();
  });
  it('shows empty and missing quantiles as unavailable rather than zero milliseconds', async () => {
    setup({ latency: { p50_ms: 0, p95_ms: 0, p99_ms: 0 }, latency_by_endpoint: {}, checkin: { attempts: 0, blocked: 0, timeouts: 0, p50_ms: 0, p95_ms: 0 }, fallback_total: 0, upstream_errors: [] });
    const metrics = await screen.findByRole('region', { name: 'Process metrics' });
    await waitFor(() => expect(metrics.textContent).toContain('No endpoint samples yet.'));
    expect(metrics.textContent).not.toContain('0 ms');
    expect(metrics.textContent).toContain('No upstream errors yet.');
    expect(metrics.textContent).toContain('Attempts 0 · Blocked 0 · Timeouts 0');
  });
  it('handles old servers without process metrics', async () => {
    setup({});
    const metrics = await screen.findByRole('region', { name: 'Process metrics' });
    await waitFor(() => expect(metrics.textContent).toContain('Process metrics are unavailable'));
    expect(metrics.textContent).not.toContain('0 ms');
  });
});

describe('log refresh and confirmation', () => {
  it('refreshes the filtered query only when enabled, visible and on the logs page', async () => {
    history.replaceState(null, '', '/#logs?q=example');
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const fetchMock = vi.fn((_path: string) => Promise.resolve(json({ logs: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const view = renderPage(<LogsPage />);
    await screen.findByText('No matching logs.');
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=example');
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Live refresh (5 seconds)' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('q=example');
    fireEvent.change(screen.getByRole('textbox', { name: 'Model or error keyword' }), { target: { value: 'updated' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain('q=updated');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3][0])).toContain('q=updated');
    visibility = 'hidden';
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    visibility = 'visible';
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Live refresh (5 seconds)' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Live refresh (5 seconds)' }));
    history.replaceState(null, '', '/#accounts');
    fireEvent(window, new Event('hashchange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
  it('offers an accessible cancelable confirmation before clearing logs', async () => {
    history.replaceState(null, '', '/#logs');
    const fetchMock = vi.fn((_path: string) => Promise.resolve(json({ logs: [] })));
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<LogsPage />);
    await screen.findByText('No matching logs.');
    const trigger = screen.getByRole('button', { name: 'Clear logs' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Clear logs' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Clear logs' })).getByRole('button', { name: 'Clear logs' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => (call as unknown as [string, RequestInit])[1]?.method === 'DELETE')).toBe(true));
  });
});
