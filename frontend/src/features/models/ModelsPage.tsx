import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

const inputClass = 'h-9 w-full rounded-lg border border-transparent bg-muted/70 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary';
const buttonClass = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-full bg-muted px-4 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';

type Model = {
  id: string; name?: string; reasoning?: boolean; input?: string[] | null;
  contextWindow?: number; maxTokens?: number; premier?: boolean; api?: string;
  theosPerRequest?: number | string | null; theosPerSecond?: Record<string, number | string> | null; free?: boolean;
};
type ModelsResponse = { models?: Model[] | null; default_model?: string; models_updated?: number };
type SettingsResponse = { model_aliases?: Record<string, string> | null };
type AliasRow = { name: string; target: string };
type SortKey = 'id' | 'name' | 'billing' | 'request' | 'second' | 'context' | 'max' | 'api' | 'input';

function perSecond(model: Model): string {
  const entries = Object.entries(model.theosPerSecond || {});
  if (!entries.length) return '—';
  return entries.length === 1 ? String(entries[0][1]) : entries.map(([key, value]) => `${key}: ${value}`).join(' · ');
}
function sortValue(model: Model, key: SortKey): number | string {
  switch (key) {
    case 'id': return model.id || '';
    case 'name': return model.name || model.id || '';
    case 'billing': return model.free === undefined ? -1 : Number(!model.free);
    case 'request': return model.theosPerRequest == null || model.theosPerRequest === '' || !Number.isFinite(Number(model.theosPerRequest)) ? -1 : Number(model.theosPerRequest);
    case 'second': return perSecond(model);
    case 'context': return model.contextWindow ?? 0;
    case 'max': return model.maxTokens ?? 0;
    case 'api': return model.api || 'chat';
    case 'input': return (model.input || []).join(',') + (model.reasoning ? ',reasoning' : '');
  }
}

function AliasManager({ initialAliases }: { initialAliases: Record<string, string> }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [rows, setRows] = useState<AliasRow[]>(() => Object.entries(initialAliases).map(([name, target]) => ({ name, target })));
  const dirty = useRef(false);
  const [problem, setProblem] = useState<'incomplete' | 'duplicate' | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!dirty.current) setRows(Object.entries(initialAliases).map(([name, target]) => ({ name, target })));
  }, [initialAliases]);
  const save = useMutation({
    mutationFn: (model_aliases: Record<string, string>) => api<{ settings?: SettingsResponse }>('/admin/api/settings', { method: 'POST', body: { model_aliases } }),
    onSuccess: async response => {
      setRows(Object.entries(response.settings?.model_aliases || {}).map(([name, target]) => ({ name, target })));
      if (response.settings) client.setQueryData(['settings'], response.settings);
      dirty.current = false;
      setSaved(true);
      await Promise.all([client.invalidateQueries({ queryKey: ['settings'] }), client.invalidateQueries({ queryKey: ['models'] }), client.invalidateQueries({ queryKey: ['overview'] })]);
    },
  });
  const change = (index: number, key: keyof AliasRow, value: string) => {
    dirty.current = true;
    setSaved(false);
    setRows(current => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  };
  const submit = () => {
    setSaved(false);
    setProblem(null);
    const cleaned = rows.map(row => ({ name: row.name.trim(), target: row.target.trim() })).filter(row => row.name || row.target);
    if (cleaned.some(row => !row.name || !row.target)) { setProblem('incomplete'); return; }
    const keys = cleaned.map(row => row.name.toLowerCase());
    if (new Set(keys).size !== keys.length) { setProblem('duplicate'); return; }
    save.mutate(Object.fromEntries(cleaned.map(row => [row.name, row.target])));
  };
  return <section className="border-t border-border pt-7">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-medium">{t('自定义模型别名', 'Custom model aliases')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('将客户端模型名映射到目录中的模型 ID。精确模型 ID 优先于别名；目标不存在时别名不会出现在目录中。', 'Map a client model name to a catalog model ID. Exact model IDs take precedence; aliases with missing targets are not listed in the catalog.')}</p></div><button type="button" className={buttonClass} onClick={() => { dirty.current = true; setSaved(false); setRows(current => [...current, { name: '', target: '' }]); }}><Plus className="size-4" aria-hidden="true" />{t('添加别名', 'Add alias')}</button></div>
    {problem && <p role="alert" className="mt-4 text-sm text-destructive">{problem === 'incomplete' ? t('每条别名都需要填写名称和目标模型。', 'Each alias needs a name and target model.') : t('别名名称不能重复（不区分大小写）。', 'Alias names must be unique (case-insensitive).')}</p>}
    {save.error && <p role="alert" className="mt-4 text-sm text-destructive">{t('保存失败：', 'Save failed: ')}{save.error instanceof Error ? save.error.message : String(save.error)}</p>}
    {saved && <p role="status" className="mt-4 text-sm text-muted-foreground">{t('别名已保存。', 'Aliases saved.')}</p>}
    {!rows.length && <p className="mt-4 text-sm text-muted-foreground">{t('尚无自定义别名。', 'No custom aliases yet.')}</p>}
    <div className="mt-4 space-y-3">{rows.map((row, index) => <div key={index} className="grid items-end gap-2 rounded-lg bg-muted/45 p-3 sm:grid-cols-[1fr_1fr_auto] sm:bg-transparent sm:p-0"><label className="space-y-1 text-sm"><span>{t('别名', 'Alias')}</span><input className={inputClass} value={row.name} onChange={e => change(index, 'name', e.target.value)} placeholder="claude-sonnet-4" /></label><label className="space-y-1 text-sm"><span>{t('目标模型 ID', 'Target model ID')}</span><input className={inputClass} value={row.target} onChange={e => change(index, 'target', e.target.value)} placeholder="glm-5.3-flash" /></label><button type="button" className={`${buttonClass} text-destructive`} aria-label={t(`删除别名 ${row.name || index + 1}`, `Remove alias ${row.name || index + 1}`)} onClick={() => { if (window.confirm(t('删除此别名？保存后会影响使用该别名的客户端。', 'Remove this alias? Saving will affect clients using it.'))) { dirty.current = true; setSaved(false); setRows(current => current.filter((_, i) => i !== index)); } }}><Trash2 className="size-4" aria-hidden="true" /><span className="sm:sr-only">{t('删除', 'Remove')}</span></button></div>)}</div>
    <div className="mt-4"><button type="button" className={`${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`} disabled={save.isPending} onClick={submit}><Save className="size-4" aria-hidden="true" />{save.isPending ? t('保存中…', 'Saving…') : t('保存别名', 'Save aliases')}</button></div>
  </section>;
}

