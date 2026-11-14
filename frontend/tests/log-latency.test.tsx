import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider, useI18n } from '../src/lib/i18n';
import LogsPage from '../src/features/logs/LogsPage';

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
  history.replaceState(null, '', '/#logs');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('request latency', () => {
  it('shows measured first output and estimated TPS consistently across layouts and languages', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ logs: [
      { time: 5, model: 'measured', status: 200, stream: true, latency_ms: 2150, ttft_ms: 150, tokens_out: 51, tokens_out_reported: true },
      { time: 4, model: 'zero-first', status: 200, stream: true, latency_ms: 2000, ttft_ms: 0, tokens_out: 11, tokens_out_reported: true },
      { time: 3, model: 'historical', status: 200, stream: true, latency_ms: 3000, tokens_out: 30, tokens_out_reported: true },
      { time: 2, model: 'unreported', status: 200, stream: true, latency_ms: 2000, ttft_ms: 500, tokens_out: 11 },
      { time: 1, model: 'non-stream', status: 200, stream: false, latency_ms: 500, tokens_out: 12, tokens_out_reported: true },
    ] }), { status: 200 }))));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><I18nProvider><LanguageSwitch /><LogsPage /></I18nProvider></QueryClientProvider>);

    const measured = await screen.findByRole('row', { name: /measured/ });
    const row = (model: string) => screen.getByRole('row', { name: new RegExp(model) });
    const card = (model: string) => screen.getAllByRole('article').find(item => item.textContent?.includes(model))!;
    const verify = (container: HTMLElement, total: string, first: string, speed: string) => {
      expect(within(container).getByText(total)).toBeTruthy();
      expect(within(container).getByText(first)).toBeTruthy();
      expect(within(container).getByText(speed)).toBeTruthy();
    };

    for (const container of [measured, card('measured')]) verify(container, '2150 ms', 'First output 150 ms', 'TPS 25 tokens/s');
    for (const container of [row('zero-first'), card('zero-first')]) verify(container, '2000 ms', 'First output 0 ms', 'TPS 5 tokens/s');
    for (const container of [row('historical'), card('historical')]) verify(container, '3000 ms', 'First output Unknown', 'TPS Unknown');
    for (const container of [row('unreported'), card('unreported')]) verify(container, '2000 ms', 'First output 500 ms', 'TPS Unknown');
    for (const container of [row('non-stream'), card('non-stream')]) verify(container, '500 ms', 'First output Unknown', 'TPS Unknown');

    fireEvent.click(within(measured).getByRole('button', { name: 'measured' }));
    let dialog = screen.getByRole('dialog', { name: 'Request details' });
    verify(dialog, '2150 ms', 'First output 150 ms', 'TPS 25 tokens/s');
    expect(within(dialog).getByText('First output includes reasoning and tool calls. TPS is an estimate: (output tokens − 1) ÷ seconds after first output.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    for (const container of [row('measured'), card('measured')]) verify(container, '2150 ms', '首字 150 ms', 'TPS 25 tokens/s');
    for (const container of [row('zero-first'), card('zero-first')]) verify(container, '2000 ms', '首字 0 ms', 'TPS 5 tokens/s');
    for (const container of [row('historical'), card('historical')]) verify(container, '3000 ms', '首字 未知', 'TPS 未知');
    fireEvent.click(within(card('measured')).getByRole('button', { name: '查看详情' }));
    dialog = screen.getByRole('dialog', { name: '请求详情' });
    verify(dialog, '2150 ms', '首字 150 ms', 'TPS 25 tokens/s');
    expect(within(dialog).getByText('首字指首次有效模型输出（含思考和工具调用）。TPS 是估算值：(输出 Token − 1) ÷ 首字后的秒数。')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  });
});
