import { Component, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Box, ChevronLeft, ChevronRight, CircleHelp, KeyRound, Languages, LayoutDashboard, LogOut, Menu, Moon, RefreshCw, ScrollText, Settings, Sun, UsersRound, X } from 'lucide-react';
import { api, clearPassword, password, setPassword } from './lib/api';
import { useI18n } from './lib/i18n';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './components/ui/sheet';
import OverviewPage from './features/overview/OverviewPage';
import AccountsPage from './features/accounts/AccountsPage';
import KeysPage from './features/keys/KeysPage';
import ModelsPage from './features/models/ModelsPage';
import LogsPage from './features/logs/LogsPage';
import SettingsPage from './features/settings/SettingsPage';

const navItems = [
  { id: 'overview', zh: '概览', en: 'Overview', icon: LayoutDashboard, Page: OverviewPage },
  { id: 'accounts', zh: '账号池', en: 'Accounts', icon: UsersRound, Page: AccountsPage },
  { id: 'keys', zh: '密钥', en: 'API keys', icon: KeyRound, Page: KeysPage },
  { id: 'models', zh: '模型', en: 'Models', icon: Box, Page: ModelsPage },
  { id: 'logs', zh: '日志', en: 'Logs', icon: ScrollText, Page: LogsPage },
  { id: 'settings', zh: '设置', en: 'Settings', icon: Settings, Page: SettingsPage },
] as const;
type PageId = typeof navItems[number]['id'];
type Theme = 'light' | 'dark';
type HealthSnapshot = { ready: number; accounts: number; degraded: number; models: number };
type HealthQuery = UseQueryResult<HealthSnapshot, Error>;
type VersionInfo = { current?: string; latest?: string; update_available?: boolean; error?: string };
const THEME_KEY = 'deepaicode2api_theme';
const SIDEBAR_KEY = 'deepaicode2api_sidebar';
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';

function initialTheme(): Theme {
  try { const value = localStorage.getItem(THEME_KEY); if (value === 'light' || value === 'dark') return value; } catch { /* Storage may be unavailable. */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(theme: Theme) { document.documentElement.dataset.theme = theme; }
applyTheme(initialTheme());
function currentPage(): PageId {
  const tab = location.hash.slice(1).split('?')[0];
  return navItems.some(item => item.id === tab) ? tab as PageId : 'overview';
}

class PageBoundary extends Component<{ children: ReactNode; message: string; retry: string }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return <div role="alert" className="rounded-xl border border-border bg-card p-6"><p>{this.props.message}</p><button className={`${button} mt-4`} onClick={() => this.setState({ error: false })}>{this.props.retry}</button></div>;
    return this.props.children;
  }
}

async function verifyPassword(value: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch('/admin/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Password': value }, body: '{}', signal: controller.signal });
  } finally { window.clearTimeout(timeout); }
}
function goToConsole() { location.replace('/' + location.hash); }

function Login({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const saved = password();
    if (!saved) return;
    let active = true;
    setBusy(true);
    verifyPassword(saved).then(response => {
      if (!active) return;
      if (response.ok) goToConsole();
      else if (response.status === 401) clearPassword();
    }).catch(() => { /* The form remains available if the gateway is unreachable. */ }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.trim()) { setError(t('请输入管理口令。', 'Enter your admin password.')); return; }
    setBusy(true); setError('');
    try {
      const response = await verifyPassword(value);
      if (response.ok) {
        setPassword(value);
        if (!password()) { setError(t('无法保存本标签页的会话，请允许浏览器使用 sessionStorage。', 'The browser could not save this tab’s session. Enable sessionStorage and try again.')); return; }
        goToConsole();
      } else if (response.status === 401) setError(t('口令错误，请重试。', 'Incorrect password. Try again.'));
      else if (response.status === 429) setError(t('尝试过于频繁，请稍后重试。', 'Too many attempts. Try again later.'));
      else setError(t(`登录失败（HTTP ${response.status}）。`, `Sign-in failed (HTTP ${response.status}).`));
    } catch { setError(t('无法连接网关，请检查服务后重试。', 'Could not reach the gateway. Check the service and try again.')); }
    finally { setBusy(false); }
  }
  return <div className="flex min-h-screen flex-col bg-background">
    <header className="flex items-center justify-between px-6 py-5"><span className="text-sm font-semibold tracking-tight">DeepAICode2API</span><div className="flex gap-1"><button className="shell-icon" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label={t('切换语言', 'Switch language')}><Languages size={18} /></button><button className="shell-icon" onClick={toggleTheme} aria-label={theme === 'dark' ? t('切换浅色主题', 'Use light theme') : t('切换深色主题', 'Use dark theme')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button></div></header>
    <main className="flex flex-1 items-center justify-center px-5 pb-24"><div className="w-full max-w-sm"><div className="mb-8"><div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Box size={22} /></div><h1 className="text-2xl font-semibold tracking-tight">{t('欢迎回来', 'Welcome back')}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{t('输入管理口令以访问控制台。', 'Enter your admin password to access the console.')}</p></div>
      <form className="space-y-4" onSubmit={submit}><div><label htmlFor="login-password" className="mb-2 block text-sm font-medium">{t('管理口令', 'Admin password')}</label><input id="login-password" className="min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground" type="password" autoComplete="current-password" autoFocus value={value} onChange={event => { setValue(event.target.value); setError(''); }} disabled={busy} /></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<button type="submit" disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? t('验证中…', 'Checking…') : t('登录', 'Sign in')}</button></form>
      <p className="mt-6 text-xs leading-5 text-muted-foreground">{t('口令只保存在当前浏览器标签页。', 'Your password is stored only in this browser tab.')}</p></div></main>
  </div>;
}

