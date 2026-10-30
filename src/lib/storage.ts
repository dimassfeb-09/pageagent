// chrome.storage with a localStorage fallback for the web-dev demo (vite dev).
// Keys mirror the original extension exactly.
import type { ChatTab, Language, Preferences, ProviderMap, QuickAction } from './types';

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage;
const ls = (area: 'local' | 'sync') => ({
  async get<T>(key: string): Promise<T | undefined> {
    try { const raw = localStorage.getItem(`${area}:${key}`); return raw ? (JSON.parse(raw) as T) : undefined; } catch { return undefined; }
  },
  async set(key: string, value: unknown): Promise<void> { localStorage.setItem(`${area}:${key}`, JSON.stringify(value)); },
  async remove(key: string): Promise<void> { localStorage.removeItem(`${area}:${key}`); },
});
const area = (a: 'local' | 'sync') => hasChrome ? chrome.storage[a] : ls(a);

export const storage = {
  async get<T>(a: 'local' | 'sync', key: string): Promise<T | undefined> {
    if (hasChrome) { const r = await chrome.storage[a].get(key); return r[key] as T | undefined; }
    return ls(a).get<T>(key);
  },
  async set(a: 'local' | 'sync', key: string, value: unknown): Promise<void> {
    if (hasChrome) await chrome.storage[a].set({ [key]: value }); else await ls(a).set(key, value);
  },
  isExtension: hasChrome,
};

export async function getUserId(): Promise<string> {
  let id = await storage.get<string>('local', 'userId');
  if (!id) { id = (await import('./types')).nanoid(21); await storage.set('local', 'userId', id); }
  return id;
}
export async function getLanguage(): Promise<Language> {
  const saved = await storage.get<Language>('sync', 'language');
  if (saved) return saved;
  const nav = (navigator.language || 'en-US') as Language;
  return (['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko', 'id'] as Language[]).includes(nav) ? nav : 'en-US';
}
export async function getProviders(): Promise<ProviderMap> { return (await storage.get<ProviderMap>('local', 'provider')) ?? {}; }
export async function getPreferences(): Promise<Preferences> { return (await storage.get<Preferences>('local', 'preferences')) ?? {}; }
const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { id: 'default-qa-grid', title: 'Soal Grid (semua soal tampil)', instruction: '1. Scan halaman untuk menemukan semua soal dan pilihan jawaban (A/B/C/D).\n2. Untuk setiap soal, baca teks soal dan semua opsi.\n3. Pilih jawaban yang paling benar; klik opsi yang sesuai.\n4. Ulangi untuk semua soal (boleh loncat urutan).\n5. Setelah semua soal terisi, re-scan untuk memastikan tidak ada yang kosong.\n6. Jangan klik Submit sampai semua soal terjawab dan user konfirmasi.\n7. Jika ada soal ambigu/tidak yakin, tanya user sebelum memilih.' },
  { id: 'default-qa-next', title: 'Soal Next (satu per satu)', instruction: '1. Fokus hanya pada soal yang tampil saat ini.\n2. Baca soal dan opsi, pilih jawaban terbaik, klik opsi.\n3. Verifikasi pilihan sudah tercentang/terpilih.\n4. Klik tombol Next/Soal Berikutnya.\n5. Ulangi sampai soal terakhir.\n6. Di soal terakhir, jangan auto-submit; beri ringkasan jawaban lalu tunggu konfirmasi user.' },
  { id: 'default-qa-revert', title: 'Soal Bisa Kembali (ubah jawaban)', instruction: '1. Jawab soal yang tampil.\n2. Sebelum Next, cek apakah user ingin mengubah jawaban.\n3. Jika ingin ubah, klik opsi lain (revert) dan verifikasi pilihan baru.\n4. Setelah yakin, klik Next.\n5. Ulangi untuk semua soal.\n6. Sebelum submit, scan ulang semua jawaban final dan minta konfirmasi user.' },
  { id: 'default-qa-noback', title: 'Soal Tanpa Kembali (sekali jalan)', instruction: '1. Baca soal dan semua opsi dengan teliti.\n2. Pilih jawaban terbaik; jangan klik terburu-buru.\n3. Sebelum klik Next, konfirmasi pilihan (karena tidak bisa kembali).\n4. Klik Next hanya setelah yakin.\n5. Ulangi sampai soal terakhir.\n6. Di akhir, jangan auto-submit; tampilkan ringkasan jawaban dan tunggu konfirmasi user.' },
];
export async function getQuickActions(): Promise<QuickAction[]> {
  const stored = await storage.get<QuickAction[]>('local', 'quick-action');
  // Seed defaults when nothing usable is stored (missing, null, or emptied on web/dev).
  if (Array.isArray(stored) && stored.length > 0) return stored;
  await storage.set('local', 'quick-action', DEFAULT_QUICK_ACTIONS);
  return DEFAULT_QUICK_ACTIONS;
}
export async function getChats(): Promise<ChatTab[]> { return (await storage.get<ChatTab[]>('local', 'chats')) ?? []; }
export async function getChatTabs(): Promise<ChatTab[]> { return (await storage.get<ChatTab[]>('local', 'chat-tabs')) ?? []; }
export async function saveChatTabs(tabs: ChatTab[]): Promise<void> {
  await storage.set('local', 'chats', tabs);
  await storage.set('local', 'chat-tabs', tabs);
}
export const debounce = <T extends unknown[]>(fn: (...args: T) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
