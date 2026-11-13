export type Settings = {
  request_timeout_sec: number;
  max_retries: number;
  log_keep: number;
  cors_origin: string;
  fallback_model: string;
  strict_model: boolean;
  rate_limit_rps: number;
  rate_limit_burst: number;
  key_concurrency: number;
  model_aliases: Record<string, string> | null;
  admin_password_set: boolean;
};

export type SettingsDraft = {
  request_timeout_sec: string;
  max_retries: string;
  log_keep: string;
  cors_origin: string;
  fallback_model: string;
  strict_model: boolean;
  rate_limit_rps: string;
  rate_limit_burst: string;
  key_concurrency: string;
  aliases: string;
};

export function settingsToDraft(s: Settings): SettingsDraft {
  const num = (value: number | undefined | null) => value == null ? '' : String(value);
  return {
    request_timeout_sec: num(s.request_timeout_sec), max_retries: num(s.max_retries), log_keep: num(s.log_keep),
    cors_origin: s.cors_origin || '', fallback_model: s.fallback_model || '', strict_model: !!s.strict_model,
    rate_limit_rps: num(s.rate_limit_rps), rate_limit_burst: num(s.rate_limit_burst), key_concurrency: num(s.key_concurrency),
    aliases: JSON.stringify(s.model_aliases || {}, null, 2),
  };
}

export function parseAliases(raw: string): Record<string, string> | null {
  try {
    const value: unknown = JSON.parse(raw.trim() || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (Object.values(value).some(target => typeof target !== 'string')) return null;
    return value as Record<string, string>;
  } catch { return null; }
}

export type SettingsPatch = Omit<Settings, 'admin_password_set' | 'model_aliases'> & { model_aliases: Record<string, string>; admin_password?: string };
export type BuildPatchResult = { patch: SettingsPatch } | { error: 'aliases' | 'number' };

export function buildSettingsPatch(draft: SettingsDraft): BuildPatchResult {
  const model_aliases = parseAliases(draft.aliases);
  if (!model_aliases) return { error: 'aliases' };
  const positive = [draft.request_timeout_sec, draft.max_retries, draft.log_keep];
  const nonnegative = [draft.rate_limit_rps, draft.rate_limit_burst, draft.key_concurrency];
  if (positive.some(value => !value.trim() || !Number.isInteger(Number(value)) || Number(value) < 1) ||
      nonnegative.some(value => value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0)) ||
      [draft.rate_limit_burst, draft.key_concurrency].some(value => value.trim() && !Number.isInteger(Number(value)))) return { error: 'number' };
  return { patch: {
    request_timeout_sec: Number(draft.request_timeout_sec), max_retries: Number(draft.max_retries), log_keep: Number(draft.log_keep),
    cors_origin: draft.cors_origin.trim(), fallback_model: draft.fallback_model.trim(), strict_model: draft.strict_model,
    rate_limit_rps: Number(draft.rate_limit_rps || 0), rate_limit_burst: Number(draft.rate_limit_burst || 0),
    key_concurrency: Number(draft.key_concurrency || 0), model_aliases,
  } };
}
