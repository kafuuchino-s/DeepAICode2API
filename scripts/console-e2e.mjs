// 用 CDP 驱动已有 Chrome 检查真实控制台：账号行、操作面板、服务端排序、
// 中英文切换和手机导航。服务需已运行并有账号；需要口令时先在该标签页登录。
// 用法：node scripts/console-e2e.mjs <baseURL> <shotDir>
// Chrome 默认使用 127.0.0.1:9222；可通过 CONSOLE_CDP_URL 指定其他本地端口。
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:10087';
const SHOT = process.argv[3] || 'bin/shots';
const DEBUG = process.env.CONSOLE_CDP_URL || 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() {
  // 本地 Chrome DevTools 协议只监听 127.0.0.1，不携带凭据。
  // pi-lens-ignore: typescript.react.security.react-insecure-request.react-insecure-request
  const response = await fetch(DEBUG + '/json/list');
  if (!response.ok) throw new Error(`无法读取 Chrome targets：HTTP ${response.status}`);
  return response.json();
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('无法连接 Chrome DevTools'));
  });
}

let seq = 0;
function send(ws, method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error(`Chrome DevTools 请求超时：${method}`));
    }, 15000);
    const onMessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id !== id) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'eval error');
  return result?.result?.value;
}

async function waitFor(ws, expression, description) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    try {
      const value = await evaluate(ws, expression);
      if (value) return value;
    } catch { /* 页面导航期间执行上下文会短暂不可用。 */ }
    await sleep(150);
  }
  const url = await evaluate(ws, 'location.href').catch(() => 'unknown');
  throw new Error(`等待${description}超时（当前地址 ${url}）；请检查服务、登录状态及账号数据`);
}

async function screenshot(ws, name) {
  const result = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  mkdirSync(SHOT, { recursive: true });
  writeFileSync(`${SHOT}/${name}.png`, Buffer.from(result.data, 'base64'));
  console.log('  shot:', name);
}

async function navigate(ws, hash, lang = 'zh') {
  const url = new URL(BASE);
  url.pathname = '/';
  url.search = '';
  url.searchParams.set('lang', lang);
  url.searchParams.set('cb', String(Date.now()));
  url.hash = hash;
  await send(ws, 'Page.navigate', { url: url.href });
  await waitFor(ws, `location.hash.startsWith(${JSON.stringify('#' + hash)}) && !!document.querySelector('main')`, '控制台页面');
}

const problems = [];
const requests = [];
let ws;

