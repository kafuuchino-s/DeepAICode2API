import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../src/lib/i18n';
import App from '../src/App';

vi.mock('../src/features/overview/OverviewPage', () => ({ default: () => <div>overview fixture</div> }));
vi.mock('../src/features/accounts/AccountsPage', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  const { api } = await import('../src/lib/api');
  return { default: () => {
    const result = useQuery({ queryKey: ['account-fixture'], queryFn: () => api<{ value: number }>('/admin/api/accounts') });
    return <div>account fixture {result.data?.value}</div>;
  } };
});
vi.mock('../src/features/keys/KeysPage', () => ({ default: () => <div>keys fixture</div> }));
vi.mock('../src/features/models/ModelsPage', () => ({ default: () => <div>models fixture</div> }));
vi.mock('../src/features/logs/LogsPage', () => ({ default: () => <div>logs fixture</div> }));
vi.mock('../src/features/settings/SettingsPage', () => ({ default: () => <div>settings fixture</div> }));

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><I18nProvider><App /></I18nProvider></QueryClientProvider>);
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  sessionStorage.clear(); localStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('console shell', () => {
  it('preserves deep links and applies language, theme, sidebar, refresh and navigation actions', async () => {
    sessionStorage.setItem('deepaicode2api_pw', 'admin');
    localStorage.setItem('deepaicode2api_theme', 'light');
    localStorage.setItem('deepaicode2api_sidebar', 'collapsed');
    history.replaceState(null, '', '/#accounts?group=team&status=ready&page=2');
    let accountRequests = 0;
    const fetchMock = vi.fn((path: string) => {
      if (path === '/admin/api/accounts') return Promise.resolve(json({ value: ++accountRequests }));
      return Promise.resolve(json({ current: 'v1.0.0', update_available: true, latest: 'v1.1.0' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderApp();
    expect(await screen.findByText('account fixture 1')).toBeTruthy();
    expect(location.hash).toBe('#accounts?group=team&status=ready&page=2');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('deepaicode2api_sidebar')).toBe('expanded');
    fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }));
    expect(localStorage.getItem('deepaicode2api_theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('account fixture 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Models' }));
    expect(await screen.findByText('models fixture')).toBeTruthy();
    expect(location.hash).toBe('#models');
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    expect(localStorage.getItem('deepaicode2api_lang')).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(screen.getByRole('link', { name: '模型' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
    const drawer = screen.getByRole('dialog', { name: '主导航' });
    expect(drawer.getAttribute('data-state')).toBe('open');
    fireEvent.click(within(drawer).getByRole('link', { name: '日志' }));
    expect(await screen.findByText('logs fixture')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location.hash).toBe('#logs');
  });

  it('keeps health visible on other pages and reports failed and recovered checks', async () => {
    sessionStorage.setItem('deepaicode2api_pw', 'admin');
    localStorage.setItem('deepaicode2api_lang', 'en');
    history.replaceState(null, '', '/#accounts');
    let healthRequests = 0;
    vi.stubGlobal('fetch', vi.fn((path: string) => {
      if (path === '/health') {
        healthRequests++;
        return healthRequests === 2 ? Promise.resolve(json({}, 503)) : Promise.resolve(json({ ready: 2, accounts: 5, degraded: 1, models: 7 }));
      }
      return Promise.resolve(json(path === '/admin/api/accounts' ? { value: 1 } : { current: 'dev' }));
    }));
    renderApp();
    const switchToEnglish = screen.queryByRole('button', { name: '切换语言' });
    if (switchToEnglish) fireEvent.click(switchToEnglish);
    expect((await screen.findAllByText('2/5 ready · 1 recently failed · 7 models')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('link', { name: 'Models' }));
    expect(await screen.findByText('models fixture')).toBeTruthy();
    expect(screen.getAllByText('2/5 ready · 1 recently failed · 7 models').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect((await screen.findAllByText('Gateway unreachable')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    expect(screen.getAllByText('网关不可达').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect((await screen.findAllByText('账号 2/5 就绪 · 近期失败 1 · 模型 7')).length).toBeGreaterThan(0);
  });

  it('checks gateway health every 20 seconds while the console is mounted', async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.setItem('deepaicode2api_pw', 'admin');
      localStorage.setItem('deepaicode2api_lang', 'en');
      history.replaceState(null, '', '/#models');
      const fetchMock = vi.fn((path: string) => Promise.resolve(json(path === '/health' ? { ready: 1, accounts: 2, degraded: 0, models: 3 } : { current: 'dev' })));
      vi.stubGlobal('fetch', fetchMock);
      renderApp();
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(fetchMock.mock.calls.filter(([path]) => path === '/health')).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(19_800); });
      expect(fetchMock.mock.calls.filter(([path]) => path === '/health')).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(fetchMock.mock.calls.filter(([path]) => path === '/health')).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it('closes the mobile sheet on escape and overlay click and restores focus', async () => {
    sessionStorage.setItem('deepaicode2api_pw', 'admin');
    vi.stubGlobal('fetch', vi.fn((path: string) => Promise.resolve(json(path === '/health' ? { ready: 1, accounts: 1, degraded: 0, models: 2 } : { current: 'dev' }))));
    renderApp();
    const trigger = screen.getByRole('button', { name: /打开导航|Open navigation/ });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.body.classList.contains('drawer-open')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.body.classList.contains('drawer-open')).toBe(false);
    fireEvent.click(trigger);
    const overlay = document.querySelector('[data-sheet-overlay]');
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('allows a gateway without an admin password to open the console', async () => {
    vi.stubGlobal('fetch', vi.fn((path: string) => Promise.resolve(json(path === '/health' ? { admin_required: false } : { current: 'dev' }))));
    renderApp();
    expect(await screen.findByText('overview fixture')).toBeTruthy();
  });

  it('keeps login available after an incorrect password and saves the verified password in this tab', async () => {
    history.replaceState(null, '', '/login#accounts?group=team&page=2');
    const replace = vi.fn();
    vi.stubGlobal('location', { pathname: '/login', hash: '#accounts?group=team&page=2', replace });
    const fetchMock = vi.fn().mockImplementationOnce(() => Promise.resolve(json({ error: {} }, 401)))
      .mockImplementationOnce(() => Promise.resolve(json({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    renderApp();
    const input = screen.getByLabelText('管理口令');
    fireEvent.change(input, { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect((await screen.findByRole('alert')).textContent).toContain('口令错误');
    expect(sessionStorage.getItem('deepaicode2api_pw')).toBeNull();
    fireEvent.change(input, { target: { value: 'correct' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(sessionStorage.getItem('deepaicode2api_pw')).toBe('correct'));
    expect(fetchMock.mock.calls[1][1].headers['X-Admin-Password']).toBe('correct');
    expect(replace).toHaveBeenCalledWith('/#accounts?group=team&page=2');
  });
});
