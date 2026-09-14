/**
 * 对话模型配置：与 MR Token 同级，明文不进 GET，不进工具参数。
 */
import { maskToken } from './mrToken.ts';
import type { LlmConfig, LlmProvider, PublicLlmConfig } from './types.ts';

const DEFAULT_MODEL = 'gpt-4.1';
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

export function normalizeLlmProvider(raw: unknown): LlmProvider {
  return raw === 'openai' ? 'openai' : 'openai';
}

function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '');
}

export function normalizeLlmConfig(raw: unknown): LlmConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const model = typeof o.model === 'string' && o.model.trim() ? o.model.trim() : DEFAULT_MODEL;
  const apiKey = typeof o.apiKey === 'string' ? o.apiKey : '';
  return {
    provider: normalizeLlmProvider(o.provider),
    model,
    apiKey,
    baseUrl: normalizeBaseUrl(o.baseUrl)
  };
}

/** 开发期环境变量覆盖，不写回 config.json。正式以设置页为准。 */
export function applyLlmEnvOverrides(stored: LlmConfig): LlmConfig {
  const apiKey = process.env.GIT_COCKPIT_LLM_API_KEY?.trim() || stored.apiKey;
  const model = process.env.GIT_COCKPIT_LLM_MODEL?.trim() || stored.model;
  const baseUrl = process.env.GIT_COCKPIT_LLM_BASE_URL?.trim() || stored.baseUrl;
  return { ...stored, apiKey, model, baseUrl: normalizeBaseUrl(baseUrl) };
}

export function publicLlmConfig(llm: LlmConfig): PublicLlmConfig {
  const key = llm.apiKey.trim();
  return {
    provider: llm.provider,
    model: llm.model,
    baseUrl: llm.baseUrl,
    tokenSet: key.length > 0,
    tokenPreview: key ? maskToken(key) : ''
  };
}

export function llmBaseUrl(llm: LlmConfig): string {
  return llm.baseUrl.trim() || DEFAULT_OPENAI_BASE;
}

/** 保存前格式检查。兼容网关时允许非 sk- 前缀，但拒绝过短空值。 */
export function validateLlmApiKeyFormat(apiKey: string, provider: LlmProvider = 'openai'): string | null {
  const key = apiKey.trim();
  if (!key) return '请填写 API Key';
  if (key.length < 16) return 'API Key 过短';
  if (/\s/.test(key)) return 'API Key 不能包含空白';
  if (provider === 'openai' && key.startsWith('sk-') && key.length < 20) return 'OpenAI API Key 格式不正确';
  return null;
}

export function shouldProbeLlm(): boolean {
  if (process.env.GIT_COCKPIT_LLM_SKIP_PROBE === '1') return false;
  if (process.env.VITEST) return false;
  return true;
}

/** 对兼容网关发一条极短 completions，确认 Key / baseUrl / 模型能通。 */
export async function probeLlmEndpoint(cfg: LlmConfig): Promise<string | null> {
  const formatErr = validateLlmApiKeyFormat(cfg.apiKey, cfg.provider);
  if (formatErr) return formatErr;
  const url = `${llmBaseUrl(cfg)}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: cfg.model || DEFAULT_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) return null;
    if (res.status === 401 || res.status === 403) return 'API Key 无效或无权限';
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 180);
    } catch {
      /* ignore */
    }
    if (res.status === 404) return '模型接口不存在，请检查 Base URL 是否带 /v1';
    return `模型服务返回 HTTP ${res.status}${detail ? `：${detail}` : ''}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `无法连接模型服务：${msg}`;
  }
}
