import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../src/lib/i18n';
import OverviewPage from '../src/features/overview/OverviewPage';

const day = {
  date: '2026-11-14', partial: true, requests: 2, failed: 0, client_gone: 0,
  tokens_in: 47, tokens_out: 16, input_reported_requests: 2, output_reported_requests: 2,
  cached_tokens: 0, cache_reported_requests: 2, cache_paired_requests: 2,
  cache_paired_tokens: 0, cache_paired_input_tokens: 47,
  cost: 1.25, cost_reported_requests: 1,
};

function showOverview(trendDay: object) {
  vi.stubGlobal('fetch', vi.fn((path: string) => {
    const response = path === '/admin/api/overview'
      ? { accounts: 1, ready: 1, stats: { total_requests: 2, failed_requests: 0, total_tokens_in: 47, total_tokens_out: 16, total_cost: 1.25, total_chars_out: 0, started_at: 0 } }
      : path === '/health' ? { degraded: 0, blocked: 0, quota_fresh: 0, quota_due: 0 }
        : path === '/admin/api/models' ? { models: [] }
          : { started_at: 0, days: [trendDay] };
    return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  render(<QueryClientProvider client={client}><I18nProvider><OverviewPage /></I18nProvider></QueryClientProvider>);
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  sessionStorage.clear(); history.replaceState(null, '', '/');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('gateway cost in observed usage', () => {
  it('shows the reported value and coverage separately from the original cost', async () => {
    showOverview({ ...day, gateway_cost: 0.000008325, gateway_cost_reported_requests: 1 });
    const gateway = (await screen.findByText('Upstream gateway cost')).parentElement!;
    expect(gateway.textContent).toContain('$0.000008325');
    expect(gateway.textContent).toContain('1 of 2 requests recorded');
    expect(screen.getByText('Reported upstream cost').parentElement?.textContent).toContain('$1.25');
  });

  it('shows an explicitly reported zero but leaves old data without the field unknown', async () => {
    showOverview({ ...day, gateway_cost: 0, gateway_cost_reported_requests: 1 });
    let gateway = (await screen.findByText('Upstream gateway cost')).parentElement!;
    expect(gateway.textContent).toContain('cost$0');
    expect(gateway.textContent).toContain('1 of 2 requests recorded');
    cleanup();
    showOverview(day);
    gateway = (await screen.findByText('Upstream gateway cost')).parentElement!;
    expect(gateway.textContent).toContain('cost—');
    expect(gateway.textContent).toContain('0 of 2 requests recorded');
  });
});