function HealthStatus({ health, compact = false }: { health: HealthQuery; compact?: boolean }) {
  const { t } = useI18n();
  const data = health.data;
  const text = health.isError ? t('网关不可达', 'Gateway unreachable') : !data ? t('正在检查网关…', 'Checking gateway…') : t(
    `账号 ${data.ready}/${data.accounts} 就绪 · 近期失败 ${data.degraded} · 模型 ${data.models}`,
    `${data.ready}/${data.accounts} ready · ${data.degraded} recently failed · ${data.models} models`,
  );
  const dot = health.isError ? 'bg-destructive' : !data || !data.accounts ? 'bg-muted-foreground' : data.degraded || !data.ready ? 'bg-amber-500' : 'bg-emerald-500';
  return <div role="status" aria-label={text} title={text} className={`flex items-start gap-2 text-xs leading-5 text-muted-foreground ${compact ? 'justify-center' : ''}`}><span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />{!compact && <span>{text}</span>}</div>;
}

function Sidebar({ page, collapsed, onNavigate, onCollapse, health, version, mobile, theme, toggleTheme, refresh, refreshing }: {
  page: PageId; collapsed: boolean; onNavigate: () => void; onCollapse: () => void; health: HealthQuery;
  version?: VersionInfo; mobile?: boolean; theme: Theme; toggleTheme: () => void; refresh: () => void; refreshing: boolean;
}) {
  const { t, lang, setLang } = useI18n();
  const releaseTitle = version?.update_available
    ? t(`发现新版本 ${version.latest || ''}`, `Update available: ${version.latest || ''}`)
    : version?.error ? t('无法检查更新', 'Unable to check for updates') : t('查看版本', 'View releases');
  return <div className="flex h-full min-h-0 flex-col px-4 py-6">
    <div className={`flex h-7 shrink-0 items-center ${collapsed ? 'justify-center' : 'justify-between px-2.5'}`}>
      {!collapsed && <a href="#overview" onClick={onNavigate} className="truncate text-base font-semibold tracking-tight" aria-label="DeepAICode2API">DeepAICode2API</a>}
      <button className="shell-icon" onClick={onCollapse} aria-label={mobile ? t('关闭导航', 'Close navigation') : collapsed ? t('展开侧边栏', 'Expand sidebar') : t('收起侧边栏', 'Collapse sidebar')}>
        {mobile ? <X size={16} /> : collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </div>
    <nav aria-label={t('主导航', 'Main navigation')} className="mt-7 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pb-2">
      {navItems.map(item => <a key={item.id} href={'#' + item.id} onClick={onNavigate} aria-current={page === item.id ? 'page' : undefined} title={collapsed ? t(item.zh, item.en) : undefined} className={`shell-nav-link ${page === item.id ? 'active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}><item.icon size={16} strokeWidth={1.8} className="shrink-0" />{!collapsed && <span>{t(item.zh, item.en)}</span>}</a>)}
    </nav>
    <div className={`mt-4 shrink-0 ${collapsed ? '' : 'px-2.5'}`}>
      <div className="mb-3"><HealthStatus health={health} compact={collapsed} /></div>
      <div className={`flex ${collapsed ? 'flex-col' : 'items-center justify-between gap-1'}`}>
        {!collapsed && <a href="https://github.com/2951461586/DeepAICode2API/releases" target="_blank" rel="noopener noreferrer" title={releaseTitle} className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><span className="truncate">{version?.current || 'DeepAICode2API'}</span>{version?.update_available && <span aria-label={releaseTitle} className="shrink-0 font-semibold text-foreground">↑</span>}</a>}
        <div className={`flex ${collapsed ? 'flex-col items-center' : 'shrink-0 items-center'}`}>
          <button className="shell-icon" onClick={refresh} disabled={refreshing} aria-label={t('刷新', 'Refresh')} title={t('刷新', 'Refresh')}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /></button>
          <button className="shell-icon" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label={t('切换语言', 'Switch language')} title={t('切换语言', 'Switch language')}><Languages size={16} /></button>
          <button className="shell-icon" onClick={toggleTheme} aria-label={theme === 'dark' ? t('切换浅色主题', 'Use light theme') : t('切换深色主题', 'Use dark theme')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="shell-icon" onClick={() => { clearPassword(); location.replace('/login'); }} aria-label={t('退出登录', 'Sign out')} title={t('退出登录', 'Sign out')}><LogOut size={16} /></button>
        </div>
      </div>
    </div>
  </div>;
}

function Shell({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<HealthSnapshot>('/health'), refetchInterval: 20_000, retry: false });
  const version = useQuery({ queryKey: ['version'], queryFn: () => api<VersionInfo>('/admin/api/version'), staleTime: 6 * 60 * 60 * 1000, retry: false });
  const [page, setPage] = useState<PageId>(currentPage);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { const change = () => setPage(currentPage()); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => {
    document.body.classList.toggle('drawer-open', drawer);
    return () => document.body.classList.remove('drawer-open');
  }, [drawer]);
  useEffect(() => {
    if (!drawer || !window.matchMedia) return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) setDrawer(false); };
    closeOnDesktop();
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [drawer]);
  const toggleCollapse = () => setCollapsed(value => { const next = !value; try { localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded'); } catch { /* Storage may be unavailable. */ } return next; });
  const refresh = async () => { setRefreshing(true); try { await queryClient.invalidateQueries(); } finally { setRefreshing(false); } };
  const item = navItems.find(entry => entry.id === page) || navItems[0];
  const Page = item.Page;
  const sidebar = { page, health, version: version.data, theme, toggleTheme, refresh: () => void refresh(), refreshing };
  return <Sheet open={drawer} onOpenChange={setDrawer}>
    <div className="min-h-screen bg-background">
      <aside className={`shell-sidebar fixed inset-y-0 left-0 z-20 hidden transition-[width] duration-200 lg:block ${collapsed ? 'w-[72px]' : 'w-[288px]'}`}>
        <Sidebar {...sidebar} collapsed={collapsed} onNavigate={() => {}} onCollapse={toggleCollapse} />
      </aside>
      <SheetContent onOverlayClick={() => setDrawer(false)}>
        <SheetTitle className="sr-only">{t('主导航', 'Main navigation')}</SheetTitle>
        <Sidebar {...sidebar} collapsed={false} onNavigate={() => setDrawer(false)} onCollapse={() => setDrawer(false)} mobile />
      </SheetContent>
      <div className={`min-w-0 transition-[margin] duration-200 ${collapsed ? 'lg:ml-[72px]' : 'lg:ml-[288px]'}`}>
        <header className="sticky top-0 z-10 grid h-12 grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-background px-4 lg:hidden">
          <SheetTrigger asChild><button className="shell-icon justify-self-start" aria-label={t('打开导航', 'Open navigation')}><Menu size={17} /></button></SheetTrigger>
          <a href="#overview" className="truncate text-sm font-semibold tracking-tight">DeepAICode2API</a>
          <button className="shell-icon justify-self-end" onClick={() => void refresh()} disabled={refreshing} aria-label={t('刷新数据', 'Refresh data')} title={t('刷新数据', 'Refresh data')}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></button>
        </header>
        <div className={`px-5 pt-3 sm:px-8 ${collapsed ? '' : 'lg:hidden'}`}><HealthStatus health={health} /></div>
        <main className={`mx-auto w-full max-w-[1280px] px-5 pb-8 pt-5 sm:px-8 lg:pb-20 ${collapsed ? 'lg:pt-12' : 'lg:pt-20'}`}>
          <PageBoundary key={page} message={t('页面加载失败，请重试。', 'The page could not be displayed. Try again.')} retry={t('重试', 'Retry')}><Page /></PageBoundary>
        </main>
      </div>
    </div>
  </Sheet>;
}

export default function App() {
  const { t, lang } = useI18n();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [gate, setGate] = useState<'loading' | 'ready' | 'error'>(password() ? 'ready' : 'loading');
  const toggleTheme = () => setTheme(value => { const next = value === 'light' ? 'dark' : 'light'; applyTheme(next); try { localStorage.setItem(THEME_KEY, next); } catch { /* Storage may be unavailable. */ } return next; });
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }, [lang]);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const checkHealth = useCallback(async () => {
    setGate('loading');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/health', { signal: controller.signal });
      if (!response.ok) throw new Error('health');
      const health = await response.json() as { admin_required?: boolean };
      if (health.admin_required) location.replace('/login' + location.hash);
      else setGate('ready');
    } catch { setGate('error'); } finally { window.clearTimeout(timeout); }
  }, []);
  useEffect(() => { if (location.pathname !== '/login' && !password()) void checkHealth(); }, [checkHealth]);
  if (location.pathname === '/login') return <Login theme={theme} toggleTheme={toggleTheme} />;
  if (gate === 'loading') return <div role="status" className="grid min-h-screen place-items-center text-sm text-muted-foreground">{t('正在连接网关…', 'Connecting to gateway…')}</div>;
  if (gate === 'error') return <div className="grid min-h-screen place-items-center p-6"><div className="text-center"><CircleHelp className="mx-auto mb-4 text-muted-foreground" /><p role="alert">{t('无法连接网关。', 'Could not connect to the gateway.')}</p><button className={`${button} mt-4`} onClick={() => void checkHealth()}>{t('重试', 'Retry')}</button></div></div>;
  return <Shell theme={theme} toggleTheme={toggleTheme} />;
}
