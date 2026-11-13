import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { displayAccount, formatTime, type Account } from './account-utils';

const button = 'inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';
const input = 'min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

type Operation = { action: string; extra?: Record<string, unknown> };

export default function AccountActions({ account, mask, busy, error, onClose, onAction, onCheckin }: {
  account: Account;
  mask: boolean;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onAction: (operation: Operation) => Promise<boolean>;
  onCheckin: (id: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [editingGroup, setEditingGroup] = useState(false);
  const [group, setGroup] = useState(account.group || 'default');
  const [validation, setValidation] = useState('');
  const name = displayAccount(account, mask);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function run(operation: Operation, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return;
    if (await onAction(operation)) onClose();
  }

  return (
    <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="account-actions-title" className="!m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/25">
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="account-actions-title" className="text-base font-medium">{t('账号操作', 'Account actions')}</h2>
          <p className="mt-1 break-all text-sm text-muted-foreground">{name}</p>
        </div>
        <button type="button" className={`${button} h-10 w-10 p-0`} onClick={onClose} disabled={busy} aria-label={t('关闭', 'Close')}><X size={17} /></button>
      </div>
      <div className="space-y-5 p-5">
        {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div><dt className="text-muted-foreground">{t('分组', 'Group')}</dt><dd className="mt-1 break-all">{account.group || 'default'}</dd></div>
          <div><dt className="text-muted-foreground">{t('机器指纹', 'Machine fingerprint')}</dt><dd className="mt-1 break-all">{account.machine || t('未分配', 'Not assigned')}</dd></div>
          <div className="col-span-2"><dt className="text-muted-foreground">{t('代理', 'Proxy')}</dt><dd className="mt-1 break-all">{account.proxy || t('直连', 'Direct')}{account.fingerprint ? ` · ${account.fingerprint}` : ''}</dd></div>
          {account.theos?.refresh_at && <div className="col-span-2"><dt className="text-muted-foreground">{t('配额刷新时间', 'Quota refresh')}</dt><dd className="mt-1 break-all">{account.theos.refresh_at}</dd></div>}
          {account.last_err && <div className="col-span-2"><dt className="text-muted-foreground">{t('最近错误', 'Last error')}</dt><dd className="mt-1 break-words">{account.last_err}</dd></div>}
          <div className="col-span-2"><dt className="text-muted-foreground">{t('最近使用', 'Last used')}</dt><dd className="mt-1">{formatTime(account.last_used)}</dd></div>
        </dl>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="button" className={button} disabled={busy} onClick={async () => { if (await onCheckin(account.id)) onClose(); }}>{t('刷新此账号配额', 'Refresh quota')}</button>
          <button type="button" className={button} disabled={busy} onClick={() => void run({ action: 'toggle', extra: { id: account.id } })}>{account.enabled ? t('停用账号', 'Disable account') : t('启用账号', 'Enable account')}</button>
          {(account.failures || 0) > 0 && <button type="button" className={button} disabled={busy} onClick={() => void run({ action: 'clear-errors', extra: { id: account.id } })}>{t('清除错误', 'Clear errors')}</button>}
          <button type="button" className={button} disabled={busy} onClick={() => setEditingGroup((value) => !value)}>{t('更改分组', 'Change group')}</button>
          <button type="button" className={button} disabled={busy} onClick={() => void run({ action: 'assign-proxy', extra: { id: account.id, reassign: !!account.proxy } }, account.proxy ? t('从代理池重新分配这个账号的代理？', 'Reassign this account’s proxy from the pool?') : t('从代理池为这个账号分配代理？', 'Assign a proxy from the pool to this account?'))}>{account.proxy ? t('重绑代理', 'Reassign proxy') : t('绑定代理', 'Assign proxy')}</button>
          {account.proxy && <button type="button" className={button} disabled={busy} onClick={() => void run({ action: 'assign-proxy', extra: { id: account.id, clear: true } }, t('清除代理并恢复直连？', 'Clear the proxy and use a direct connection?'))}>{t('清除代理', 'Clear proxy')}</button>}
          {!account.has_machine && <button type="button" className={button} disabled={busy} onClick={() => void run({ action: 'assign-machine', extra: { id: account.id } }, t('为这个账号分配独立机器指纹？', 'Assign a unique machine fingerprint to this account?'))}>{t('分配机器指纹', 'Assign fingerprint')}</button>}
          {!account.email_verified && <button type="button" className={button} disabled={busy} onClick={() => void run({ action: 'mark-verified', extra: { id: account.id, email: account.email || '' } }, t('将这个账号标记为邮箱已验证？', 'Mark this account’s email as verified?'))}>{t('标记已验证', 'Mark verified')}</button>}
        </div>
        {editingGroup && <form className="space-y-2 rounded-lg bg-muted p-3" onSubmit={(event) => { event.preventDefault(); const value = group.trim(); if (!value) { setValidation(t('分组不能为空', 'Group cannot be empty')); return; } setValidation(''); void run({ action: 'set-group', extra: { id: account.id, group: value } }); }}>
          <label htmlFor="account-new-group" className="block text-sm font-medium">{t('新分组', 'New group')}</label>
          <div className="flex flex-wrap gap-2"><input id="account-new-group" className={`${input} min-w-0 flex-1`} value={group} onChange={(event) => setGroup(event.target.value)} disabled={busy} /><button type="submit" className={button} disabled={busy}>{t('保存', 'Save')}</button></div>
          {validation && <p role="alert" className="text-sm text-destructive">{validation}</p>}
        </form>}
        <div className="border-t border-border pt-4"><button type="button" className={`${button} text-destructive`} disabled={busy} onClick={() => void run({ action: 'remove', extra: { id: account.id } }, t(`确定删除账号 ${name}？`, `Delete account ${name}?`))}>{t('删除账号', 'Delete account')}</button></div>
      </div>
    </dialog>
  );
}
