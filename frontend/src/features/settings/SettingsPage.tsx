import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { buildSettingsPatch, settingsToDraft, type Settings, type SettingsDraft, type SettingsPatch } from './settings-utils';

const inputClass = 'h-10 w-full rounded-lg border border-transparent bg-muted/70 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary';
const buttonClass = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-full bg-muted px-4 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';
type Section = 'runtime' | 'limits' | 'aliases' | 'password' | 'stats';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="grid gap-3 text-sm md:grid-cols-[minmax(0,1fr)_minmax(13rem,17rem)] md:items-center md:gap-8"><span className="min-w-0"><span className="block text-muted-foreground">{label}</span>{hint && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{hint}</span>}</span>{children}</label>;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsToDraft(initial));
  const dirty = useRef(false);
  const [section, setSection] = useState<Section>('runtime');
  const sectionNav = useRef<HTMLElement>(null);
  const [moreSections, setMoreSections] = useState(false);
  const updateSectionNav = () => {
    const nav = sectionNav.current;
    if (nav) setMoreSections(nav.scrollWidth - nav.clientWidth - nav.scrollLeft > 2);
  };
  useEffect(() => {
    updateSectionNav();
    window.addEventListener('resize', updateSectionNav);
    return () => window.removeEventListener('resize', updateSectionNav);
  }, []);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordSet, setPasswordSet] = useState(initial.admin_password_set);
  const [problem, setProblem] = useState<'aliases' | 'number' | 'password' | 'storage' | null>(null);
  const [saved, setSaved] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  useEffect(() => {
    if (!dirty.current) {
      setDraft(settingsToDraft(initial));
      setPasswordSet(initial.admin_password_set);
    }
  }, [initial]);
  const update = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => { dirty.current = true; setSaved(false); setDraft(current => ({ ...current, [key]: value })); };
  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => api<{ settings: Settings }>('/admin/api/settings', { method: 'POST', body: patch }),
    onSuccess: async (response, patch) => {
      if (patch.admin_password !== undefined) {
        try { sessionStorage.setItem('deepaicode2api_pw', patch.admin_password); }
        catch { setProblem('storage'); return; }
      }
      setPassword(''); setPasswordConfirm('');
      setDraft(settingsToDraft(response.settings));
      setPasswordSet(response.settings.admin_password_set);
      client.setQueryData(['settings'], response.settings);
      dirty.current = false;
      setSaved(true);
      await client.invalidateQueries();
    },
  });
  const reset = useMutation({
    mutationFn: () => api('/admin/api/stats', { method: 'DELETE' }),
    onSuccess: async () => { setResetDone(true); await client.invalidateQueries(); },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setProblem(null); setSaved(false);
    const result = buildSettingsPatch(draft);
    if ('error' in result) {
      setProblem(result.error);
      if (result.error === 'aliases') setSection('aliases');
      else {
        const positive = [draft.request_timeout_sec, draft.max_retries, draft.log_keep];
        setSection(positive.some(value => !value.trim() || !Number.isInteger(Number(value)) || Number(value) < 1) ? 'runtime' : 'limits');
      }
      return;
    }
    if ((password || passwordConfirm) && (!password.trim() || password !== passwordConfirm)) { setProblem('password'); setSection('password'); return; }
    if (password) {
      if (!window.confirm(t('确定修改管理口令？新口令将用于此标签页的后续请求。', 'Change the admin password? This tab will use the new password for subsequent requests.'))) return;
      result.patch.admin_password = password.trim();
    }
    save.mutate(result.patch);
  };
  const groups: { id: Section; label: string }[] = [
    { id: 'runtime', label: t('运行参数', 'Runtime') }, { id: 'limits', label: t('每密钥限流', 'Per-key limits') },
    { id: 'aliases', label: t('模型别名', 'Model aliases') }, { id: 'password', label: t('管理口令', 'Admin password') },
    { id: 'stats', label: t('统计管理', 'Statistics') },
  ];
  const error = save.error || reset.error;
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4"><h1 className="text-xl font-normal tracking-tight">{t('设置', 'Settings')}</h1><button className={`${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`} type="submit" form="settings-form" disabled={save.isPending}>{save.isPending ? t('保存中…', 'Saving…') : t('保存设置', 'Save settings')}</button></div>
    {error && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{t('操作失败：', 'Request failed: ')}{error instanceof Error ? error.message : String(error)}</p>}
    {problem && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{problem === 'aliases' ? t('模型别名必须是 JSON 对象，且每个目标必须是字符串。', 'Model aliases must be a JSON object with string values.') : problem === 'number' ? t('请检查数值：超时、重试和日志保留必须是大于零的整数；限流参数不能为负。', 'Check numeric values: timeout, retries and log retention must be positive integers; rate limits cannot be negative.') : problem === 'password' ? t('请输入非空的新口令，并确保两次输入一致。', 'Enter a non-empty password and make sure both entries match.') : t('设置已保存，但此标签页无法保存新口令；请使用新口令重新登录。', 'Settings were saved, but this tab could not store the new password. Please sign in again with the new password.')}</p>}
    {saved && <p role="status" className="rounded-lg bg-muted/70 p-3 text-sm">{t('设置已保存。', 'Settings saved.')}</p>}
    {resetDone && <p role="status" className="rounded-lg bg-muted/70 p-3 text-sm">{t('统计已重置，日志保留。', 'Statistics reset; logs were retained.')}</p>}
    <div className="flex min-w-0 flex-col gap-8 lg:flex-row lg:gap-7">
      <div className="relative min-w-0 shrink-0 lg:w-56"><nav ref={sectionNav} onScroll={updateSectionNav} aria-label={t('设置分组', 'Settings sections')} className="flex max-w-full gap-1 overflow-x-auto pb-1 pr-6 lg:flex-col lg:overflow-visible lg:p-0">{groups.map(group => <button key={group.id} type="button" aria-pressed={section === group.id} onClick={() => setSection(group.id)} className={`h-9 shrink-0 rounded-lg px-3 text-left text-sm transition-colors lg:w-full ${section === group.id ? 'bg-muted/80 text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}>{group.label}</button>)}</nav>{moreSections && <button type="button" className="absolute right-0 top-0 flex h-9 w-8 items-center justify-end bg-gradient-to-l from-background via-background to-transparent text-muted-foreground lg:hidden" aria-label={t('显示更多设置分组', 'Show more settings sections')} onClick={() => sectionNav.current?.scrollBy({ left: 180, behavior: 'smooth' })}><ChevronRight className="size-4" aria-hidden="true" /></button>}</div>
      <form id="settings-form" className="min-w-0 flex-1" onSubmit={submit} noValidate>
        <section hidden={section !== 'runtime'} aria-label={t('运行参数', 'Runtime')} className="space-y-8"><h2 className="text-base font-medium">{t('运行参数', 'Runtime')}</h2><div className="space-y-7">
          <Field label={t('请求超时（秒）', 'Request timeout (seconds)')} hint={t('等待上游请求完成的最长时间。', 'Maximum time to wait for an upstream request.')}><input className={inputClass} type="number" min="1" step="1" required value={draft.request_timeout_sec} onChange={e => update('request_timeout_sec', e.target.value)} /></Field>
          <Field label={t('最大重试次数', 'Maximum retries')} hint={t('请求失败时允许的最大重试次数。', 'Maximum retry attempts after a request fails.')}><input className={inputClass} type="number" min="1" step="1" required value={draft.max_retries} onChange={e => update('max_retries', e.target.value)} /></Field>
          <Field label={t('日志保留条数', 'Log retention count')} hint={t('内存中保留的最近请求条数。', 'Recent requests retained in memory.')}><input className={inputClass} type="number" min="1" step="1" required value={draft.log_keep} onChange={e => update('log_keep', e.target.value)} /></Field>
          <Field label={t('CORS 允许来源', 'Allowed CORS origins')} hint={t('多个来源用逗号分隔；留空时只允许本机来源。', 'Separate origins with commas; leave blank to allow local origins only.')}><input className={inputClass} value={draft.cors_origin} onChange={e => update('cors_origin', e.target.value)} placeholder="http://192.168.1.10:8080" /></Field>
          <Field label={t('兜底模型', 'Fallback model')} hint={t('留空时使用目录默认模型。', 'Leave blank to use the catalog default.')}><input className={inputClass} value={draft.fallback_model} onChange={e => update('fallback_model', e.target.value)} placeholder="glm-5.3-flash" /></Field>
          <Field label={t('严格模型模式', 'Strict model mode')} hint={t('未识别的模型名返回 404，不做静默回落。', 'Return 404 for unknown models instead of silently falling back.')}><span><input type="checkbox" className="size-4 accent-current" checked={draft.strict_model} onChange={e => update('strict_model', e.target.checked)} /></span></Field>
        </div></section>
        <section hidden={section !== 'limits'} aria-label={t('每密钥限流', 'Per-key limits')} className="space-y-8"><h2 className="text-base font-medium">{t('每密钥限流', 'Per-key limits')}</h2><div className="space-y-7">
          <Field label={t('每秒请求数', 'Requests per second')} hint={t('0 表示不限速。', '0 disables rate limiting.')}><input className={inputClass} type="number" min="0" step="any" value={draft.rate_limit_rps} onChange={e => update('rate_limit_rps', e.target.value)} /></Field>
          <Field label={t('限流桶容量', 'Rate limit burst')} hint={t('0 表示按速率自动设置。', '0 selects a capacity automatically from the rate.')}><input className={inputClass} type="number" min="0" step="1" value={draft.rate_limit_burst} onChange={e => update('rate_limit_burst', e.target.value)} /></Field>
          <Field label={t('并发上限', 'Concurrency limit')} hint={t('0 表示不限制并发。', '0 disables the concurrency limit.')}><input className={inputClass} type="number" min="0" step="1" value={draft.key_concurrency} onChange={e => update('key_concurrency', e.target.value)} /></Field>
        </div></section>
        <section hidden={section !== 'aliases'} aria-label={t('模型别名', 'Model aliases')} className="space-y-8"><h2 className="text-base font-medium">{t('模型别名', 'Model aliases')}</h2><Field label={t('别名映射', 'Alias mapping')} hint={t('用 JSON 将客户端模型名映射到目录模型 ID，也可在模型页逐条编辑。', 'Map client model names to catalog IDs as JSON, or edit them individually on the Models page.')}><textarea className="min-h-36 w-full rounded-lg border border-transparent bg-muted/70 px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary" spellCheck={false} value={draft.aliases} onChange={e => update('aliases', e.target.value)} /></Field><p className="text-xs text-muted-foreground">{'{"claude-sonnet-4": "glm-5.3-flash"}'}</p></section>
        <section hidden={section !== 'password'} aria-label={t('管理口令', 'Admin password')} className="space-y-8"><div><h2 className="text-base font-medium">{t('管理口令', 'Admin password')}</h2><p className="mt-2 text-sm text-muted-foreground">{passwordSet ? t('已设置口令。留空则保持不变。', 'A password is set. Leave blank to keep it unchanged.') : t('尚未设置口令。留空则保持不变。', 'No password is set. Leave blank to keep it unchanged.')}</p><p className="mt-2 text-sm text-muted-foreground">{t('如果启动时通过环境变量或参数设置了管理口令，重启后会以启动配置为准。', 'If the admin password is set by an environment variable or startup argument, the startup setting takes precedence after a restart.')}</p></div><div className="space-y-7"><Field label={t('新口令', 'New password')} hint={t('保存时会去掉首尾空格。', 'Leading and trailing whitespace is removed when saved.')}><input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={e => { dirty.current = true; setPassword(e.target.value); setSaved(false); }} /></Field><Field label={t('确认新口令', 'Confirm new password')}><input className={inputClass} type="password" autoComplete="new-password" value={passwordConfirm} onChange={e => { dirty.current = true; setPasswordConfirm(e.target.value); setSaved(false); }} /></Field></div></section>
        <section hidden={section !== 'stats'} aria-label={t('统计管理', 'Statistics')} className="space-y-8"><h2 className="text-base font-medium">{t('统计管理', 'Statistics')}</h2><div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(13rem,17rem)] md:items-center md:gap-8"><div><h3 className="text-sm text-muted-foreground">{t('重置统计', 'Reset statistics')}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t('清除累计和今日统计，保留请求日志。', 'Clear cumulative and daily statistics while retaining request logs.')}</p></div><div><button className={`${buttonClass} text-destructive`} type="button" disabled={reset.isPending} onClick={() => { setResetDone(false); if (window.confirm(t('确定重置统计？累计与今日统计将清零，日志不会被删除。', 'Reset statistics? Cumulative and daily counters will be cleared; logs will be retained.'))) reset.mutate(); }}><RotateCcw className="size-4" aria-hidden="true" />{t('重置统计', 'Reset statistics')}</button></div></div></section>
      </form>
    </div>
  </div>;
}

export default function SettingsPage() {
  const { t } = useI18n();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/admin/api/settings') });
  return <div className="space-y-6">{settings.error && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{t('加载设置失败：', 'Could not load settings: ')}{settings.error instanceof Error ? settings.error.message : String(settings.error)}</p>}{settings.data ? <SettingsForm initial={settings.data} /> : <div><h1 className="text-xl font-normal tracking-tight">{t('设置', 'Settings')}</h1>{settings.isLoading && <p className="mt-5 text-sm text-muted-foreground">{t('加载中…', 'Loading…')}</p>}</div>}</div>;
}
