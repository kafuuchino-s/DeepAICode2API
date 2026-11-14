import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider, useI18n } from '../src/lib/i18n';
import LogsPage from '../src/features/logs/LogsPage';
import { formatGatewayCost } from '../src/features/logs/log-utils';

function LanguageSwitch() {
  const { lang, setLang } = useI18n();
  return <button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>Language</button>;
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
  history.replaceState(null, '', '/#logs?endpoint=chat&q=example');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('upstream gateway cost', () => {
  it('shows dollars, preserving small values and distinguishing a reported zero from an absent value', () => {
    expect(formatGatewayCost(8.325e-6, 'Unknown')).toBe('$0.000008325');
    expect(formatGatewayCost(1e-12, 'Unknown')).toBe('$1e-12');
    expect(formatGatewayCost(0, 'Unknown')).toBe('$0');
    expect(formatGatewayCost(undefined, 'Unknown')).toBe('Unknown');
    expect(formatGatewayCost(Number.NaN, 'Unknown')).toBe('Unknown');
  });

  it('shows gateway values on both layouts and in details, and sorts them without the old cost', async () => {
    const fetchMock = vi.fn((_path: string) => Promise.resolve(new Response(JSON.stringify({ logs: [
      { time: 3, model: 'legacy', status: 200, cost: 0.1, cost_known: true },
      { time: 2, model: 'reported', status: 200, cost: 0.3, cost_known: true, gateway_cost: 8.325e-6 },
      { time: 1, model: 'zero', status: 200, cost: 0.2, cost_known: true, gateway_cost: 0 },
    ] }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><I18nProvider><LanguageSwitch /><LogsPage /></I18nProvider></QueryClientProvider>);

    const reported = await screen.findByRole('row', { name: /reported/ });
    expect(String(fetchMock.mock.calls[0][0])).toContain('endpoint=chat');
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=example');
    expect(location.hash).toContain('endpoint=chat');
    const row = (model: string) => screen.getByRole('row', { name: new RegExp(model) });
    const card = (model: string) => screen.getAllByRole('article').find(item => item.textContent?.includes(model))!;
    const gatewayField = (element: HTMLElement, label = 'Upstream gateway cost') => within(element).getByText(label).parentElement!;

    const header = screen.getByRole('columnheader', { name: /Upstream gateway cost/ });
    expect(header.textContent).toBe('Upstream gateway cost');
    expect(screen.queryByText('Unit unconfirmed')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Cost' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Cost' })).toBeNull();
    expect(reported.querySelectorAll('td')[2].textContent).toBe('$0.000008325');
    expect(row('zero').querySelectorAll('td')[2].textContent).toBe('$0');
    expect(row('legacy').querySelectorAll('td')[2].textContent).toBe('Unknown');
    expect(gatewayField(card('reported')).textContent).toBe('Upstream gateway cost$0.000008325');
    expect(gatewayField(card('zero')).textContent).toBe('Upstream gateway cost$0');
    expect(gatewayField(card('legacy')).textContent).toBe('Upstream gateway costUnknown');
    expect(within(card('reported')).queryByText('Cost', { exact: true })).toBeNull();
    expect(within(card('reported')).queryByText('$0.3')).toBeNull();

    fireEvent.click(within(reported).getByRole('button', { name: 'reported' }));
    let dialog = screen.getByRole('dialog', { name: 'Request details' });
    expect(gatewayField(dialog).textContent).toBe('Upstream gateway cost$0.000008325');
    expect(within(dialog).queryByText('Cost', { exact: true })).toBeNull();
    expect(within(dialog).queryByText('$0.3')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    const order = () => Array.from(document.querySelectorAll('tbody tr')).map(item => item.querySelector('button')?.textContent);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'gateway_cost' } });
    expect(order()).toEqual(['zero', 'reported', 'legacy']);
    fireEvent.click(screen.getByRole('button', { name: 'Ascending, switch to descending' }));
    expect(order()).toEqual(['reported', 'zero', 'legacy']);

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.getByRole('columnheader', { name: /上游网关成本/ }).textContent).toBe('上游网关成本');
    expect(screen.queryByText('单位未确认')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '成本' })).toBeNull();
    expect(screen.queryByRole('option', { name: '成本' })).toBeNull();
    expect(within(card('reported')).queryByText('成本', { exact: true })).toBeNull();
    expect(gatewayField(card('reported'), '上游网关成本').textContent).toBe('上游网关成本$0.000008325');
    expect(gatewayField(card('zero'), '上游网关成本').textContent).toBe('上游网关成本$0');
    expect(gatewayField(card('legacy'), '上游网关成本').textContent).toBe('上游网关成本未知');
    fireEvent.click(within(row('reported')).getByRole('button', { name: 'reported' }));
    dialog = screen.getByRole('dialog', { name: '请求详情' });
    expect(gatewayField(dialog, '上游网关成本').textContent).toBe('上游网关成本$0.000008325');
    expect(within(dialog).queryByText('成本', { exact: true })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  });
});
