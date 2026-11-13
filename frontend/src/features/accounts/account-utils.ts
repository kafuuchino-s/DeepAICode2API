export interface Account {
  id: string;
  name?: string;
  email?: string;
  username?: string;
  source?: string;
  key?: string;
  group?: string;
  plan?: string;
  is_pro?: boolean;
  email_verified?: boolean;
  enabled: boolean;
  status?: string;
  failures?: number;
  quota_until?: number;
  last_used?: number;
  last_err?: string;
  proxy?: string;
  fingerprint?: string;
  machine?: string;
  has_machine?: boolean;
  theos?: { balance?: string; granted?: string; refresh_at?: string } | null;
}

export function maskWord(value: string): string {
  if (!value) return '';
  if (value.length <= 2) return `${value.slice(0, 1)}*`;
  return `${value.slice(0, 1)}***${value.length > 4 ? value.slice(-1) : ''}`;
}

export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  return at > 0 ? `${value.slice(0, 1)}***${value.slice(at)}` : maskWord(value);
}

export function displayAccount(account: Account, mask: boolean): string {
  const value = account.email || account.name || account.id;
  return mask ? maskEmail(value) : value;
}

export function formatTime(seconds?: number): string {
  if (!seconds) return '—';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
