// Sidepanel UI: Chatspace layout ported from the user-supplied static file
// (structure + classes + texts verbatim), wired to the real PageAgent chat
// pipeline (send/streaming/tools/storage). See README "Chatspace UI" section
// for the wiring map and the deliberate deviations from the static demo.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '../lib/markdown';
import { t, type Lang } from '../i18n';
import { AGENT_SYSTEM_PROMPT, ASK_SYSTEM_PROMPT, renderUserContext } from '../lib/prompts';
import type { TaskState } from '../lib/types';
import { PROVIDERS, baseUrlOf, providerById } from '../lib/providers';
import { debounce, getChats, getLanguage, getPreferences, getProviders, getQuickActions, getUserId, saveChatTabs, storage } from '../lib/storage';
import { executeTool, getTabMarkdown, listOpenTabs } from '../lib/tools';
import { streamChat, TOOL_DEFS, type LlmMessage } from '../lib/llm';
import { PanelLeftClose, PanelLeftOpen, Plus, MessageSquare, Search, Settings, ChevronDown, ArrowUp, Share2, MoreHorizontal, Bot, Menu, Sparkles, Zap, Copy, ThumbsUp, ThumbsDown, RefreshCw, MousePointerClick, Keyboard, Globe, Eye, Cog, Star, Paperclip, Image as ImageIcon, File as FileIcon, X, Download, FileJson, Trash2, Archive, Pencil, Moon, Sun, Loader2, Check, AlertCircle } from 'lucide-react';
import type { ChatMessage, ChatTab, Language, ProviderMap, SelectedElement, SelectedTabInfo, ChatMode, ToolCall } from '../lib/types';
import { nanoid } from '../lib/types';

const isExt = typeof chrome !== 'undefined' && !!chrome.runtime?.connect;
const MAX_ATTACHMENT_TEXT = 20000;

const todayStr = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

// SVG icons now provided by lucide-react.
const CopySvg = () => <Copy size={15} />;
const LikeSvg = () => <ThumbsUp size={15} />;
const DislikeSvg = () => <ThumbsDown size={15} />;
const RegenSvg = () => <RefreshCw size={15} />;
const SUGGESTIONS: { title: string; desc: string; prompt: string }[] = [
  { title: 'Build something', desc: 'Plan a personal website from scratch', prompt: 'Help me plan a clean personal website' },
  { title: 'Learn something', desc: 'Get a clear, step-by-step explanation', prompt: 'Explain this topic step by step: REST API' },
  { title: 'Explore ideas', desc: 'Find practical projects worth building', prompt: 'Give me 5 practical project ideas using Go' },
  { title: 'Improve my work', desc: 'Review code, writing, or a plan', prompt: 'Review this code and suggest improvements' },
];
type Pop = 'attach' | 'tools' | 'mode' | 'more' | 'model' | 'profile' | 'tabs' | 'voice' | 'quick' | null;

function toolVisual(name: string, args: Record<string, unknown>): { icon: React.ReactElement; label: string } {
  const id = args.id ? String(args.id) : '';
  if (name === 'clickElementByAiID') return { icon: <MousePointerClick size={13} />, label: id ? `Click element ${id}` : 'Click element' };
  if (name === 'inputTextByAiID') return { icon: <Keyboard size={13} />, label: id ? `Type into field ${id}` : 'Type into field' };
  if (name === 'findAccessableElementsFromTab' || name === 'findAccessibleElementsFromTab') return { icon: <Eye size={13} />, label: 'Find interactive elements' };
  if (name === 'openNewTabWithURL' || name === 'openSearchTab') return { icon: <Globe size={13} />, label: name === 'openSearchTab' ? 'Open search tab' : 'Open URL' };
  if (name === 'getTabContent' || name === 'getBrowserHistory' || name === 'getAllTabs') return { icon: <Search size={13} />, label: 'Read browser context' };
  const l = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return { icon: <Cog size={13} />, label: l.replace(/^./, (c) => c.toUpperCase()) };
}

function toolCallFailed(tc: ToolCall): boolean {
  const result = tc.result as unknown;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if ('ok' in r) return r.ok !== true;
    if ('clicked' in r) return r.clicked !== true;
    if ('error' in r) return true;
  }
  if (!result) return tc.status !== 'done';
  return false;
}
function friendlyToolError(tc: ToolCall): string {
  const result = tc.result as unknown;
  let raw = '';
  if (result && typeof result === 'object') raw = String((result as Record<string, unknown>).error ?? '');
  else if (typeof result === 'string') raw = result;
  if (raw === 'NEED_PAGE_CONTENT_ACCESS_PERMISSION') return 'Need page access permission. Open extension settings to grant it.';
  if (raw.includes('chrome://')) return "Can't read chrome:// pages.";
  if (raw.includes('Cannot access')) return 'Cannot access this page.';
  return raw || 'Tool failed';
}
function toolSummary(tc: ToolCall): string {
  const result = tc.result as unknown;
  if (!result) return 'Done';
  if (Array.isArray(result)) return `Read ${result.length} item${result.length === 1 ? '' : 's'}`;
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.count === 'number') return `Found ${r.count}`;
    if (Array.isArray(r.tabs)) return `Read ${r.tabs.length} tab${r.tabs.length === 1 ? '' : 's'}`;
    if (Array.isArray(r.elements)) return `Found ${r.elements.length} element${r.elements.length === 1 ? '' : 's'}`;
    if (r.ok === true) return 'Done';
  }
  return 'Done';
}

