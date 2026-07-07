import { GoogleGenAI } from '@google/genai';

export type AiProviderName = 'openrouter' | 'gemini';

export interface AiRuntimeConfig {
  provider: AiProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  siteUrl?: string;
  appName?: string;
}

export interface AiGenerateParams {
  systemInstruction: string;
  userContent: string;
  temperature?: number;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function parseOptionalFloat(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** OpenRouter takes priority when OPENROUTER_API_KEY is set. */
export function getAiRuntimeConfig(): AiRuntimeConfig | null {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    return {
      provider: 'openrouter',
      apiKey: openRouterKey,
      model: process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.0-flash-001',
      baseUrl: (process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
      temperature: parseOptionalFloat(process.env.OPENROUTER_TEMPERATURE),
      maxTokens: parseOptionalInt(process.env.OPENROUTER_MAX_TOKENS),
      topP: parseOptionalFloat(process.env.OPENROUTER_TOP_P),
      siteUrl: process.env.OPENROUTER_SITE_URL?.trim() || process.env.APP_URL?.trim() || undefined,
      appName: process.env.OPENROUTER_APP_NAME?.trim() || 'Slice of Heaven Pizzeria',
    };
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    return {
      provider: 'gemini',
      apiKey: geminiKey,
      model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash',
    };
  }

  return null;
}

export function isAiConfigured(): boolean {
  return getAiRuntimeConfig() != null;
}

export function getAiPublicConfig() {
  const cfg = getAiRuntimeConfig();
  return {
    hasGemini: cfg != null,
    hasAi: cfg != null,
    aiProvider: cfg?.provider ?? null,
    aiModel: cfg?.model ?? null,
  };
}

async function generateOpenRouterText(config: AiRuntimeConfig, params: AiGenerateParams): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: params.systemInstruction },
  ];

  if (params.history?.length) {
    for (const turn of params.history) {
      messages.push({
        role: turn.role === 'user' ? 'user' : 'assistant',
        content: turn.content,
      });
    }
  }

  messages.push({ role: 'user', content: params.userContent });

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: params.temperature ?? config.temperature ?? 0.3,
  };

  if (config.maxTokens != null) body.max_tokens = config.maxTokens;
  if (config.topP != null) body.top_p = config.topP;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (config.siteUrl) headers['HTTP-Referer'] = config.siteUrl;
  if (config.appName) headers['X-Title'] = config.appName;

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || res.statusText || 'OpenRouter request failed';
    throw new Error(String(msg));
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    throw new Error('OpenRouter returned an empty response.');
  }
  return text.trim();
}

async function generateGeminiText(config: AiRuntimeConfig, params: AiGenerateParams): Promise<string> {
  const ai = new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: { headers: { 'User-Agent': 'slice-of-heaven-pizzeria' } },
  });

  let contents = params.userContent;
  if (params.history?.length) {
    const historyText = params.history
      .map(t => `${t.role === 'user' ? 'Customer' : 'Assistant'}: ${t.content}`)
      .join('\n');
    contents = [historyText, params.userContent].filter(Boolean).join('\n');
  }

  const response = await ai.models.generateContent({
    model: config.model,
    contents,
    config: {
      systemInstruction: params.systemInstruction,
      temperature: params.temperature ?? 0.3,
    },
  });

  return (response.text || '').trim();
}

export async function generateAiText(params: AiGenerateParams): Promise<string> {
  const config = getAiRuntimeConfig();
  if (!config) {
    throw new Error('AI is not configured. Set OPENROUTER_API_KEY or GEMINI_API_KEY in .env');
  }

  if (config.provider === 'openrouter') {
    return generateOpenRouterText(config, params);
  }
  return generateGeminiText(config, params);
}

export function aiNotConfiguredMessage(): string {
  return 'AI assistant is not configured. Set OPENROUTER_API_KEY (preferred) or GEMINI_API_KEY in .env and restart the server.';
}