export default function ModelsPage() {
  const { lang, t } = useI18n();
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const client = useQueryClient();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'id', desc: false });
  const [search, setSearch] = useState('');
  const models = useQuery({ queryKey: ['models'], queryFn: () => api<ModelsResponse>('/admin/api/models') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/admin/api/settings') });
  const refresh = useMutation({
    mutationFn: () => api<{ count: number }>('/admin/api/models', { method: 'POST', body: {} }),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['models'] }), client.invalidateQueries({ queryKey: ['overview'] })]); },
  });
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...(models.data?.models || [])].filter(model => !needle || `${model.id} ${model.name || ''}`.toLowerCase().includes(needle)).sort((a, b) => {
      const left = sortValue(a, sort.key), right = sortValue(b, sort.key);
      const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
      return sort.desc ? -order : order;
    });
  }, [models.data, search, sort]);
  const columns: { key: SortKey; label: string }[] = [
    { key: 'id', label: 'ID' }, { key: 'name', label: t('名称', 'Name') }, { key: 'billing', label: t('计费', 'Billing') },
    { key: 'request', label: t('Theos / 次', 'Theos / request') }, { key: 'second', label: t('Theos / 秒', 'Theos / second') },
    { key: 'context', label: t('上下文', 'Context') }, { key: 'max', label: t('最大输出', 'Max output') },
    { key: 'api', label: t('端点', 'Endpoint') }, { key: 'input', label: t('输入', 'Input') },
  ];
  const billing = (model: Model) => model.free === undefined ? t('未知', 'Unknown') : model.free ? t('免费额度', 'Free quota') : t('付费', 'Paid');
  const input = (model: Model) => [...(model.input || []), ...(model.reasoning ? [t('推理', 'Reasoning')] : [])].join(' · ') || '—';
  const number = (value?: number) => value == null ? '—' : value.toLocaleString(locale);
  const requestPrice = (model: Model) => model.theosPerRequest === '' || model.theosPerRequest == null ? '—' : model.theosPerRequest;
  const error = models.error || refresh.error || settings.error;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-xl font-normal tracking-tight">{t('模型目录', 'Models')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('上游模型、能力和计费信息。', 'Upstream models, capabilities and pricing.')}</p></div><button className={buttonClass} type="button" disabled={refresh.isPending} onClick={() => refresh.mutate()}><RefreshCw className="size-4" aria-hidden="true" />{refresh.isPending ? t('刷新中…', 'Refreshing…') : t('刷新模型目录', 'Refresh catalog')}</button></div>
    {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{t('操作失败：', 'Request failed: ')}{error instanceof Error ? error.message : String(error)}</p>}
    {refresh.isSuccess && <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">{t('模型目录已更新：', 'Catalog updated: ')}{refresh.data.count} {t('个模型。', 'models.')}</p>}
    <div><div className="flex flex-wrap items-center justify-between gap-4 pb-4"><div><h2 className="text-base font-medium">{t('可用模型', 'Available models')}</h2><p className="mt-1 text-xs text-muted-foreground">{t('默认模型', 'Default model')}: {models.data?.default_model || '—'} · {t('更新于', 'Updated')}: {models.data?.models_updated ? new Date(models.data.models_updated * 1000).toLocaleString(locale) : '—'}</p></div><label className="relative w-full sm:w-64"><span className="sr-only">{t('搜索模型', 'Search models')}</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input className={`${inputClass} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder={t('搜索模型名称或 ID', 'Search model name or ID')} /></label></div>
      <div className="flex items-center gap-2 border-b border-border py-3 lg:hidden"><label className="flex min-w-0 flex-1 items-center gap-2 text-sm"><span className="whitespace-nowrap">{t('排序', 'Sort')}</span><select className={`${inputClass} min-w-0`} value={sort.key} onChange={e => setSort({ key: e.target.value as SortKey, desc: false })}>{columns.map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</select></label><button type="button" className={buttonClass} aria-label={sort.desc ? t('降序，点击切换升序', 'Descending, switch to ascending') : t('升序，点击切换降序', 'Ascending, switch to descending')} onClick={() => setSort(current => ({ ...current, desc: !current.desc }))}>{sort.desc ? <ArrowDown className="size-4" aria-hidden="true" /> : <ArrowUp className="size-4" aria-hidden="true" />}</button></div>
      {models.isLoading ? <p className="p-5 text-sm text-muted-foreground">{t('加载中…', 'Loading…')}</p> : !rows.length ? <p className="p-5 text-sm text-muted-foreground">{t('没有符合条件的模型。', 'No matching models.')}</p> : <><div className="hidden overflow-x-auto lg:block"><table className="w-full text-left text-[13px]"><thead className="border-b border-border text-muted-foreground"><tr>{columns.map(column => <th scope="col" key={column.key} className="whitespace-nowrap px-3 py-3 font-medium" aria-sort={sort.key === column.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}><button className="inline-flex items-center gap-1 hover:text-foreground" type="button" onClick={() => setSort(current => ({ key: column.key, desc: current.key === column.key ? !current.desc : false }))}>{column.label}{sort.key === column.key && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}</button></th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map((model, index) => <tr key={`${model.id}-${index}`}><td className="px-3 py-3 font-mono">{model.id}</td><td className="px-3 py-3">{model.name || model.id}</td><td className="px-3 py-3 whitespace-nowrap">{billing(model)}</td><td className="px-3 py-3">{requestPrice(model)}</td><td className="px-3 py-3">{perSecond(model)}</td><td className="px-3 py-3">{number(model.contextWindow)}</td><td className="px-3 py-3">{number(model.maxTokens)}</td><td className="px-3 py-3">{model.api || 'chat'}</td><td className="px-3 py-3">{input(model)}</td></tr>)}</tbody></table></div>
      <div className="divide-y divide-border lg:hidden">{rows.map((model, index) => <article key={`${model.id}-${index}`} className="space-y-3 py-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-all font-medium">{model.name || model.id}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{model.id}</p></div><span className="rounded-full bg-muted px-2 py-1 text-xs">{billing(model)}</span></div><dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><div><dt className="text-muted-foreground">{t('Theos / 次', 'Theos / request')}</dt><dd>{requestPrice(model)}</dd></div><div><dt className="text-muted-foreground">{t('Theos / 秒', 'Theos / second')}</dt><dd>{perSecond(model)}</dd></div><div><dt className="text-muted-foreground">{t('上下文', 'Context')}</dt><dd>{number(model.contextWindow)}</dd></div><div><dt className="text-muted-foreground">{t('最大输出', 'Max output')}</dt><dd>{number(model.maxTokens)}</dd></div><div><dt className="text-muted-foreground">{t('端点', 'Endpoint')}</dt><dd>{model.api || 'chat'}</dd></div><div><dt className="text-muted-foreground">{t('输入', 'Input')}</dt><dd>{input(model)}</dd></div></dl></article>)}</div></>}
      <p className="border-t border-border py-3 text-xs text-muted-foreground">{t('目录来自上游；标记为免费额度的模型可使用每日 Theos 免费额度。', 'The catalog comes from upstream; models marked free quota can use the daily free Theos allowance.')}</p>
    </div>
    {settings.isLoading ? <p className="text-sm text-muted-foreground">{t('加载别名…', 'Loading aliases…')}</p> : settings.data && <AliasManager initialAliases={settings.data.model_aliases || {}} />}
  </div>;
}