try {
  const list = await targets();
  const origin = new URL(BASE).origin;
  const page = list.find((target) => {
    if (target.type !== 'page') return false;
    try { return new URL(target.url).origin === origin; } catch { return false; }
  });
  if (!page) throw new Error(`没有指向 ${origin} 的 Chrome page target；请先在该标签页打开控制台并登录`);
  ws = await connect(page.webSocketDebuggerUrl);
  ws.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails;
      problems.push('exception: ' + (detail.exception?.description || detail.text) + ' @' + (detail.url || 'inline') + ':' + detail.lineNumber);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      problems.push('console.error: ' + message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
    if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/admin/api/accounts')) {
      requests.push(message.params.request.url);
    }
  });

  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');
  await send(ws, 'Network.enable');
  await send(ws, 'Network.setCacheDisabled', { cacheDisabled: true });
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await navigate(ws, 'accounts');
  await waitFor(ws, `document.querySelectorAll('main tbody tr').length > 0`, '账号表格（至少需要一个账号）');
  const rows = await evaluate(ws, `document.querySelectorAll('main tbody tr').length`);
  const nav = await evaluate(ws, `document.querySelector('nav a[href="#overview"]')?.textContent.trim()`);
  console.log('  rows:', rows, '| nav:', nav);
  if (nav !== '概览') problems.push('中文导航未生效: ' + nav);

  await evaluate(ws, `document.querySelector('main tbody tr button[aria-label^="账号操作"]').click()`);
  await waitFor(ws, `document.querySelector('dialog[open]')?.textContent.includes('刷新此账号配额')`, '账号操作面板');
  await screenshot(ws, 'cdp-menu-zh');
  await evaluate(ws, `document.querySelector('dialog[open] button[aria-label="关闭"]').click()`);
  requests.length = 0;
  await evaluate(ws, `Array.from(document.querySelectorAll('main thead th')).find(th => th.textContent.trim() === 'Theos').querySelector('button').click()`);
  await waitFor(ws, `document.querySelector('main thead th[aria-sort="ascending"]')?.textContent.trim() === 'Theos'`, 'Theos 排序指示');
  for (let i = 0; i < 40 && !requests.some((url) => new URL(url).searchParams.get('sort') === 'theos'); i++) await sleep(100);
  const sorted = requests.find((url) => new URL(url).searchParams.get('sort') === 'theos');
  if (!sorted) problems.push('点击 Theos 表头没有发出服务端排序请求');
  else console.log('  sort:', new URL(sorted).searchParams.get('sort'), new URL(sorted).searchParams.get('order'));

  await navigate(ws, 'accounts', 'en');
  await waitFor(ws, `document.querySelectorAll('main tbody tr').length > 0`, '英文账号表格');
  const enNav = await evaluate(ws, `document.querySelector('nav a[href="#overview"]')?.textContent.trim()`);
  const enHeader = await evaluate(ws, `document.querySelector('main thead th')?.textContent.trim()`);
  console.log('  en nav:', enNav, '| en header:', enHeader);
  if (enNav !== 'Overview') problems.push('英文导航未生效: ' + enNav);
  if (enHeader !== 'Account') problems.push('英文账号表头未生效: ' + enHeader);
  await screenshot(ws, 'cdp-accounts-en');

  await navigate(ws, 'overview', 'en');
  await waitFor(ws, `Array.from(document.querySelectorAll('main *')).some(el => el.childElementCount === 0 && el.textContent.trim() === 'Total requests')`, '英文概览指标');
  await screenshot(ws, 'cdp-overview-en');

  // Capture the same major pages that are compared with the reference design.
  // The checks use headings, so data may be empty without changing this entry point.
  const visualPages = [
    ['keys', 'API keys'], ['models', 'Models'], ['logs', 'Request logs'], ['settings', 'Settings'],
  ];
  async function capturePage(page, heading, name) {
    await navigate(ws, page, 'en');
    await waitFor(ws, `document.querySelector('main h1')?.textContent.trim() === ${JSON.stringify(heading)}`, `${heading} 页面`);
    await waitFor(ws, `!Array.from(document.querySelectorAll('main *')).some(el => el.childElementCount === 0 && /^Loading(…|\\.\\.\\.)$/.test(el.textContent.trim()))`, `${heading} 数据`);
    await screenshot(ws, name);
  }
  for (const [page, heading] of visualPages) await capturePage(page, heading, `cdp-${page}-en`);

  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await navigate(ws, 'accounts', 'en');
  await waitFor(ws, `!!document.querySelector('button[aria-label="Open navigation"]') && !!document.querySelector('main article')`, '手机账号页面');
  const widths = await evaluate(ws, `({client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth})`);
  if (widths.scroll > widths.client) problems.push(`手机页面横向溢出：${widths.client}/${widths.scroll}`);
  await evaluate(ws, `document.querySelector('button[aria-label="Open navigation"]').click()`);
  await waitFor(ws, `!!document.querySelector('[role="dialog"] nav a[href="#accounts"]')`, '手机导航抽屉');
  await screenshot(ws, 'cdp-mobile-navigation');
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(ws, `!document.querySelector('[role="dialog"] nav')`, 'Esc 关闭导航抽屉');
  await screenshot(ws, 'cdp-mobile-accounts');
  for (const [page, heading] of [['overview', 'Overview'], ...visualPages]) {
    await capturePage(page, heading, `cdp-mobile-${page}`);
    const size = await evaluate(ws, `({client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth})`);
    if (size.scroll > size.client) problems.push(`手机 ${heading} 页面横向溢出：${size.client}/${size.scroll}`);
  }

  if (problems.length) {
    console.error('\n问题:');
    problems.forEach((problem) => console.error('  -', problem));
    process.exitCode = 1;
  } else console.log('\n交互检查全部通过');
} catch (error) {
  console.error('FAILED:', error.message);
  process.exitCode = 1;
} finally {
  ws?.close();
}
