// Shared domain types for the PageAgent rewrite (written from the reverse spec).
export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** tool_calls produced by the model (assistant messages) */
  toolCalls?: ToolCall[];
  /** result of a tool call (tool messages) */
  toolCallId?: string;
  toolName?: string;
  modelName?: string;
  thinking?: string;
  createdAt?: number;
  selectedTabs?: SelectedTabInfo[];
  attachments?: {
    id?: string;
    name: string;
    kind: string;
    mimeType?: string;
    size?: number;
    dataUrl?: string;
    text?: string;
  }[];
  selectedElements?: SelectedElement[];
  taskState?: TaskState;
}
export interface ToolCall { id: string; name: string; args: Record<string, unknown>; status?: 'running' | 'done' | 'error'; result?: unknown }
export interface ChatTab {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
}
export interface ProviderModel { id: string; name: string; displayName: string }
export interface ProviderConfig { apiKey: string; baseUrl?: string; models: ProviderModel[] }
export type ProviderMap = Record<string, ProviderConfig>;
export interface Preferences { selectedModelId?: string }
export interface QuickAction { id: string; title: string; instruction: string }
export interface SelectedElement { aiId: string; tabId: number; tagName: string; innerText: string; value: string; outerHTML: string }
export interface SelectedTabInfo { tabId: number; title: string; url: string; markdown: string }
export type Language = 'en-US' | 'zh-CN' | 'zh-TW' | 'ja-JP' | 'ko' | 'id';
export type ChatMode = 'agent' | 'ask';
export type TaskPhase = 'idle' | 'scanning' | 'acting' | 'verifying' | 'awaiting_next' | 'failed';
export type ToolOutcome = 'ok' | 'failed' | 'ambiguous' | 'stale' | 'not-applied' | 'not-actionable';
export interface TaskState {
  mode?: ChatMode;
  phase: TaskPhase;
  step: string;
  lastAction?: { id: string; kind: string; target?: string; result: ToolOutcome; at: number; issue?: string };
  confidence: 'low' | 'medium' | 'high';
  updatedAt?: number;
}
export const nanoid = (n = 21): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
};
export const randomAiId = (): string =>
  `ai-id-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
