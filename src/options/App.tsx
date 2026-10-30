import React, { useCallback, useEffect, useState } from 'react';
import { PROVIDERS, baseUrlOf, fetchModels, initialsOf, providerById } from '../lib/providers';
import { debounce, getLanguage, getPreferences, getProviders, getQuickActions, storage } from '../lib/storage';
import { t, type Lang } from '../i18n';
import type { Language, ProviderMap, QuickAction } from '../lib/types';
import { nanoid } from '../lib/types';
import { Settings, Zap, BookOpen, Globe, ChevronDown, ChevronUp, ExternalLink, Sparkles } from 'lucide-react';

type Route = '/' | '/quick-actions';
const GearSvg = () => <Settings size={16} />;
const ZapSvg = () => <Zap size={16} />;
const BookSvg = () => <BookOpen size={16} />;
const GlobeSvg = () => <Globe size={16} />;
const ChevronSvg = ({ up = false }: { up?: boolean }) => (up ? <ChevronUp size={16} /> : <ChevronDown size={16} />);
const ExternalSvg = () => <ExternalLink size={12} />;
const SparkleSvg = () => <Sparkles size={22} />;
const softInput = 'mt-1 w-full border border-[#dedee2] rounded-[10px] px-3 py-2 bg-white text-[14px] outline-none focus:border-[#b5b5ba] focus:ring-2 focus:ring-[#8ab7ff]/35';