function messageToLlmMessage(m: ChatMessage): LlmMessage {
  if (m.role === 'assistant') return { role: 'assistant', content: m.content, reasoning_content: m.thinking || undefined, tool_calls: undefined };
  if (m.role === 'tool' || m.role === 'system') return { role: m.role, content: m.content };
  const attachments = m.attachments || [];
  const imageParts = attachments
    .filter((a) => a.kind === 'image' && a.dataUrl)
    .map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl! } }));
  const fileNotes = attachments.filter((a) => a.kind !== 'image' && (a.text || a.name)).map((a) => `Attached file: ${a.name}${a.text ? `\n\`\`\`${a.text}\`\`\`` : ''}`).join('\n\n');
  const selectedElementNotes = (m.selectedElements || []).map((e) => `Selected element: <${e.tagName}> id=${e.aiId} value=${e.value || ''} text=${e.innerText || ''}`).join('\n');
  const selectedTabNotes = (m.selectedTabs || []).map((t) => `Tab: ${t.title} (${t.url})\n${(t.markdown || '').slice(0, 8000)}`).join('\n\n');
  const text = [m.content, fileNotes, selectedElementNotes, selectedTabNotes].filter(Boolean).join('\n\n') || (attachments.length ? '(attachments)' : '');
  if (!imageParts.length) return { role: 'user', content: text };
  return { role: 'user', content: [{ type: 'text', text }, ...imageParts] };
}

export default function App() {
  const [providers, setProviders] = useState<ProviderMap>({});
  const [prefs, setPrefs] = useState<{ selectedModelId?: string }>({});
  const [chats, setChats] = useState<ChatTab[]>([]);
  const [quickActions, setQuickActions] = useState<{ id: string; title: string; instruction: string }[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [mode, setMode] = useState<ChatMode>('ask');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [taskState, setTaskState] = useState<TaskState>({ phase: 'idle', step: 'No active task', confidence: 'low' });
  const taskStateRef = useRef<TaskState>(taskState);
  const [selectedElements, setSelectedElements] = useState<SelectedElement[]>([]);
  const [pickedTabs, setPickedTabs] = useState<SelectedTabInfo[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [autoPageContext, setAutoPageContext] = useState(() => { try { return window.localStorage.getItem('pageagent.autoPageContext') !== 'false'; } catch { return true; } });
  const [currentTab, setCurrentTab] = useState<SelectedTabInfo | null>(null);
  const currentTabRef = useRef<SelectedTabInfo | null>(null);
  const [openTabs, setOpenTabs] = useState<{ id: number; title: string; url: string; favIconUrl?: string }[]>([]);
  const [showTabPicker, setShowTabPicker] = useState(false);
  type PendingAttachment = NonNullable<ChatMessage['attachments']>[number];
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [errorMsg, setErrorMsg] = useState('');
  // Chatspace chrome state.
  const [collapsed, setCollapsed] = useState(() => { try { return window.localStorage.getItem('pageagent.sidebarCollapsed') === 'true'; } catch { return false; } });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 760);
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(window.localStorage.getItem('pageagent.sidebarWidth') || 280));
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dark, setDark] = useState(() => { try { const stored = window.localStorage.getItem('pageagent.dark'); if (stored === 'true') return true; if (stored === 'false') return false; } catch { /* ignore */ } return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches; });
  const [lang, setLang] = useState<Language>('en-US');
  const [messageLimit, setMessageLimit] = useState(60);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [chatMenuId, setChatMenuId] = useState<string | null>(null);
  const tr = (k: Parameters<typeof t>[1]) => t(lang as Lang, k);
  const [toast, setToast] = useState('');
  const [openPop, setOpenPop] = useState<Pop>(null);
  const [modelQuery, setModelQuery] = useState('');  const [activeNav, setActiveNav] = useState<'chat' | 'search' | 'library'>('chat');
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setPendingAttachments([]); setOpenPop(null); setMessageLimit(60); }, [activeId]);



  const portRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeChatRef = useRef<ChatTab | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const convRef = useRef<HTMLElement | null>(null);
  const nearBottomRef = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);


  const notify = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1900);
  }, []);

  useEffect(() => { document.body.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => { try { window.localStorage.setItem('pageagent.sidebarCollapsed', String(collapsed)); } catch { /* ignore */ } }, [collapsed]);
  useEffect(() => {
    void getLanguage().then(setLang);
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'sync' && changes.language?.newValue) setLang(changes.language.newValue as Language);
    };
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) chrome.storage.onChanged.addListener(onChanged);
    return () => { if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) chrome.storage.onChanged.removeListener(onChanged); };
  }, []);
  useEffect(() => {
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mql) return;
    const handler = (e: MediaQueryListEvent) => {
      try { if (window.localStorage.getItem('pageagent.dark') !== null) return; } catch { /* ignore */ }
      setDark(e.matches);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  // Close dropdowns/pops on outside click (demo behaviour).
  // Close transient UI and the mobile drawer when the user clicks outside the relevant surface.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest('.composer-pop') && !el.closest('.more-wrap')) setOpenPop(null);
      if (mobileOpen && window.innerWidth <= 760 && !el.closest('.sidebar') && !el.closest('#mobileMenu')) setMobileOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [mobileOpen]);

  const activeChat = chats.find((c) => c.id === activeId) ?? chats[0];
  activeChatRef.current = activeChat ?? null;

  function newChatTab(): ChatTab { const now = Date.now(); return { id: nanoid(), title: 'New Chat', messages: [], createdAt: now, updatedAt: now }; }
  const togglePin = useCallback((id: string) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));
  }, []);
  const toggleArchive = useCallback((id: string) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, archived: !c.archived } : c)));
  }, []);
  useEffect(() => {
    if (!chatMenuId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('.chat-menu') && !target.closest('.chat-more')) setChatMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [chatMenuId]);

  const loadAll = useCallback(async () => {
    setProviders(await getProviders());
    const storedPrefs = await getPreferences();
    if (!storedPrefs.selectedModelId) { storedPrefs.selectedModelId = 'ollama::beam'; await storage.set('local', 'preferences', storedPrefs); }
    setPrefs(storedPrefs);
    const saved = await getChats(); setChats(saved);
    if (saved.length) setActiveId(saved[0].id); else { const fresh = newChatTab(); setChats([fresh]); setActiveId(fresh.id); }
    setQuickActions(await getQuickActions());
    void getUserId();
  }, []);
  useEffect(() => { void loadAll(); }, [loadAll]);
  const debouncedSaveChats = useMemo(() => debounce((tabs: ChatTab[]) => { if (tabs.length) void saveChatTabs(tabs); }, 1000), []);
  useEffect(() => { debouncedSaveChats(chats); }, [chats, debouncedSaveChats]);
  useEffect(() => {
    const updateResponsiveMode = () => {
      const compact = window.innerWidth <= 760;
      setIsMobile(compact);
      if (compact) {
        // Mobile: drawer has its own behavior and should not inherit desktop collapse.
        if (mobileOpen) setMobileOpen(false);
      } else {
        // Desktop: drawer is not visible, so close it; keep desktop collapse intact.
        setMobileOpen(false);
      }
    };
    window.addEventListener('resize', updateResponsiveMode);
    return () => window.removeEventListener('resize', updateResponsiveMode);
  }, [mobileOpen]);
  useEffect(() => { try { window.localStorage.setItem('pageagent.sidebarWidth', String(sidebarWidth)); } catch { /* ignore storage errors */ } }, [sidebarWidth]);
  useEffect(() => {
    if (!isSidebarResizing) return;
    const onMove = (e: MouseEvent) => {
      const drag = sidebarResizeRef.current;
      if (!drag) return;
      const next = Math.max(200, Math.min(window.innerWidth <= 760 ? 320 : 460, drag.startWidth + (e.clientX - drag.startX)));
      setSidebarWidth(next);
    };
    const onUp = () => setIsSidebarResizing(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isSidebarResizing]);
  useEffect(() => {
    if (!isExt) return;
    const listener = (msg: { success?: boolean; type?: string; aiId?: string; tagName?: string; innerText?: string; value?: string; outerHTML?: string }) => {
      if (msg.type === 'getSelectedElement' && msg.success) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs: { id: number }[]) => {
          const item = { aiId: msg.aiId || '', tabId: tabs[0]?.id ?? 0, tagName: msg.tagName || '', innerText: msg.innerText || '', value: msg.value || '', outerHTML: msg.outerHTML || '' };
          setSelectedElements((prev) => (prev.some((e) => e.aiId === item.aiId && e.tabId === item.tabId) ? prev : [...prev, item]));
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const refreshCurrentTab = useCallback(async () => {
    if (!isExt) return;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) { setCurrentTab(null); currentTabRef.current = null; return; }
      const md = await getTabMarkdown(tab.id).catch(() => null);
      const next: SelectedTabInfo = md ? { tabId: tab.id, title: md.title, url: md.url, markdown: md.markdown } : { tabId: tab.id, title: tab.title || 'Untitled', url: tab.url || '', markdown: '' };
      setCurrentTab((prev) => (prev && prev.tabId === next.tabId && prev.url === next.url && prev.markdown === next.markdown ? prev : next));
      currentTabRef.current = next;
    } catch {
      setCurrentTab(null); currentTabRef.current = null;
    }
  }, [isExt]);

  useEffect(() => { void refreshCurrentTab(); }, [refreshCurrentTab]);
  useEffect(() => {
    if (!isExt) return;
    const onActivated = () => { void refreshCurrentTab(); };
    const onUpdated = (tabId: number, changeInfo: { status?: string; url?: string }) => {
      const activeId = currentTabRef.current?.tabId;
      if (activeId && tabId !== activeId) return;
      if (changeInfo.status === 'complete' || changeInfo.url) void refreshCurrentTab();
    };
    const onFocus = () => { void refreshCurrentTab(); };
    try {
      chrome.tabs?.onActivated?.addListener(onActivated);
      chrome.tabs?.onUpdated?.addListener(onUpdated);
    } catch { /* ignore missing APIs */ }
    window.addEventListener('focus', onFocus);
    return () => {
      try { chrome.tabs?.onActivated?.removeListener(onActivated); chrome.tabs?.onUpdated?.removeListener(onUpdated); } catch { /* ignore */ }
      window.removeEventListener('focus', onFocus);
    };
  }, [isExt, refreshCurrentTab]);
  useEffect(() => { try { window.localStorage.setItem('pageagent.autoPageContext', String(autoPageContext)); } catch { /* ignore storage errors */ } }, [autoPageContext]);

  const allModels = useMemo(() => {
    const list: { key: string; providerId: string; providerName: string; modelId: string; displayName: string }[] = [];
    for (const def of PROVIDERS) {
      const cfg = providers[def.id];
      if (!cfg) continue;
      for (const m of cfg.models) list.push({ key: `${def.id}::${m.id}`, providerId: def.id, providerName: def.name, modelId: m.id, displayName: m.displayName || m.name || m.id });
    }
    return list;
  }, [providers]);
  const selectedModel = allModels.find((m) => m.key === prefs.selectedModelId) ?? allModels[0];

  const patchMessage = useCallback((chatId: string, msgId: string, patch: Partial<ChatMessage>) => {
    setChats((prev) => prev.map((c) => c.id === chatId ? { ...c, updatedAt: Date.now(), messages: c.messages.map((m) => m.id === msgId ? { ...m, ...patch } : m) } : c));
  }, []);

  const appendMessage = useCallback((chatId: string, msg: ChatMessage) => {
    setChats((prev) => prev.map((c) => c.id === chatId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, msg] } : c));
  }, []);

  const modelRefFor = useCallback(() => {
    if (!selectedModel) return null;
    const def = providerById(selectedModel.providerId)!;
    const cfg = providers[selectedModel.providerId];
    return { provider: selectedModel.providerId, modelId: selectedModel.modelId, baseUrl: baseUrlOf(def, cfg), apiKey: cfg?.apiKey };
  }, [selectedModel, providers]);

  const toolTaskState = useCallback((prev: TaskState, call: ToolCall, result: unknown): TaskState => {
    const r = (result && typeof result === 'object') ? result as Record<string, unknown> : {};
    const explicitOk = ('ok' in r) ? r.ok === true : !('error' in r);
    const issue = String(r.issue || r.reason || r.error || (r.stale === true ? 'stale' : r.disabled === true ? 'disabled' : '') || '').trim() || undefined;
    const status: TaskState['lastAction'] extends { result: infer R } ? R : string = (explicitOk
      ? 'ok'
      : issue === 'ambiguous'
        ? 'ambiguous'
        : issue === 'stale'
          ? 'stale'
          : issue === 'not-applied'
            ? 'not-applied'
            : issue === 'not-actionable'
              ? 'not-actionable'
              : 'failed') as string;
    const target = String(r.target || (call.args && (call.args.id ?? call.args.url ?? call.args.tabId)) || '').trim();
    return {
      ...prev,
      phase: explicitOk ? 'awaiting_next' : 'verifying',
      step: explicitOk ? `${call.name} completed` : `${call.name}: ${issue || 'failed'}`,
      confidence: explicitOk ? 'high' : 'low',
      lastAction: { id: call.id, kind: call.name, target: target || undefined, result: status as TaskState['lastAction'] & { result: string } extends { result: infer R } ? R : never, at: Date.now(), issue },
      updatedAt: Date.now(),
    } as TaskState;
  }, []);
  const runDirect = useCallback(async (chatId: string, assistantId: string, history: LlmMessage[], modelRef: NonNullable<ReturnType<typeof modelRefFor>>) => {
    const ctl = new AbortController(); abortRef.current = ctl;
    let msgs = [...history];
    for (let step = 0; step < 100; step++) {
      if (ctl.signal.aborted) break;
      let text = ''; let reasoning = ''; const calls: ToolCall[] = [];
      let err: string | null = null;
      for await (const ev of streamChat({ baseUrl: modelRef.baseUrl, apiKey: modelRef.apiKey, model: modelRef.modelId, messages: msgs, tools: mode === 'agent' ? TOOL_DEFS : undefined, signal: ctl.signal })) {
        if (ev.kind === 'reasoning' && ev.text) { reasoning += ev.text; patchMessage(chatId, assistantId, { thinking: reasoning }); }
        if (ev.kind === 'text' && ev.text) { text += ev.text; patchMessage(chatId, assistantId, { content: text }); }
        if (ev.kind === 'tool-call' && ev.name) calls.push({ id: ev.id || nanoid(), name: ev.name, args: ev.args || {}, status: 'running' });
        if (ev.kind === 'error') { err = ev.error || 'error'; break; }
      }
      if (err) { setErrorMsg(err); break; }
      if (reasoning) patchMessage(chatId, assistantId, { thinking: reasoning });
      if (!calls.length) break;
      patchMessage(chatId, assistantId, { toolCalls: calls });
      msgs.push({ role: 'assistant', content: text || null, reasoning_content: reasoning || undefined, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
      for (const call of calls) {
        let result: unknown;
        try { result = await executeTool(call.name, call.args); } catch (e) { result = { error: e instanceof Error ? e.message : 'tool failed' }; }
        patchMessage(chatId, assistantId, { toolCalls: calls.map((c) => c.id === call.id ? { ...c, status: 'done' as const, result } : c) });
        setTaskState((prev) => { const next = toolTaskState(prev, call, result); taskStateRef.current = next; return next; });
        msgs.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    patchMessage(chatId, assistantId, { taskState });
    setTaskState((prev) => { const next = { ...prev, phase: 'awaiting_next' as const, updatedAt: Date.now() }; taskStateRef.current = next; return next; });
  }, [mode, patchMessage, toolTaskState]);
  const retryToolCall = useCallback(async (chatId: string, msgId: string, tc: ToolCall) => {
    if (!chatId) return;
    let result: unknown;
    setTaskState({ mode, phase: 'acting', step: `Retrying ${tc.name}`, confidence: 'low' });
    try { result = await executeTool(tc.name, tc.args || {}); } catch (e) { result = { error: e instanceof Error ? e.message : 'tool failed' }; }
    setChats((prev) => prev.map((chat) => chat.id === chatId ? {
      ...chat, updatedAt: Date.now(),
      messages: chat.messages.map((m) => m.id !== msgId ? m : {
        ...m,
        toolCalls: (m.toolCalls || []).map((existing) => existing.id === tc.id ? { ...existing, status: 'done' as const, result } : existing),
      }),
    } : chat));
    setTaskState((prev) => toolTaskState(prev, tc, result));
  }, [mode, toolTaskState]);


  const addAttachments = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const additions: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 5 * 1024 * 1024) { notify(`File too large: ${file.name}`); continue; }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('read failed'));
          reader.readAsDataURL(file);
        });
        const isText = file.type.startsWith('text/') || /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|html|xml|css|log|yaml|yml)$/i.test(file.name);
        let text: string | undefined;
        if (isText) {
          const raw = await file.text();
          text = raw.length > MAX_ATTACHMENT_TEXT ? `${raw.slice(0, MAX_ATTACHMENT_TEXT)}\n… truncated …` : raw;
        }
        additions.push({ id: nanoid(), name: file.name, kind: file.type.startsWith('image/') ? 'image' : 'file', mimeType: file.type || undefined, size: file.size, dataUrl, text });
      } catch (e) {
        notify(`Could not read ${file.name}`);
        continue;
      }
    }
    if (additions.length) setPendingAttachments((prev) => [...prev, ...additions]);
  }, [notify]);

  const send = useCallback(async (rawText?: string, quickInstruction?: string) => {
    const text = (rawText ?? input).trim();
    const attachmentsToSend = pendingAttachments;
    if ((!text && !attachmentsToSend.length) || !activeChat || streaming) return;
    const modelRef = modelRefFor();
    if (!modelRef) { setErrorMsg('No model configured yet. Open Settings and add a provider.'); return; }
    setErrorMsg('');
    if (activeId) setDrafts((prev) => ({ ...prev, [activeId]: '' }));
    const initialState: TaskState = { mode, phase: 'scanning', step: mode === 'ask' ? 'Analyzing your request' : 'Scanning browser context', confidence: 'low' };
    setTaskState(initialState); taskStateRef.current = initialState;
    const initialSelectedTabs = pickedTabs.length ? pickedTabs : (autoPageContext && currentTab ? [currentTab] : []);
    const userMsg: ChatMessage = { id: nanoid(), role: 'user', content: text || (attachmentsToSend.length ? `Attached: ${attachmentsToSend.map((a) => a.name).join(', ')}` : ''), modelName: `${modelRef.provider}/${modelRef.modelId}`, createdAt: Date.now(), selectedElements: selectedElements.length ? selectedElements.map((e) => ({ ...e })) : undefined, selectedTabs: initialSelectedTabs.length ? initialSelectedTabs.map((tab) => ({ ...tab })) : undefined, attachments: attachmentsToSend.length ? attachmentsToSend.map((a) => ({ ...a })) : undefined };
    const assistantId = nanoid();
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', modelName: `${modelRef.provider}/${modelRef.modelId}`, createdAt: Date.now() };
    const chatId = activeChat.id;
    if ((activeChat.title === 'New Chat' || activeChat.title === 'New chat') && (text || attachmentsToSend.length)) {
      const titleSource = text || attachmentsToSend.map((a) => a.name).join(', ');
      const autoTitle = titleSource.slice(0, 48).trim() || 'New Chat';
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: autoTitle } : c)));
    }
    const prevMessages = activeChat.messages;
    appendMessage(chatId, userMsg); appendMessage(chatId, assistantMsg);
    setInput(''); setPendingAttachments([]); setPickedTabs([]); setSelectedElements([]); setOpenPop(null);
    let selectedTabs = initialSelectedTabs;
    if (autoPageContext && !selectedTabs.length) {
      if (currentTab) {
        selectedTabs = [currentTab];
      } else if (isExt) {
        try { const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); if (tabs[0]?.id !== undefined) { const md = await getTabMarkdown(tabs[0].id); if (md) selectedTabs = [{ tabId: tabs[0].id, title: md.title, url: md.url, markdown: md.markdown }]; } } catch { /* context optional */ }
      }
    }
    const instruction = quickInstruction?.replaceAll('{{date}}', todayStr()) || undefined;
    const attachmentNotes = attachmentsToSend.filter((a) => a.kind !== 'image' && a.text).map((a) => `Attached file: ${a.name}\n\`\`\`\n${a.text}\n\`\`\``).join('\n\n');
    const modelUserText = [text, attachmentNotes].filter(Boolean).join('\n\n') || (attachmentsToSend.length ? '(attached files)' : '');
    const renderedUserText = renderUserContext(modelUserText, { quickActionInstruction: instruction, selectedElements: selectedElements.length ? selectedElements : undefined, selectedTabs: selectedTabs.length ? selectedTabs : undefined, taskState: initialState });
    const imageParts = attachmentsToSend.filter((a) => a.kind === 'image' && a.dataUrl).map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl! } }));
    const userContent = imageParts.length ? [{ type: 'text', text: renderedUserText }, ...imageParts] : renderedUserText;
    const history: LlmMessage[] = [
      { role: 'system', content: mode === 'agent' ? AGENT_SYSTEM_PROMPT : ASK_SYSTEM_PROMPT },
      ...prevMessages.filter((m) => m.role !== 'tool').map((m): LlmMessage => messageToLlmMessage(m)),
      { role: 'user', content: userContent },
    ];
    setStreaming(true);
    try {
      if (isExt) {
        const port = chrome.runtime.connect({ name: 'ai-stream' }); portRef.current = port;
        const assistantRef = { text: '', reasoning: '' };
        const done = new Promise<void>((resolve) => {
          const pendingTools = new Map<string, ToolCall>();
          port.onMessage.addListener(async (msg: { type?: string; text?: string; id?: string; name?: string; args?: Record<string, unknown>; error?: string; code?: string }) => {
            if (msg.type === 'reasoning' && msg.text) { assistantRef.reasoning += msg.text; patchMessage(chatId, assistantId, { thinking: assistantRef.reasoning }); }
            if (msg.type === 'text' && msg.text) { assistantRef.text += msg.text; patchMessage(chatId, assistantId, { content: assistantRef.text }); }
            if (msg.type === 'tool-call' && msg.name) {
              const call: ToolCall = { id: msg.id || nanoid(), name: msg.name, args: msg.args || {}, status: 'running' };
              pendingTools.set(call.id, call);
              patchMessage(chatId, assistantId, { toolCalls: [...pendingTools.values()] });
              let result: unknown;
              try { result = await executeTool(call.name, call.args); } catch (e) { result = { error: e instanceof Error ? e.message : 'tool failed' }; }
              setTaskState((prev) => { const next = toolTaskState(prev, call, result); taskStateRef.current = next; return next; });
              const doneCall = { ...call, status: 'done' as const, result };
              pendingTools.set(call.id, doneCall);
              patchMessage(chatId, assistantId, { toolCalls: [...pendingTools.values()] });
              if (call.name === 'clickElementByAiID' && (result as { shouldWaitTabLoadFinished?: boolean; tabId?: number })?.shouldWaitTabLoadFinished) {
                try { const { waitTabLoadFinished } = await import('../lib/tools'); await waitTabLoadFinished((result as { tabId: number }).tabId); } catch { /* ignore */ }
              }
              port.postMessage({ type: 'tool-result', id: call.id, result });
            }
            if (msg.type === 'error') { setErrorMsg(msg.error || 'error'); resolve(); }
            if (msg.type === 'done' || msg.type === 'aborted' || msg.type === 'max-steps') resolve();
          });
        });
        port.postMessage({ type: 'sendMessages', messages: history, model: modelRef, tools: mode === 'agent' ? TOOL_DEFS : undefined });
        await done;
        setTaskState((prev) => { const next = { ...prev, phase: 'awaiting_next' as const, updatedAt: Date.now() }; taskStateRef.current = next; return next; });
        try { port.disconnect(); } catch { /* ignore */ }
      } else {
        await runDirect(chatId, assistantId, history, modelRef);
      }
      patchMessage(chatId, assistantId, { taskState: taskStateRef.current });
      const chatNow = activeChatRef.current;
      if (chatNow && chatNow.messages.length <= 2) {
        let title = (text || attachmentsToSend.map((a) => a.name).join(', ')).slice(0, 30);
        if (isExt) {
          try {
            const port = chrome.runtime.connect({ name: 'ai-stream' });
            const got = await new Promise<string>((resolve) => { port.onMessage.addListener((m: { type?: string; title?: string }) => { if (m.type === 'title') resolve(m.title || ''); }); setTimeout(() => resolve(''), 15000); });
            if (got) title = got;
            try { port.disconnect(); } catch { /* ignore */ }
          } catch { /* keep fallback */ }
        }
        setChats((prev) => prev.map((c) => c.id === chatId ? { ...c, title } : c));
      }
    } finally { setStreaming(false); abortRef.current = null; }
  }, [input, activeChat, streaming, modelRefFor, mode, pickedTabs, selectedElements, pendingAttachments, appendMessage, patchMessage, runDirect, autoPageContext, currentTab]);

  const stop = () => { abortRef.current?.abort(); portRef.current?.postMessage({ type: 'abort' }); setStreaming(false); };
  const sendRef = useRef<typeof send | null>(null);
  sendRef.current = send;
  const regenerateLast = useCallback(() => {
    if (streaming || !activeChat) return;
    const msgs = activeChat.messages;
    const lastUserIdx = [...msgs].reverse().findIndex((m) => m.role === 'user');
    if (lastUserIdx < 0) return;
    const lastUser = msgs[msgs.length - 1 - lastUserIdx];
    const cutAt = msgs.findIndex((m) => m.id === lastUser.id);
    const trimmed = msgs.slice(0, cutAt);
    setChats((prev) => prev.map((c) => c.id === activeChat.id ? { ...c, messages: trimmed, updatedAt: Date.now() } : c));
    setErrorMsg('');
    setTimeout(() => { void sendRef.current?.(lastUser.content); }, 50);
  }, [streaming, activeChat]);

  const openOptions = () => { if (isExt) chrome.runtime.openOptionsPage(); else window.open('/options.html', '_blank'); };
  const newChat = () => {
    const c = newChatTab(); setChats((p) => [c, ...p]); setActiveId(c.id); setSelectedElements([]); setPickedTabs([]); setPendingAttachments([]); setTaskState({ phase: 'idle', step: 'No active task', confidence: 'low' }); taskStateRef.current = { phase: 'idle', step: 'No active task', confidence: 'low' };
    setOpenPop(null);
    if (window.innerWidth <= 760) setMobileOpen(false);
    notify('New chat started');
  };
  const deleteChat = useCallback((id: string) => {
    if (!window.confirm('Delete this chat?')) return;
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (id === activeId) {
        if (next.length) {
          setActiveId(next[0].id);
        } else {
          const fresh = newChatTab();
          setActiveId(fresh.id);
          return [fresh];
        }
      }
      return next;
    });
    notify('Chat deleted');
  }, [activeId]);

  const clearActive = () => {
    if (!activeChat) return;
    setChats((prev) => prev.map((c) => c.id === activeChat.id ? { ...c, messages: [], updatedAt: Date.now() } : c));
    setTaskState({ phase: 'idle', step: 'No active task', confidence: 'low' }); taskStateRef.current = { phase: 'idle', step: 'No active task', confidence: 'low' };
    setOpenPop(null);
    notify('Conversation cleared');
  };
  const renameActive = () => {
    if (!activeChat) return;
    const n = window.prompt('Rename chat');
    if (n) {
      setChats((prev) => prev.map((c) => c.id === activeChat.id ? { ...c, title: n } : c));
      notify(`Chat renamed: ${n}`);
    }
    setOpenPop(null);
  };
  const exportDebug = () => {
    if (!activeChat) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      mode,
      activeChat: {
        id: activeChat.id,
        title: activeChat.title,
        pinned: activeChat.pinned,
        messages: activeChat.messages.map((m) => ({
          id: m.id, role: m.role, content: m.content, modelName: m.modelName,
          createdAt: m.createdAt, toolCalls: m.toolCalls, selectedElements: m.selectedElements,
          selectedTabs: m.selectedTabs, attachments: (m.attachments || []).map((a) => ({ id:a.id, name:a.name, kind:a.kind, size:a.size, mimeType:a.mimeType })),
        })),
      },
      composer: {
        drafts: drafts[activeChat.id] || '',
        pendingAttachments: pendingAttachments.map((a) => ({ id:a.id, name:a.name, kind:a.kind, size:a.size })),
        pickedTabs: pickedTabs.map((t) => ({ tabId:t.tabId, title:t.title, url:t.url, markdownLength:t.markdown.length })),
        selectedElements: selectedElements.map((e) => ({ tabId:e.tabId, aiId:e.aiId, tagName:e.tagName, value:e.value, innerText:e.innerText })),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `chatspace-debug-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
    notify('Debug log exported');
    setOpenPop(null);
  };
  const exportActive = () => {
    if (!activeChat) return;
    const text = activeChat.messages.map((m) => `${m.role === 'user' ? 'You' : 'Chatspace'}: ${m.content}`).join('\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'chatspace-conversation.txt'; a.click(); URL.revokeObjectURL(a.href);
    setOpenPop(null);
  };
  const shareChat = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(window.location.href).then(() => notify('Chat link copied')).catch(() => notify('Share is a visual demo'));
    else notify('Share is a visual demo');
  };
  const selectModel = async (key: string) => { const next = { ...prefs, selectedModelId: key }; setPrefs(next); await storage.set('local', 'preferences', next); setOpenPop(null); };
  const selectElement = async () => {
    setOpenPop(null);
    if (!isExt) { setErrorMsg('Element picker needs the extension context (load unpacked in Chrome).'); return; }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id === undefined) return;
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['element-selector.js'] }).catch(() => undefined);
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: () => { (window as unknown as { elementSelectorStart?: () => void }).elementSelectorStart?.(); } });
  };
  const openTabPicker = async () => {
    if (openPop === 'tabs') { setOpenPop(null); return; }
    setOpenPop('tabs');
    if (isExt) {
      try { setOpenTabs(await listOpenTabs()); } catch { setOpenTabs([]); }
    }
  };
  const togglePickedTab = async (tab: { id: number; title: string; url: string }) => {
    const exists = pickedTabs.find((p) => p.tabId === tab.id);
    if (exists) { setPickedTabs(pickedTabs.filter((p) => p.tabId !== tab.id)); return; }
    const md = isExt ? await getTabMarkdown(tab.id).catch(() => null) : null;
    setPickedTabs([...pickedTabs, { tabId: tab.id, title: tab.title, url: tab.url, markdown: md?.markdown ?? '' }]);
  };
  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); notify('Copied to clipboard'); } catch { notify('Copy unavailable'); }
  };

  // Textarea auto-resize, max 180px (demo behaviour).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > 160 ? 'auto' : 'hidden';
  }, [input]);
  // Conditional auto-scroll on the conversation element only.
  const onConvScroll = () => {
    const el = convRef.current; if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setShowScrollToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 180);
  };
  const chatMessagesKey = useMemo(() => activeChat?.messages.map((m) => `${m.id}:${m.content.length}:${m.toolCalls?.length ?? 0}`).join('|') ?? '', [activeChat]);
  useEffect(() => {
    const el = convRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessagesKey, streaming]);

  const chat = activeChat;
  useEffect(() => { setInput(activeId ? (drafts[activeId] || '') : ''); }, [activeId]);
  useEffect(() => { if (searchOpen) window.setTimeout(() => searchInputRef.current?.focus(), 0); }, [searchOpen]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveNav('search');
        setSearchOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void newChat();
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        if (target && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          inputRef.current?.focus();
          return;
        }
      }
      if (e.key === 'Escape') {
        setOpenPop(null);
        setShowTabPicker(false);
        setSearchOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [newChat]);
  const showWelcome = !!chat && chat.messages.length === 0;
  const query = searchQuery.trim().toLowerCase();
  const visibleChats = useMemo(() => {
    const base = query
      ? chats.filter((c) => c.title.toLowerCase().includes(query) || (c.messages || []).some((m) => String(m.content || '').toLowerCase().includes(query)))
      : chats;
    return [...base].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [chats, query]);
  const chatGroups = useMemo(() => {
    const active = visibleChats.filter((c) => !c.archived);
    const archived = visibleChats.filter((c) => Boolean(c.archived));
    const pinned = active.filter((c) => Boolean(c.pinned));
    const unpinned = active.filter((c) => !c.pinned);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const today = todayStart.getTime();
    const yesterday = today - 86400000;
    const week = today - 6 * 86400000;
    const bucketOf = (c: ChatTab) => {
      const ts = c.updatedAt || c.createdAt || 0;
      if (ts >= today) return 'Today';
      if (ts >= yesterday) return 'Yesterday';
      if (ts >= week) return 'Previous 7 days';
      return 'Older';
    };
    const grouped: Record<string, ChatTab[]> = {};
    unpinned.forEach((c) => {
      const key = bucketOf(c);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(c);
    });
    const result: { label: string; items: ChatTab[] }[] = [];
    if (pinned.length) result.push({ label: 'Pinned', items: pinned });
    ['Today', 'Yesterday', 'Previous 7 days', 'Older'].forEach((label) => {
      if (grouped[label]?.length) result.push({ label, items: grouped[label] });
    });
    if (archived.length) result.push({ label: 'Archived', items: archived });
    return result;
  }, [visibleChats]);

  const lastAssistantIdx = chat ? [...chat.messages].reverse().findIndex((m) => m.role === 'assistant') : -1;
  const lastAssistantPos = lastAssistantIdx >= 0 && chat ? chat.messages.length - 1 - lastAssistantIdx : -1;

  return (
    <div className="app">
      {(!collapsed || isMobile) && (
      <aside className={`sidebar${(!isMobile && collapsed) ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`} id="sidebar" style={{ width: isMobile ? 260 : (collapsed ? 66 : sidebarWidth) }}>
        {!isMobile && !mobileOpen && !collapsed ? <div className="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onMouseDown={(e) => { sidebarResizeRef.current = { startX: e.clientX, startWidth: sidebarWidth }; setIsSidebarResizing(true); }} /> : null}
        <div className="side-top">
          <div className="brand"><span className="brand-text">Chatspace</span></div>
          {/* collapse toggle moved to topbar */}
        </div>
        <button type="button" className="new-chat" id="newChat" onClick={() => { setSearchQuery(''); newChat(); }}>
          <Plus size={18} /><span className="new-label">{tr('ui.newChat')}</span>
        </button>
        <div className="search-box">
          <Search size={14} />
          <input
            ref={searchInputRef}
            className="sidebar-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tr('ui.searchChats')}
            aria-label={tr('ui.searchChats')}
          />
          {searchQuery && (
            <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearchQuery('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="side-section chat-section">
          <div className="chat-list" id="chatList">
            {chatGroups.length === 0 && <div className="chat-item empty">{searchQuery.trim() ? 'No matching chats' : 'No chats yet. Start a new conversation.'}</div>}
            {chatGroups.map((group) => (
              <div key={group.label} className="chat-group">
                <div className="chat-group-label">{group.label}</div>
                {group.items.map((c) => (
                  <div
                    key={c.id}
                    className={`chat-item${c.id === activeId ? ' current' : ''}${c.pinned ? ' pinned' : ''}${c.archived ? ' archived' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={c.title}
                    onClick={() => { setActiveId(c.id); if (isMobile) setMobileOpen(false); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveId(c.id); if (isMobile) setMobileOpen(false); } }}
                  >
                    {renamingId === c.id ? (
                      <input
                        autoFocus
                        className="chat-title"
                        style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, padding: '0 4px' }}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const n = renameValue.trim();
                            if (n) setChats((prev) => prev.map((x) => x.id === c.id ? { ...x, title: n } : x));
                            setRenamingId(null);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setRenamingId(null);
                          }
                        }}
                        onBlur={() => {
                          const n = renameValue.trim();
                          if (n) setChats((prev) => prev.map((x) => x.id === c.id ? { ...x, title: n } : x));
                          setRenamingId(null);
                        }}
                      />
                    ) : (
                      <span className="chat-title" onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(c.id); setRenameValue(c.title); }}>{c.title}</span>
                    )}
                    <button type="button" className={"chat-pin" + (c.pinned ? " is-pinned" : "")} title={c.pinned ? 'Unpin chat' : 'Pin chat'} aria-label={c.pinned ? 'Unpin chat' : 'Pin chat'} onClick={(e) => { e.stopPropagation(); togglePin(c.id); }}>
                      <Star size={13} fill={c.pinned ? 'currentColor' : 'none'} />
                    </button>
                    <div style={{ position: 'relative' }}>
                      <button type="button" className="chat-more" title="More" aria-label="More" onClick={(e) => { e.stopPropagation(); setChatMenuId((prev) => prev === c.id ? null : c.id); }}>
                        <MoreHorizontal size={13} />
                      </button>
                      {chatMenuId === c.id && (
                        <div className="chat-menu" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => { setRenamingId(c.id); setRenameValue(c.title); setChatMenuId(null); }}>Rename</button>
                          <button type="button" onClick={() => { togglePin(c.id); setChatMenuId(null); }}>{c.pinned ? 'Unpin' : 'Pin'}</button>
                          <button type="button" onClick={() => { toggleArchive(c.id); setChatMenuId(null); }}>{c.archived ? 'Unarchive' : 'Archive'}</button>
                          <button type="button" className="danger" onClick={() => { deleteChat(c.id); setChatMenuId(null); }}>Delete</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="side-spacer" />
        <div className="side-footer" style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="icon-btn settings-link" id="settingsBtn" title={tr('ui.settings')} aria-label={tr('ui.settings')} onClick={() => setSettingsOpen(true)}>
            <Settings size={17} />
          </button>
          <button type="button" className="icon-btn" title="Toggle theme" aria-label="Toggle theme" onClick={() => { setDark((v) => { const next = !v; try { window.localStorage.setItem('pageagent.dark', String(next)); } catch { /* ignore */ } return next; }); notify('Theme changed'); }}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </aside>
      )}

      <main className="main">
        <header className="topbar">
          <div className="top-left">
            {!isMobile && (
              <button type="button" className="icon-btn" id="collapseBtn" aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'} title={collapsed ? 'Tampilkan sidebar' : 'Tutup sidebar'} onClick={() => setCollapsed((v) => !v)}>
                {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
            )}
            <button type="button" className="icon-btn mobile-menu" id="mobileMenu" aria-label="Open menu" onClick={() => setMobileOpen((v) => !v)}>
              <Menu size={18} />
            </button>
            <div className="more-wrap">
              <button
                type="button" className="model-picker" id="modelPicker"
                onClick={(e) => { e.stopPropagation(); if (allModels.length === 0) openOptions(); else { setModelQuery(''); setOpenPop((p) => (p === 'model' ? null : 'model')); } }}
              >
                {selectedModel ? (<>{selectedModel.displayName} <span className="model-sub">· {selectedModel.providerName}</span></>) : (<>Chatspace <span className="model-sub">· Standard</span></>)}
                <ChevronDown size={14} />
              </button>
              <div className={`dropdown${openPop === 'model' ? ' open' : ''}`} style={{ width: 240, maxHeight: 320, left: 0, right: 'auto', padding: 5, overflow: 'hidden' }}>
                <input type="text" value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} placeholder="Search models..." style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '6px 8px', fontSize: 13, background: 'transparent', color: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 4 }} />
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {allModels.filter((m) => `${m.providerName} ${m.displayName}`.toLowerCase().includes(modelQuery.trim().toLowerCase())).map((m) => (
                    <button key={m.key} type="button" className="drop-item" title={`${m.providerName} / ${m.displayName}`} onClick={() => void selectModel(m.key)}>
                      {m.key === prefs.selectedModelId ? <Check size={13} /> : null} {m.providerName} / {m.displayName}
                    </button>
                  ))}
                  {allModels.length > 0 && allModels.filter((m) => `${m.providerName} ${m.displayName}`.toLowerCase().includes(modelQuery.trim().toLowerCase())).length === 0 && <div className="drop-item" style={{ cursor: 'default', opacity: 0.6 }}>No matching models</div>}
                  {allModels.length === 0 && <button type="button" className="drop-item" onClick={openOptions}>Add a provider in Settings</button>}
                </div>
              </div>
            </div>
          </div>
          <div className="top-actions">
            <button type="button" className="share-btn" id="shareBtn" onClick={shareChat}>
              <Share2 size={15} /><span>Share</span>
            </button>
            <div className="more-wrap">
              <button type="button" className="icon-btn" id="moreBtn" title="More options" onClick={(e) => { e.stopPropagation(); setOpenPop((p) => (p === 'more' ? null : 'more')); }}>
                <MoreHorizontal size={18} />
              </button>
              <div className={`dropdown${openPop === 'more' ? ' open' : ''}`} id="moreDropdown">
                <button type="button" className="drop-item" onClick={renameActive}><Pencil size={14} /> Rename chat</button>
                <button type="button" className="drop-item" onClick={exportActive}><Download size={14} /> Export conversation</button>
                  <button type="button" className="drop-item" onClick={exportDebug}><FileJson size={14} /> Debug JSON</button>
                <button type="button" className="drop-item" onClick={clearActive}><Trash2 size={14} /> Clear conversation</button>
              </div>
            </div>
          </div>
        </header>

        <section className="conversation" id="conversation" ref={convRef} onScroll={onConvScroll}>
          {showWelcome && (
            <div className="welcome" id="welcome">
              <h1>Ask anything.</h1>
              <p className="welcome-sub">Chat, code, and browser help without the extra noise.</p>
              <div className="suggestions">
                {SUGGESTIONS.slice(0, 3).map((s) => (
                  <button key={s.title} type="button" className="suggestion" onClick={() => { setInput(s.prompt); inputRef.current?.focus(); }}>
                    <strong>{s.title}</strong><span>{s.desc}</span>
                  </button>
                ))}
              </div>
              {allModels.length === 0 ? (
                <button type="button" className="new-chat" onClick={openOptions}><span className="new-label">{tr('ui.addProvider')}</span></button>
              ) : null}
            </div>
          )}
          <div className="messages" id="messages">
            {taskState.phase && taskState.phase !== 'idle' ? (
              <div className="task-chip" role="status" aria-live="polite">
                <span>{taskState.step}</span>
                {taskState.lastAction?.issue ? <span style={{ color: '#b54708' }}> · {taskState.lastAction.issue}</span> : null}
              </div>
            ) : null}
            {(() => {
              const allMsgs = chat?.messages ?? [];
              const hasMore = allMsgs.length > messageLimit;
              const shownMsgs = hasMore ? allMsgs.slice(-messageLimit) : allMsgs;
              const offset = allMsgs.length - shownMsgs.length;
              return (
                <>
                  {hasMore && (
                    <div style={{ textAlign: 'center', margin: '0 0 16px' }}>
                      <button type="button" className="icon-btn" style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }} onClick={() => setMessageLimit((n) => n + 60)}>
                        Load {allMsgs.length - shownMsgs.length} earlier messages
                      </button>
                    </div>
                  )}
                  {shownMsgs.map((m, idx) => {
                    const mi = offset + idx;

              const isLastAssistant = m.role === 'assistant' && mi === lastAssistantPos;
              const isStreamingThis = streaming && isLastAssistant;
              return m.role === 'user' ? (
                <article key={m.id} className="message user">
                  <div className="message-body">
                    {m.selectedElements?.length ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: m.content ? 6 : 0 }}>
                        {m.selectedElements.map((el) => (
                          <span key={`${el.tabId}:${el.aiId}`} className="selected-chip selected-chip-compact" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 6, padding: '3px 5px 3px 7px', fontSize: 10, width: 'fit-content', maxWidth: '100%', background: '#f5f5f6', border: '1px solid #e2e2e5', color: '#242428', lineHeight: 1.2 }}>
                            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}>‹{el.tagName}›</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180, color: '#55565d' }}>{(el.value || el.innerText || '').trim().slice(0, 50)}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {m.selectedTabs?.length ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: m.content ? 6 : 0 }}>
                        {m.selectedTabs.map((tab) => (
                          <span key={tab.tabId} className="picked-tab" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 6, padding: '3px 5px 3px 8px', fontSize: 11, width: 'fit-content', maxWidth: '100%', background: '#f5f5f6', border: '1px solid #e2e2e5', color: '#242428', lineHeight: 1.2 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{tab.title}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="message-text">{m.content}</div>
                    {m.attachments?.length ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {m.attachments.map((attachment, idx) => (
                          attachment.kind === 'image' && attachment.dataUrl ? (
                            <a key={`${attachment.id || idx}:${attachment.name}`} href={attachment.dataUrl} target="_blank" rel="noreferrer" data-kind={attachment.kind} style={{ display: 'inline-block', lineHeight: 0 }}>
                              <img src={attachment.dataUrl} alt={attachment.name} style={{ height: 68, width: 68, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e2e5' }} />
                            </a>
                          ) : (
                            <span key={`${attachment.id || idx}:${attachment.name}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 10px', fontSize: 12, background: '#f0f0f2', border: '1px solid #e2e2e5', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <FileIcon size={13} /> {attachment.name}
                            </span>
                          )
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              ) : (
                <article key={m.id} className="message ai">
                  <div className="message-body">
                    {m.content ? <Markdown text={m.content} /> : (isStreamingThis ? <div className="message-thinking" role="status" aria-live="polite"><span style={{display:'none'}}>Thinking…</span><div className="shimmer-line wide"></div><div className="shimmer-line medium"></div><div className="shimmer-line short"></div></div> : <div className="message-text">{streaming ? 'Thinking…' : ''}</div>)}
                    {(m.toolCalls ?? []).map((tc) => {
                      const visual = toolVisual(tc.name, tc.args || {});
                      return (
                        <div key={tc.id} className={`tool-card${tc.status === 'running' || !tc.status ? ' running' : ''}${tc.status === 'done' ? ' done' : ''}${toolCallFailed(tc) ? ' failed' : ''}`}>
                          <div className="tl-dot"></div>
                          <div className="tool-card-head">
                            <span className="tool-card-label">{visual.icon} {visual.label}</span>
                            <span className="tool-card-status-icon">{tc.status === 'running' || !tc.status ? <Loader2 size={13} className="spin" /> : tc.status === 'done' ? <Check size={13} /> : <AlertCircle size={13} />}</span>
                          </div>
                          <div className="tool-card-body">
                            {tc.status === 'running' || !tc.status ? (
                              <>
                                <div className="shimmer-line wide"></div>
                                <div className="shimmer-line medium"></div>
                              </>
                            ) : toolCallFailed(tc) ? (
                              <div className="tool-card-error">{friendlyToolError(tc)}</div>
                            ) : (
                              <div className="tool-card-summary">{toolSummary(tc)}</div>
                            )}
                          </div>
                          <details className="tool-details">
                            <summary>Details</summary>
                            <pre><code>{JSON.stringify({ args: tc.args, result: tc.result ?? null }, null, 2).slice(0, 1000)}</code></pre>
                          </details>
                          {toolCallFailed(tc) && !streaming ? (
                            <div className="tool-card-retry">
                              <button type="button" onClick={() => void retryToolCall(activeChatRef.current?.id || chat.id, m.id, tc)}>
                                <RefreshCw size={12} /> Retry
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {m.content && !streaming && (
                      <div className="message-actions">
                        <button type="button" className="icon-btn action-copy" title="Copy response" onClick={() => void copyText(m.content)}><CopySvg /></button>
                        <button type="button" className="icon-btn" data-toast="Response liked" title="Good response" onClick={() => notify('Response liked')}><LikeSvg /></button>
                        <button type="button" className="icon-btn" data-toast="Feedback recorded" title="Bad response" onClick={() => notify('Feedback recorded')}><DislikeSvg /></button>
                        {isLastAssistant && (
                          <button type="button" className="icon-btn" title="Regenerate" onClick={regenerateLast}><RegenSvg /></button>
                        )}
                        <span className="tiny-label">{new Date(m.createdAt ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    )}
                  </div>
                </article>
              );
                  })}
                </>
              );
            })()}
            {showScrollToBottom ? (
              <button type="button" className="scroll-to-bottom" onClick={() => { const el = convRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }}>
                ↓ Back to bottom
              </button>
            ) : null}
            {errorMsg && (
              <article className="message ai">                <div className="message-body">
                  <div className="message-text" style={{ color: '#b3261e' }}>{errorMsg}</div>
                  <div className="message-actions">
                    <button type="button" className="icon-btn" title="Retry" onClick={regenerateLast}><RegenSvg /></button>
                  </div>
                </div>
              </article>
            )}
          </div>
        </section>

        <footer className="composer-area">
          <div
            className="composer-wrap"
            style={{ position: 'relative' }}
            onDragEnter={(e) => { if (e.dataTransfer?.items && Array.from(e.dataTransfer.items).some((item) => item.kind === 'file')) { e.preventDefault(); setDragOver(true); } }}
            onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); } }}
            onDragLeave={(e) => { if (e.currentTarget === e.target || (e.target as HTMLElement).closest('.drop-overlay')) return; setDragOver(false); }}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer?.files?.length) void addAttachments(e.dataTransfer.files); }}
          >
            {dragOver && <div className="drop-overlay">Drop images or files here</div>}
            {(selectedElements.length > 0 || pickedTabs.length > 0 || (autoPageContext && currentTab)) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {selectedElements.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {selectedElements.map((el) => (
                      <div key={`${el.tabId}:${el.aiId}`} className="selected-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '5px 6px 5px 8px', fontSize: 12, width: 'fit-content', maxWidth: '100%', background: '#f5f5f6', border: '1px solid #e2e2e5', color: '#242428' }}>
                        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', color: '#252525' }}>‹{el.tagName}›</span>
                        <span style={{ color: '#55565d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{(el.value || el.innerText || '').trim().slice(0, 60)}</span>
                        <button type="button" aria-label="Remove selected element" onClick={() => setSelectedElements((prev) => prev.filter((x) => !(x.aiId === el.aiId && x.tabId === el.tabId)))} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#777982', fontSize: 15, lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                {autoPageContext && currentTab && pickedTabs.length === 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <span className="picked-tab" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 6, padding: '3px 5px 3px 8px', fontSize: 11, width: 'fit-content', maxWidth: 190, background: '#f5f5f6', border: '1px solid #e2e2e5', color: '#242428', lineHeight: 1.2 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentTab.title} (auto page)</span>
                      <button type="button" aria-label="Disable auto page context" onClick={() => setAutoPageContext(false)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#777982', fontSize: 14, lineHeight: 1, padding: '0 2px', marginLeft: 2 }}>×</button>
                    </span>
                  </div>
                )}
                {pickedTabs.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {pickedTabs.map((pt) => (
                      <span key={pt.tabId} className="picked-tab" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 6, padding: '3px 5px 3px 8px', fontSize: 11, width: 'fit-content', maxWidth: 190, background: '#f5f5f6', border: '1px solid #e2e2e5', color: '#242428', lineHeight: 1.2 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pt.title}</span>
                        <button type="button" aria-label="Remove tab" onClick={() => setPickedTabs(pickedTabs.filter((p) => p.tabId !== pt.tabId))} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#777982', fontSize: 14, lineHeight: 1, padding: '0 2px', marginLeft: 2 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.xml,.css,.log,.yml,.yaml"
              style={{ display: 'none' }}
              onChange={(e) => { void addAttachments(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ''; }}
            />
            {pendingAttachments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {pendingAttachments.map((attachment) => (
                    <div key={attachment.id || attachment.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 10, padding: '4px 7px 4px 6px', background: '#f0f0f2', border: '1px solid #e2e2e5', maxWidth: 280 }}>
                      {attachment.kind === 'image' && attachment.dataUrl ? (
                        <img src={attachment.dataUrl} alt={attachment.name} style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <span style={{ width: 26, height: 26, borderRadius: 6, display: 'inline-grid', placeItems: 'center', background: '#fff', color: '#656770', flexShrink: 0 }}><FileIcon size={15} /></span>
                      )}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180, fontSize: 12, color: '#252525' }}>{attachment.name}</span>
                      <button type="button" aria-label="Remove attachment" onClick={() => setPendingAttachments((prev) => prev.filter((item) => item.id !== attachment.id || item.name !== attachment.name))} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#777982', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <form
              className="composer"
              onSubmit={(e) => { e.preventDefault(); if (streaming) stop(); else void send(); }}
            >
              <textarea
                ref={inputRef} rows={1} id="promptInput" value={input}
                placeholder="Message Chatspace..." aria-label="Message"
                onChange={(e) => { const value = e.target.value; setInput(value); if (activeId) setDrafts((prev) => ({ ...prev, [activeId]: value })); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (streaming) stop(); else void send(); } }}
              />
              <div className="composer-tools">
                <div className="tool-left">
                  <button type="button" className="tool-btn" title="Attach image or file" aria-label="Attach image or file" id="attachBtn" onClick={() => fileInputRef.current?.click()}>
                    <Paperclip size={18} />
                  </button>
                  <button type="button" className={`tool-btn labelled${autoPageContext ? ' selected' : ''}`} title="Auto page context" aria-label="Toggle auto page context" onClick={() => setAutoPageContext((v) => !v)}>
                    <Globe size={17} /><span>Auto page</span>
                  </button>
                  <div className="composer-pop">
                    <button type="button" className="tool-btn labelled" id="toolsBtn" onClick={(e) => { e.stopPropagation(); setOpenPop((p) => (p === 'tools' ? null : 'tools')); }}>
                      <Sparkles size={17} /><span>Tools</span>
                    </button>
                    <div className={`mini-pop${openPop === 'tools' ? ' open' : ''}`} id="toolsPop" style={{ width: 220 }}>
                      <button type="button" id="attachTabsBtn" onClick={() => void openTabPicker()}>{openPop === "tabs" ? "Hide browser tabs" : "Attach browser tabs"}</button>
                      <button type="button" onClick={() => void selectElement()}>Select element</button>
                    </div>
                  </div>
                  <div className="composer-pop">
                    <button type="button" className="tool-btn labelled" id="quickBtn" onClick={(e) => { e.stopPropagation(); setOpenPop((p) => (p === 'quick' ? null : 'quick')); }}>
                      <Zap size={17} /><span>Quick</span>
                    </button>
                    <div className={`mini-pop${openPop === 'quick' ? ' open' : ''}`} id="quickPop" style={{ width: 230 }}>
                      {quickActions.length > 0 ? quickActions.map((qa) => (
                        <button key={qa.id} type="button" onClick={() => void send(qa.title || 'Quick action', qa.instruction)}>{qa.title}</button>
                      )) : <button type="button" onClick={() => openOptions()}>New Quick Action</button>}
                    </div>
                  </div>
                </div>
                <div className="tool-right">
                  <div className="mode-toggle" role="group" aria-label="Chat mode">
                    <button type="button" className={`mode-btn${mode === 'ask' ? ' active' : ''}`} aria-pressed={mode === 'ask'} onClick={() => setMode('ask')}>{tr('ui.ask')}</button>
                    <button type="button" className={`mode-btn${mode === 'agent' ? ' active' : ''}`} aria-pressed={mode === 'agent'} onClick={() => setMode('agent')}>{tr('ui.agent')}</button>
                  </div>
                  {streaming ? (
                    <button type="button" className="send-btn" id="sendBtn" aria-label="Stop" title="Stop" onClick={stop}>■</button>
                  ) : (
                    <button type="submit" className="send-btn" id="sendBtn" aria-label="Send message" disabled={!input.trim() && !pendingAttachments.length}>
                      <ArrowUp size={17} />
                    </button>
                  )}
                </div>
              </div>
            </form>
            <div className="disclaimer">Chatspace can make mistakes. Check important information.</div>
          </div>
        </footer>
      </main>
      {settingsOpen && (
        <div className="settings-modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={tr('ui.settings')}>
            <div className="settings-modal-head">
              <div className="settings-modal-title">Settings</div>
              <button type="button" className="icon-btn" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <iframe
              src="/options.html"
              className="settings-modal-frame"
              title="Settings"
            />
          </div>
        </div>
      )}
      <div className={`toast${toast ? ' show' : ''}`} id="toast" role="status">{toast}</div>
    </div>
  );
}




