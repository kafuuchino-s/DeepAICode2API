import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

export interface LoginSession {
  session_id: string;
  open_url?: string;
  expires_in?: number;
}

export interface LoginResult {
  status: string;
  error?: string;
  username?: string;
  is_pro?: boolean;
}

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';
const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

type Status = { kind: 'waiting' | 'expired' | 'poll-error' | 'callback-error'; detail?: string };

export default function OAuthPanel({ session, onClose, onSuccess }: {
  session: LoginSession;
  onClose: () => void;
  onSuccess: (result: LoginResult) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>({ kind: 'waiting' });
  const [callback, setCallback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(true);
  const isSubmitting = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const deadline = useRef(Date.now() + (session.expires_in || 600) * 1000);
  const pollRef = useRef<() => void>(() => {});
  const url = new URL(session.open_url || `/login/open?id=${encodeURIComponent(session.session_id)}`, window.location.origin).href;

  useEffect(() => {
    active.current = true;
    function stop() {
      active.current = false;
      if (timer.current) clearTimeout(timer.current);
    }
    function schedule() {
      if (active.current && !isSubmitting.current) timer.current = setTimeout(() => pollRef.current(), 2000);
    }
    pollRef.current = () => {
      if (!active.current || isSubmitting.current) return;
      if (Date.now() >= deadline.current) { stop(); setStatus({ kind: 'expired' }); return; }
      const request = (async () => {
        try {
          const result = await api<LoginResult>('/admin/api/login/poll', { method: 'POST', body: { session_id: session.session_id } });
          if (!active.current) return;
          if (result.status === 'ok') { stop(); onSuccessRef.current(result); }
          else if (result.status === 'expired') { stop(); setStatus({ kind: 'expired' }); }
          else if (result.status === 'error') { stop(); setStatus({ kind: 'poll-error', detail: result.error }); }
        } catch (error) {
          if (active.current) { stop(); setStatus({ kind: 'poll-error', detail: error instanceof Error ? error.message : String(error) }); }
        } finally {
          schedule();
        }
      })();
      inflight.current = request;
      void request.finally(() => { if (inflight.current === request) inflight.current = null; });
    };
    schedule();
    return stop;
  }, [session.session_id]);

  async function copyLink() {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); copied = true; }
    } catch { /* Try the selection-based copy for insecure origins or denied permission. */ }
    if (!copied) {
      input.current?.focus(); input.current?.select();
      try { copied = !!input.current && document.execCommand('copy'); } catch { /* Keep the selection for manual copying. */ }
    }
    setCopyMessage(copied ? t('登录链接已复制', 'Login link copied') : t('请复制已选中的链接', 'Copy the selected link'));
  }

  async function submitCallback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!callback.trim() || isSubmitting.current) return;
    isSubmitting.current = true;
    setSubmitting(true);
    if (timer.current) clearTimeout(timer.current);
    // Do not race a poll that can consume the same one-time session.
    if (inflight.current) await inflight.current;
    if (!active.current) { setSubmitting(false); isSubmitting.current = false; return; }
    try {
      const result = await api<LoginResult>('/admin/api/login/callback', { method: 'POST', body: { session_id: session.session_id, callback: callback.trim() } });
      if (!active.current) return;
      if (result.status === 'ok') { active.current = false; onSuccessRef.current(result); }
      else if (result.status === 'expired') { active.current = false; setStatus({ kind: 'expired' }); }
      else setStatus({ kind: 'callback-error', detail: result.error });
    } catch (error) {
      if (active.current) setStatus({ kind: 'callback-error', detail: error instanceof Error ? error.message : String(error) });
    } finally {
      isSubmitting.current = false;
      setSubmitting(false);
      if (active.current) timer.current = setTimeout(() => pollRef.current(), 2000);
    }
  }

  const statusText = status.kind === 'waiting' ? t('等待浏览器完成登录…', 'Waiting for browser sign-in…')
    : status.kind === 'expired' ? t('登录会话已过期，请重新发起。', 'The login session expired. Start again.')
      : `${status.kind === 'poll-error' ? t('登录失败', 'Sign-in failed') : t('回调兑换失败', 'Callback exchange failed')}: ${status.detail || t('未知错误', 'Unknown error')}`;

  return <section className="rounded-lg bg-card p-5" aria-labelledby="oauth-title">
    <div className="flex items-start justify-between gap-4"><div><h2 id="oauth-title" className="font-semibold">{t('浏览器登录', 'Browser sign-in')}</h2><p role="status" className={`mt-2 text-sm ${status.kind === 'waiting' ? 'text-muted-foreground' : 'text-destructive'}`}>{statusText}</p></div><button type="button" onClick={onClose} className={`${button} h-10 w-10 p-0`} aria-label={t('取消登录', 'Cancel sign-in')}><X size={17} /></button></div>
    <p className="mt-4 text-sm text-muted-foreground">{t('如果登录页没有自动打开，可使用下方链接。该链接可在能访问网关的其他浏览器或设备上使用。', 'If the sign-in page did not open, use the link below. It also works on another browser or device that can reach the gateway.')}</p>
    <div className="mt-3 flex flex-wrap gap-2"><a href={url} target="_blank" rel="noopener noreferrer" className={button}><ExternalLink size={15} />{t('打开登录页', 'Open sign-in page')}</a><button type="button" onClick={() => void copyLink()} className={button}><Copy size={15} />{t('复制链接', 'Copy link')}</button></div>
    <label htmlFor="oauth-link" className="mt-3 block text-sm font-medium">{t('登录链接', 'Sign-in link')}</label>
    <input id="oauth-link" ref={input} className={`${field} mt-1`} value={url} readOnly spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
    {copyMessage && <p role="status" className="mt-1 text-sm text-muted-foreground">{copyMessage}</p>}
    <form className="mt-5 space-y-2" onSubmit={(event) => void submitCallback(event)}>
      <label htmlFor="oauth-callback" className="block text-sm font-medium">{t('回调 URL', 'Callback URL')}</label>
      <p className="text-sm text-muted-foreground">{t('Docker 或远程部署时，如果浏览器无法打开 127.0.0.1 回调，请复制地址栏中的完整 URL 并粘贴到这里。', 'For Docker or remote deployments, if the 127.0.0.1 callback cannot open, paste the complete URL from the browser address bar here.')}</p>
      <textarea id="oauth-callback" className={`${field} min-h-24`} value={callback} onChange={(event) => setCallback(event.target.value)} placeholder="http://127.0.0.1:34105/auth-callback?code=…&state=…" spellCheck={false} disabled={submitting || !active.current} />
      <button type="submit" className={button} disabled={!callback.trim() || submitting || !active.current}>{submitting ? t('正在兑换…', 'Completing sign-in…') : t('提交回调 URL', 'Submit callback URL')}</button>
    </form>
  </section>;
}
