// Local-only browser fixture: all management requests are fulfilled in memory.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider, useI18n } from '../../../lib/i18n';
import AccountsPage from '../AccountsPage';
import KeysPage from '../../keys/KeysPage';
import App from '../../../App';
import { runFixtureTests } from './smoke';
import '../../../index.css';

type TestAccount = { id: string; name: string; email: string; username: string; group: string; source: string; key: string; enabled: boolean; status: string; failures: number; email_verified: boolean; has_machine: boolean; proxy: string; last_used: number; theos: { balance: string } };
type TestKey = { key: string; name: string; group: string; enabled: boolean; requests: number; created_at: number; last_used: number };
const accounts: TestAccount[] = Array.from({ length: 43 }, (_, index) => ({ id: `account-${index + 1}`, name: `Account ${index + 1}`, email: `person${index + 1}@example.test`, username: `tester${index + 1}`, group: index < 21 ? 'alpha' : 'default', source: 'manual', key: `sk-acct...${index}`, enabled: true, status: index === 0 ? 'error' : 'ok', failures: index === 0 ? 2 : 0, email_verified: false, has_machine: false, proxy: index === 0 ? 'proxy.example.test:443' : '', last_used: 1700000000, theos: { balance: '10.00' } }));
const keys: TestKey[] = [{ key: 'sk-leg...0001', name: 'Legacy', group: '', enabled: true, requests: 42, created_at: 1700000000, last_used: 1700000000 }, { key: 'sk-def...0002', name: 'Default', group: 'default', enabled: false, requests: 3, created_at: 1700000001, last_used: 0 }];
const requests: { method: string; url: string; body: unknown }[] = [];
Object.assign(window, { qa: { requests, accounts, keys, pollInFlight: false, callbackOverlapped: false, failNext: '', checkinSequence: [] as object[] } });
const qa = (window as unknown as { qa: { requests: typeof requests; accounts: typeof accounts; keys: typeof keys; pollInFlight: boolean; callbackOverlapped: boolean; failNext: string; checkinSequence: object[] } }).qa;
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, location.origin);
  const method = init?.method || 'GET';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  requests.push({ method, url: `${url.pathname}${url.search}`, body });
  if (qa.failNext === url.pathname) { qa.failNext = ''; return reply({ error: { message: 'Simulated failure' } }, 503); }
  if (url.pathname === '/admin/api/accounts' && method === 'GET') {
    let list = accounts.filter((account) => (!url.searchParams.get('group') || account.group === url.searchParams.get('group')) && (!url.searchParams.get('status') || account.status === url.searchParams.get('status')) && (!url.searchParams.get('q') || [account.id, account.name, account.email, account.username, account.group, account.proxy].some((value) => value.toLowerCase().includes(url.searchParams.get('q')!.toLowerCase()))));
    const sort = url.searchParams.get('sort') as keyof TestAccount | null;
    if (sort && sort in accounts[0]) list = [...list].sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * (url.searchParams.get('order') === 'desc' ? -1 : 1));
    const offset = Number(url.searchParams.get('offset') || 0); const limit = Number(url.searchParams.get('limit') || 20);
    return reply({ total: list.length, items: list.slice(offset, offset + limit), offset, limit });
  }
  if (url.pathname === '/admin/api/accounts' && method === 'POST') {
    const account = accounts.find((item) => item.id === body.id);
    if (body.action === 'manual') { accounts.unshift({ ...accounts[0], id: 'manual-new', name: body.name || 'manual', email: 'new@example.test' }); return reply({ ok: true, new: true }); }
    if (body.action === 'import') return reply({ ok: true, count: 1 });
    if (!account) return reply({ ok: false });
    if (body.action === 'toggle') account.enabled = !account.enabled;
    if (body.action === 'clear-errors') { account.failures = 0; account.status = 'unknown'; }
    if (body.action === 'set-group') account.group = body.group;
    if (body.action === 'mark-verified') account.email_verified = true;
    if (body.action === 'assign-machine') account.has_machine = true;
    if (body.action === 'assign-proxy') account.proxy = body.clear ? '' : 'assigned.example.test:443';
    if (body.action === 'remove') accounts.splice(accounts.indexOf(account), 1);
    return reply({ ok: true, assigned: 1, cleared: 1, moved: 1 });
  }
  if (url.pathname === '/admin/api/checkin') return reply(qa.checkinSequence.shift() || { ok: true, probed: body.id ? 1 : 43, remaining: 0, skipped: 0, results: [{ id: body.id || 'account-1', name: 'Account 1', ok: true }] });
  if (url.pathname === '/admin/api/keys' && method === 'GET') return reply({ keys });
  if (url.pathname === '/admin/api/keys' && method === 'POST') {
    if (body.action === 'set-group') { const key = keys.find((item) => item.key === body.key); if (!key) return reply({ ok: false }); key.group = body.group || 'default'; return reply({ ok: true, group: key.group }); }
    keys.push({ key: 'sk-new...0003', name: body.name, group: body.group || 'default', enabled: true, requests: 0, created_at: 1700000002, last_used: 0 });
    return reply({ ok: true, key: 'sk-fixture-full-secret-for-test-0003' });
  }
  if (url.pathname === '/admin/api/keys' && method === 'DELETE') {
    const ref = url.searchParams.get('key') || url.searchParams.get('toggle'); const item = keys.find((key) => key.key === ref);
    if (!item) return reply({ error: { message: 'Missing key' } }, 404);
    if (url.searchParams.has('toggle')) item.enabled = !item.enabled; else keys.splice(keys.indexOf(item), 1);
    return reply({ ok: true });
  }
  if (url.pathname === '/admin/api/login/start') return reply({ session_id: 'test-session', open_url: '/login/open?id=test-session', expires_in: 600 });
  if (url.pathname === '/admin/api/login/poll') { qa.pollInFlight = true; await new Promise((resolve) => setTimeout(resolve, 1200)); qa.pollInFlight = false; return reply({ status: 'pending' }); }
  if (url.pathname === '/admin/api/login/callback') { qa.callbackOverlapped = qa.pollInFlight; return reply({ status: 'ok', username: 'fixture-user', is_pro: false }); }
  if (url.pathname === '/admin/api/overview') return reply({ accounts: accounts.length, ready: accounts.filter((account) => account.enabled && account.status !== 'error' && account.status !== 'blocked').length });
  if (url.pathname === '/health') return reply({ admin_required: false, accounts: accounts.length, ready: accounts.filter((account) => account.enabled && account.status !== 'error').length, degraded: 1, models: 0 });
  if (url.pathname === '/admin/api/version') return reply({ current: 'fixture' });
  return reply({ error: { message: `Unexpected fixture request: ${url.pathname}` } }, 404);
};

function Fixture() {
  const [page, setPage] = useState(location.hash.startsWith('#keys') ? 'keys' : 'accounts');
  const { lang, setLang } = useI18n();
  useEffect(() => { const change = () => setPage(location.hash.startsWith('#keys') ? 'keys' : 'accounts'); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  return <><nav className="flex flex-wrap gap-3 border-b border-border p-4 text-sm"><a href="#accounts">Accounts</a><a href="#keys">Keys</a><button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>Language</button><button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; }}>Theme</button></nav><main className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">{page === 'accounts' ? <AccountsPage /> : <KeysPage />}</main></>;
}
Object.assign(window, { runFixtureTests });
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider>{new URLSearchParams(location.search).has('shell') ? <App /> : <Fixture />}</I18nProvider></QueryClientProvider></React.StrictMode>);