export default function App() {
  const [route, setRoute] = useState<Route>(() => (window.location.hash.replace('#', '') as Route) || '/');
  const [lang, setLang] = useState<Language>('en-US');
  const [providers, setProviders] = useState<ProviderMap>({});
  const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState('');
  const [providerQuery, setProviderQuery] = useState('');
  const [editing, setEditing] = useState<QuickAction | null>(null);
  useEffect(() => {
    if (!editing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const modal = document.querySelector('.qa-dialog') as HTMLElement | null;
      if (!modal) return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editing]);
  const [deleteTarget, setDeleteTarget] = useState<QuickAction | null>(null);
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
  const [prefs, setPrefs] = useState<{ selectedModelId?: string }>({});
  const [comboOpen, setComboOpen] = useState<Record<string, boolean>>({});
  const [comboSearch, setComboSearch] = useState<Record<string, string>>({});

  useEffect(() => {
    const onHash = () => setRoute((window.location.hash.replace('#', '') as Route) || '/');
    window.addEventListener('hashchange', onHash);
    void (async () => { setLang(await getLanguage()); setProviders(await getProviders()); setQuickActions(await getQuickActions()); setPrefs(await getPreferences()); })();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const tr = (k: Parameters<typeof t>[1]) => t(lang as Lang, k);
  const persistProviders = useCallback(async (next: ProviderMap) => { setProviders(next); await storage.set('local', 'provider', next); }, []);
  const saveKey = useCallback(debounce((id: string, cfg: { apiKey: string; baseUrl?: string; models: { id: string; name: string; displayName: string }[] }) => {
    setProviders((prev) => { const next = { ...prev, [id]: cfg }; void storage.set('local', 'provider', next); return next; });
    setToast(tr('ui.saved'));
  }, 500), [tr]);

  const go = (r: Route) => { window.location.hash = r; setRoute(r); };
  const setLangAndSave = async (l: Language) => { setLang(l); await storage.set('sync', 'language', l); };

  const providerForm = (def: (typeof PROVIDERS)[number]) => {
    const cfg = providers[def.id] ?? { apiKey: '', baseUrl: def.defaultBaseUrl, models: def.defaultModels.map((id) => ({ id, name: id, displayName: id })) };
    const baseUrl = baseUrlOf(def, cfg);
    return (
      <div className="py-4 space-y-3">
        <label className="block text-[13px] font-medium">{tr('ui.providerApiKey')}
          <input type="password" defaultValue={cfg.apiKey} placeholder={def.id === 'ollama' ? 'Ollama Cloud API key' : def.needsKey ? 'sk-…' : ''} onChange={(e) => saveKey(def.id, { ...cfg, apiKey: e.target.value })} className={softInput} />
        </label>
        <a href={def.getKeyUrl} target="_blank" rel="noreferrer" className="text-[#777982] ml-3 text-xs inline-flex items-center gap-1">{def.id === 'ollama' ? tr('ui.providerGetOllama') : tr('ui.providerGetApiKey')} <ExternalSvg /></a>
        {def.baseUrlOptions ? (
          <label className="block text-[13px] font-medium">{tr('ui.providerSelectBaseUrl')}
            <select value={baseUrl} onChange={(e) => { const next = { ...cfg, baseUrl: e.target.value }; void persistProviders({ ...providers, [def.id]: next }); }} className={softInput}>
              {def.baseUrlOptions.map((o) => <option key={o.url} value={o.url}>{o.label} — {o.url}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label className="block text-[13px] font-medium">{tr('ui.providerBaseUrl')}
              <input defaultValue={baseUrl} onChange={(e) => { const next = { ...cfg, baseUrl: e.target.value }; void persistProviders({ ...providers, [def.id]: next }); }} className={softInput} />
            </label>
            {def.id === 'openai' && <p className="text-[12px] text-[#777982]">{tr('ui.providerBaseUrlDesc')}</p>}
          </>
        )}
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-medium">{tr('ui.providerModels')}</div>
          <button onClick={async () => {
            setLoadingModels((p) => ({ ...p, [def.id]: true }));
            try {
              const ids = await fetchModels(def, cfg);
              const next = { ...cfg, models: ids.map((id) => ({ id, name: id, displayName: id })) };
              await persistProviders({ ...providers, [def.id]: next }); setToast(tr('ui.saved'));
            } catch (e) { setToast(e instanceof Error ? e.message : tr('ui.saveFailed')); }
            setLoadingModels((p) => ({ ...p, [def.id]: false }));
          }} className="tool-btn labelled">{loadingModels[def.id] ? tr('ui.providerFetchingModels') : tr('ui.providerFetchModels')}</button>
        </div>
        {(() => {
          const search = (comboSearch[def.id] || '').toLowerCase();
          const filtered = cfg.models.filter((m) => (m.displayName || m.id).toLowerCase().includes(search));
          const selected = cfg.models.find((m) => prefs.selectedModelId === `${def.id}::${m.id}`);
          const selectModel = async (modelId: string) => {
            const next = { ...prefs, selectedModelId: `${def.id}::${modelId}` };
            setPrefs(next); await storage.set('local', 'preferences', next); setComboOpen((p) => ({ ...p, [def.id]: false }));
          };
          return (
            <div className="relative">
              <button type="button" onClick={() => setComboOpen((p) => ({ ...p, [def.id]: !p[def.id] }))} className="w-full border border-[#e8e8eb] rounded-lg px-3 py-2 bg-white shadow-sm flex items-center justify-between text-left text-[13px]">
                <span className="truncate">{selected ? (selected.displayName || selected.id) : cfg.models[0] ? (cfg.models[0].displayName || cfg.models[0].id) : tr('ui.selectModel')}</span>
                <ChevronSvg up={!!comboOpen[def.id]} />
              </button>
              {comboOpen[def.id] && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#e8e8eb] rounded-lg shadow-lg z-30 overflow-hidden">
                  <div className="p-2 border-b border-[#e8e8eb]/60">
                    <input
                      placeholder={tr('ui.providerSearchModels')}
                      value={comboSearch[def.id] || ''}
                      onChange={(e) => setComboSearch((p) => ({ ...p, [def.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        const id = (comboSearch[def.id] || '').trim(); if (!id) return;
                        if (!cfg.models.some((m) => m.id === id)) {
                          const next = { ...cfg, models: [...cfg.models, { id, name: id, displayName: id }] };
                          void persistProviders({ ...providers, [def.id]: next });
                        }
                        void selectModel(id); setComboSearch((p) => ({ ...p, [def.id]: '' }));
                      }}
                      className="w-full border border-[#e8e8eb] rounded-[8px] px-3 py-2 text-[13px] outline-none focus:border-[#d3d3d7]"
                    />
                  </div>
                  <div className="max-h-64 overflow-auto py-1">
                    {filtered.length === 0 && <div className="px-3 py-2 text-[13px] text-[#777982]">{tr('ui.providerNoModels')}</div>}
                    {filtered.map((m) => {
                      const isSel = prefs.selectedModelId === `${def.id}::${m.id}`;
                      return (
                        <div key={m.id} onClick={() => void selectModel(m.id)} className="flex items-center justify-between px-3 py-2 hover:bg-[#f6f6f7] cursor-pointer text-[13px]">
                          <span className={isSel ? 'font-medium text-[#242428]' : ''}>{m.displayName || m.id}</span>
                          <button
                            aria-label="Delete model"
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = { ...cfg, models: cfg.models.filter((x) => x.id !== m.id) };
                              void persistProviders({ ...providers, [def.id]: next });
                              if (isSel) { const np = { ...prefs, selectedModelId: undefined }; setPrefs(np); void storage.set('local', 'preferences', np); }
                            }}
                            className="text-[#777982] hover:text-red-600 px-1"
                          >×</button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-3 py-2 text-[12px] text-[#777982] border-t border-[#e8e8eb]/60">{tr('ui.providerPressEnter')}</div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-[#fafafa] text-[#202123]">
      <aside className="w-[220px] shrink-0 border-r border-[#ececef] flex flex-col bg-white">
        <nav className="flex-1 p-4 pt-3 space-y-1">
          <button onClick={() => go('/')} className={`w-full flex items-center gap-2 px-3 py-2 rounded-[8px] font-medium ${route === '/' ? 'bg-[#ececef]' : ''}`}><span className="text-[#656770] flex"><GearSvg /></span>{tr('ui.providers')}</button>
          <button onClick={() => go('/quick-actions')} className={`w-full flex items-center gap-2 px-3 py-2 rounded-[8px] font-medium ${route === '/quick-actions' ? 'bg-[#ececef]' : ''}`}><span className="text-[#656770] flex"><ZapSvg /></span>{tr('ui.quickActions')}</button>
        </nav>
        <div className="p-3">
          <label className="flex items-center gap-2 rounded-lg border border-[#ececef] bg-[#fafafa] px-3 py-2 text-sm cursor-pointer hover:bg-white transition-colors">
            <span className="text-[#777982] flex"><GlobeSvg /></span>
            <select aria-label="Language" value={lang} onChange={(e) => void setLangAndSave(e.target.value as Language)} className="flex-1 appearance-none bg-transparent outline-none cursor-pointer">
              <option value="en-US">English</option><option value="id">Bahasa Indonesia</option><option value="zh-CN">中文 (简体)</option><option value="zh-TW">中文 (繁體)</option><option value="ja-JP">日本語</option><option value="ko">한국어</option>
            </select>
            <span className="text-[#777982] flex"><ChevronSvg /></span>
          </label>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-[#fafafa]">
        <div className="max-w-[820px] mx-auto px-2 pt-10 pb-16">
          {toast && <div role="status" aria-live="polite" className="mb-4 border border-[#e8e8eb] rounded-[10px] px-3 py-2 bg-[#f4f4f4] text-[#202123] text-[13px]">{toast}</div>}
          {route === '/' && (
            <>
              <section className="px-8"><h2 className="text-[24px] font-semibold tracking-[-0.5px] mb-1">{tr('ui.modelProviders')}</h2></section>
              <div className="px-8 mb-3">
                <input value={providerQuery} onChange={(e) => setProviderQuery(e.target.value)} placeholder="Search providers..." className="w-full border border-[#e8e8eb] rounded-[8px] px-3 py-2 text-[13px] outline-none focus:border-[#d3d3d7]" />
              </div>
              <div className="divide-y divide-[#ececef] border border-[#ececef] rounded-2xl overflow-hidden bg-white mx-8">
                {PROVIDERS.filter((def) => !providerQuery.trim() || def.name.toLowerCase().includes(providerQuery.trim().toLowerCase())).map((def) => (
                  <div key={def.id}>
                    <button onClick={() => setOpen((p) => ({ ...p, [def.id]: !p[def.id] }))} className="w-full flex items-center gap-4 px-8 py-4 text-left">
                      <span className="w-[40px] h-[40px] rounded-[10px] bg-white border border-[#e8e8eb] flex items-center justify-center text-[13px] font-semibold text-[#242428] shrink-0 overflow-hidden">
                      {def.iconUrl ? <img src={def.iconUrl} alt="" className="w-6 h-6 object-contain" onError={(e) => { const img = e.currentTarget as HTMLImageElement; img.style.display = 'none'; const fb = img.nextElementSibling as HTMLElement | null; if (fb) fb.style.display = 'flex'; }} /> : null}
                      <span style={{ display: def.iconUrl ? 'none' : 'flex' }}>{initialsOf(def.name)}</span>
                    </span>
                      <span className="text-lg font-medium flex-1">{def.name}</span>
                      {(() => { const c = providers[def.id]; const n = c?.models?.length ?? 0; return n ? <span className="text-[12px] text-[#777982] mr-3">{n} models</span> : null; })()}
                      <span className="text-[#55565d] flex"><ChevronSvg up={!!open[def.id]} /></span>
                    </button>
                    {open[def.id] && <div className="pl-[92px] pr-8 pb-8">{providerForm(def)}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
          {route === '/quick-actions' && (
            <>
              <div className="flex items-start justify-between gap-4 px-8 mb-6">
                <div>
                  <h2 className="text-[24px] font-semibold tracking-[-0.5px]">{tr('ui.quickActions')}</h2>
                  <p className="text-[#777982] text-[14px] mt-1">{tr('ui.quickActionDesc')}</p>
                </div>
                <button onClick={() => setEditing({ id: '', title: '', instruction: '' })} className="new-chat shrink-0">＋ {tr('ui.newQuickAction')}</button>
              </div>
              <div className="space-y-2 mb-6 px-8">
                {quickActions.map((qa) => (
                  <div key={qa.id} className="flex items-center gap-2 border border-[#e8e8eb] rounded-lg bg-white px-4 py-3">
                    <span className="flex-1 font-medium">{qa.title}</span>
                    <button onClick={() => setEditing(qa)} className="px-3 py-1.5 border border-[#e8e8eb] rounded-[8px] text-[13px] text-[#55565d] hover:bg-[#f3f3f5]">Edit</button>
                    <button onClick={() => setDeleteTarget(qa)} className="px-3 py-1.5 border border-[#e8e8eb] rounded-[8px] text-[13px] text-[#b3261e] hover:bg-[#f3f3f5]">{tr('ui.delete')}</button>
                  </div>
                ))}
                {quickActions.length === 0 && (
                  <div className="border border-dashed border-[#d3d3d7] rounded-xl px-6 py-12 flex flex-col items-center text-center">
                    <span className="w-14 h-14 rounded-full bg-[#f4f4f4] flex items-center justify-center text-[#777982] mb-4"><SparkleSvg /></span>
                    <p className="font-semibold text-[16px]">{tr('ui.quickActionEmptyTitle')}</p>
                    <p className="text-[#777982] text-[13px] mt-1 max-w-[360px]">{tr('ui.quickActionEmptyDesc')}</p>
                    <button onClick={() => setEditing({ id: '', title: '', instruction: '' })} className="mt-5 new-chat">＋ {tr('ui.newQuickAction')}</button>
                  </div>
                )}
              </div>
              {editing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 qa-backdrop" role="presentation" onClick={() => setEditing(null)}>
                  <form className="w-full max-w-md rounded-2xl border border-[#ececef] bg-white p-6 space-y-5 shadow-xl qa-dialog" role="dialog" aria-modal="true" aria-label="Quick action" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(null); } }} onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      const next = editing.id ? quickActions.map((q) => q.id === editing.id ? editing : q) : [...quickActions, { ...editing, id: nanoid() }];
                      setQuickActions(next); await storage.set('local', 'quick-action', next); setEditing(null); setToast(tr('ui.saved'));
                    } catch { setToast(tr('ui.saveFailed')); }
                  }}>
                  <div className="space-y-1.5">
                    <label className="block text-[12px] font-semibold uppercase tracking-wide text-[#777982]">{tr('ui.title')}</label>
                    <input autoFocus value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required className={softInput} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[12px] font-semibold uppercase tracking-wide text-[#777982]">{tr('ui.instruction')}</label>
                    <textarea value={editing.instruction} onChange={(e) => setEditing({ ...editing, instruction: e.target.value })} required rows={6} className={softInput} />
                  </div>
                  <div className="rounded-lg bg-[#f7f7f8] px-3 py-2 text-[12px] text-[#777982]">
                    <span className="font-medium text-[#55565d]">{tr('ui.variables')}</span>{' '}
                    <code className="rounded bg-white px-1.5 py-0.5 text-[#242428]">{'{{date}}'}</code> — {tr('ui.quickActionVarDate')}. {tr('ui.quickActionExample')}: “Summarize today ({'{{date}}'}) news for me”.
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 min-w-[88px] border border-[#ececef] rounded-[8px] bg-white text-[#242428] hover:bg-[#f4f4f5]">{tr('ui.cancel')}</button>
                    <button type="submit" className="px-4 py-2 min-w-[88px] rounded-[8px] bg-[#242428] text-white hover:bg-[#3a3a3e]" style={{ color: '#fff' }}>{tr('ui.save')}</button>
                  </div>
                  </form>
                </div>
              )}
              {deleteTarget && (
                <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
                  <div className="bg-white rounded-[10px] p-4 w-full max-w-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
                    <p className="font-semibold">{tr('ui.quickActionDeleteTitle')}</p>
                    <p className="text-[13px] text-[#777982] mt-1">{tr('ui.quickActionDeleteDesc')}</p>
                    <div className="flex justify-end gap-2 mt-4">
                      <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 border border-[#e8e8eb] rounded-[8px]">{tr('ui.cancel')}</button>
                      <button onClick={async () => { const next = quickActions.filter((q) => q.id !== deleteTarget.id); setQuickActions(next); await storage.set('local', 'quick-action', next); setDeleteTarget(null); setToast(tr('ui.quickActionDeleted')); }} className="px-3 py-1.5 rounded-[8px] bg-[#b3261e] text-white hover:bg-[#931f19]">{tr('ui.delete')}</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
