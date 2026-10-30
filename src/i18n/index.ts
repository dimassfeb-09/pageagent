import { en, type Dict } from './en';
import { zh } from './zh';
import { id } from './id';
export type Lang = 'en-US' | 'zh-CN' | 'zh-TW' | 'ja-JP' | 'ko' | 'id';
export function t(lang: Lang, key: keyof Dict): string {
  if (lang === 'zh-CN' || lang === 'zh-TW') return zh[key] ?? en[key];
  if (lang === 'id') return id[key] ?? en[key];
  return en[key];
}
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 3 * 3_600_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
