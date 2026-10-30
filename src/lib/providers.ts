// BYOK provider catalogue (rewritten from the reverse spec). No keys are bundled.
// Order + Options display names match the original Options list; `tooltipName`
// is the name used for the onboarding tile tooltip in the original.
import type { ProviderConfig } from './types';

export interface ProviderDef {
  id: string; name: string; tooltipName: string; defaultBaseUrl: string; getKeyUrl: string;
  needsKey: boolean; baseUrlOptions?: { label: string; url: string }[]; defaultModels: string[]; iconUrl?: string;
}
export const PROVIDERS: ProviderDef[] = [
  { id: 'openai', iconUrl: 'https://www.google.com/s2/favicons?domain=openai.com&sz=64', name: 'OpenAI', tooltipName: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', getKeyUrl: 'https://platform.openai.com/api-keys', needsKey: true, defaultModels: ['gpt-4o', 'gpt-4o-mini'] },
  { id: 'ollama', iconUrl: 'https://www.google.com/s2/favicons?domain=ollama.com&sz=64', name: 'Ollama', tooltipName: 'Ollama', defaultBaseUrl: 'https://ollama.com/v1', getKeyUrl: 'https://ollama.com', needsKey: true, defaultModels: ['beam'] },
  { id: 'gemini', iconUrl: 'https://www.google.com/s2/favicons?domain=aistudio.google.com&sz=64', name: 'Gemini', tooltipName: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', getKeyUrl: 'https://aistudio.google.com/apikey', needsKey: true, defaultModels: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
  { id: 'deepseek', iconUrl: 'https://www.google.com/s2/favicons?domain=deepseek.com&sz=64', name: 'DeepSeek', tooltipName: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', getKeyUrl: 'https://platform.deepseek.com/api_keys', needsKey: true, defaultModels: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'openrouter', iconUrl: 'https://www.google.com/s2/favicons?domain=openrouter.ai&sz=64', name: 'OpenRouter', tooltipName: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', getKeyUrl: 'https://openrouter.ai/keys', needsKey: true, defaultModels: ['openai/gpt-4o'] },
  { id: 'aihubmix', iconUrl: 'https://www.google.com/s2/favicons?domain=aihubmix.com&sz=64', name: 'AiHubMix', tooltipName: 'AIHubMix', defaultBaseUrl: 'https://aihubmix.com/v1', getKeyUrl: 'https://aihubmix.com/token', needsKey: true, defaultModels: [] },
  { id: 'glm', iconUrl: 'https://www.google.com/s2/favicons?domain=z.ai&sz=64', name: 'Z.ai (Zhipu)', tooltipName: 'GLM', defaultBaseUrl: 'https://api.z.ai/api/paas/v4', getKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', needsKey: true, baseUrlOptions: [{ label: 'z.ai (International)', url: 'https://api.z.ai/api/paas/v4' }], defaultModels: ['glm-4.5'] },
  { id: 'aigateway', iconUrl: 'https://www.google.com/s2/favicons?domain=vercel.com&sz=64', name: 'Vercel AI Gateway', tooltipName: 'Vercel AI Gateway', defaultBaseUrl: 'https://api.ai-gateway.workers.dev/v1', getKeyUrl: 'https://vercel.com/docs/ai-gateway', needsKey: true, defaultModels: [] },
  { id: 'minimax', iconUrl: 'https://www.google.com/s2/favicons?domain=minimax.io&sz=64', name: 'Minimax', tooltipName: 'Minimax', defaultBaseUrl: 'https://api.minimax.io/v1', getKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key', needsKey: true, baseUrlOptions: [{ label: 'International (api.minimax.io)', url: 'https://api.minimax.io/v1' }, { label: 'China (api.minimaxi.com)', url: 'https://api.minimaxi.com/v1' }], defaultModels: ['MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1', 'MiniMax-M2.1-highspeed', 'MiniMax-M2'] },

  { id: 'groq', name: 'Groq', tooltipName: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', getKeyUrl: 'https://console.groq.com/keys', needsKey: true, defaultModels: ['llama-3.3-70b-versatile'], iconUrl: 'https://www.google.com/s2/favicons?domain=groq.com&sz=64' },
  { id: 'together', name: 'Together AI', tooltipName: 'Together', defaultBaseUrl: 'https://api.together.xyz/v1', getKeyUrl: 'https://api.together.ai/settings/api-keys', needsKey: true, defaultModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'], iconUrl: 'https://www.google.com/s2/favicons?domain=together.ai&sz=64' },
  { id: 'fireworks', name: 'Fireworks AI', tooltipName: 'Fireworks', defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', getKeyUrl: 'https://fireworks.ai/account/api-keys', needsKey: true, defaultModels: ['accounts/fireworks/models/llama-v3p3-70b-instruct'], iconUrl: 'https://www.google.com/s2/favicons?domain=fireworks.ai&sz=64' },
  { id: 'mistral', name: 'Mistral', tooltipName: 'Mistral', defaultBaseUrl: 'https://api.mistral.ai/v1', getKeyUrl: 'https://console.mistral.ai/api-keys', needsKey: true, defaultModels: ['mistral-large-latest'], iconUrl: 'https://www.google.com/s2/favicons?domain=mistral.ai&sz=64' },
  { id: 'perplexity', name: 'Perplexity', tooltipName: 'Perplexity', defaultBaseUrl: 'https://api.perplexity.ai', getKeyUrl: 'https://www.perplexity.ai/settings/api', needsKey: true, defaultModels: ['sonar'], iconUrl: 'https://www.google.com/s2/favicons?domain=perplexity.ai&sz=64' },
  { id: 'xai', name: 'xAI', tooltipName: 'xAI', defaultBaseUrl: 'https://api.x.ai/v1', getKeyUrl: 'https://console.x.ai', needsKey: true, defaultModels: ['grok-3'], iconUrl: 'https://www.google.com/s2/favicons?domain=x.ai&sz=64' },
  { id: 'cerebras', name: 'Cerebras', tooltipName: 'Cerebras', defaultBaseUrl: 'https://api.cerebras.ai/v1', getKeyUrl: 'https://cloud.cerebras.ai', needsKey: true, defaultModels: ['llama3.1-8b'], iconUrl: 'https://www.google.com/s2/favicons?domain=cerebras.ai&sz=64' },
  { id: 'deepinfra', name: 'DeepInfra', tooltipName: 'DeepInfra', defaultBaseUrl: 'https://api.deepinfra.com/v1/openai', getKeyUrl: 'https://deepinfra.com/dash/api_keys', needsKey: true, defaultModels: ['meta-llama/Llama-3.3-70B-Instruct'], iconUrl: 'https://www.google.com/s2/favicons?domain=deepinfra.com&sz=64' },
  { id: 'siliconflow', name: 'SiliconFlow', tooltipName: 'SiliconFlow', defaultBaseUrl: 'https://api.siliconflow.cn/v1', getKeyUrl: 'https://cloud.siliconflow.cn/account/ak', needsKey: true, defaultModels: ['deepseek-ai/DeepSeek-V3'], iconUrl: 'https://www.google.com/s2/favicons?domain=siliconflow.cn&sz=64' },
  { id: 'moonshot', name: 'Moonshot (Kimi)', tooltipName: 'Moonshot', defaultBaseUrl: 'https://api.moonshot.cn/v1', getKeyUrl: 'https://platform.moonshot.cn/console/api-keys', needsKey: true, defaultModels: ['moonshot-v1-8k'], iconUrl: 'https://www.google.com/s2/favicons?domain=moonshot.cn&sz=64' },
  { id: 'dashscope', name: 'DashScope (Qwen)', tooltipName: 'DashScope', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', getKeyUrl: 'https://dashscope.console.aliyun.com/apiKey', needsKey: true, defaultModels: ['qwen-plus'], iconUrl: 'https://www.google.com/s2/favicons?domain=aliyun.com&sz=64' },
  { id: 'novita', name: 'Novita AI', tooltipName: 'Novita', defaultBaseUrl: 'https://api.novita.ai/v3/openai', getKeyUrl: 'https://novita.ai/settings/key-management', needsKey: true, defaultModels: ['deepseek/deepseek-v3'], iconUrl: 'https://www.google.com/s2/favicons?domain=novita.ai&sz=64' },

  { id: 'openai-completions', name: 'OpenAI Completions (Custom)', tooltipName: 'Custom Completions', defaultBaseUrl: 'https://api.openai.com/v1', getKeyUrl: 'https://platform.openai.com/api-keys', needsKey: true, defaultModels: [] },
];
export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);
// Onboarding tile order in the original (differs from the Options list order).
export const ONBOARDING_ORDER = ['gemini', 'ollama', 'openai', 'openrouter', 'aihubmix', 'deepseek', 'glm', 'aigateway', 'minimax'];
export const onboardingProviders = () => ONBOARDING_ORDER.map((id) => providerById(id)!).filter(Boolean);
export const baseUrlOf = (def: ProviderDef, cfg?: ProviderConfig) => (cfg?.baseUrl || def.defaultBaseUrl).replace(/\/$/, '');
export const initialsOf = (name: string) => name.split(/[\s()]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Fetch the model list from {baseUrl}/models. Authorization is sent whenever a key is set (required for Ollama Cloud; a local server ignores it). */
export async function fetchModels(def: ProviderDef, cfg?: ProviderConfig): Promise<string[]> {
  const url = `${baseUrlOf(def, cfg)}/models`;
  const headers: Record<string, string> = {};
  if (cfg?.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`models request failed: ${res.status}`);
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).filter(Boolean);
}
