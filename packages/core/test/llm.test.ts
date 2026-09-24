import { describe, expect, it } from 'vitest';
import { maskToken } from '../src/mrToken.ts';
import { applyLlmEnvOverrides, normalizeLlmConfig, publicLlmConfig, validateLlmApiKeyFormat } from '../src/llm.ts';

describe('llm 配置', () => {
  it('缺省与脏数据回落到 openai / gpt-4.1', () => {
    expect(normalizeLlmConfig(undefined)).toEqual({
      provider: 'openai',
      model: 'gpt-4.1',
      apiKey: '',
      baseUrl: ''
    });
    expect(normalizeLlmConfig({ provider: 'other', model: '  ', apiKey: 1, baseUrl: ' https://x/v1/ ' })).toEqual({
      provider: 'openai',
      model: 'gpt-4.1',
      apiKey: '',
      baseUrl: 'https://x/v1'
    });
  });

  it('GET 视图不回明文', () => {
    const pub = publicLlmConfig({
      provider: 'openai',
      model: 'gpt-4.1',
      apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
      baseUrl: 'https://example/v1'
    });
    expect(pub.tokenSet).toBe(true);
    expect(pub.baseUrl).toBe('https://example/v1');
    expect(pub.tokenPreview).toBe(maskToken('sk-abcdefghijklmnopqrstuvwxyz'));
    expect(JSON.stringify(pub)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });

  it('空 Key 格式失败', () => {
    expect(validateLlmApiKeyFormat('')).toMatch(/填写/);
    expect(validateLlmApiKeyFormat('short')).toMatch(/过短/);
    expect(validateLlmApiKeyFormat('sk-abcdefghijklmnopqrstuvwxyz')).toBeNull();
  });

  it('环境变量覆盖不改原对象', () => {
    const stored = normalizeLlmConfig({ apiKey: 'sk-storedstoredstoredstored', model: 'gpt-4.1' });
    const prevKey = process.env.GIT_COCKPIT_LLM_API_KEY;
    const prevModel = process.env.GIT_COCKPIT_LLM_MODEL;
    const prevBase = process.env.GIT_COCKPIT_LLM_BASE_URL;
    process.env.GIT_COCKPIT_LLM_API_KEY = 'sk-envenvenvenvenvenvenv';
    process.env.GIT_COCKPIT_LLM_MODEL = 'gpt-test';
    process.env.GIT_COCKPIT_LLM_BASE_URL = 'http://127.0.0.1:8080/v1';
    try {
      const over = applyLlmEnvOverrides(stored);
      expect(over.apiKey).toBe('sk-envenvenvenvenvenvenv');
      expect(over.model).toBe('gpt-test');
      expect(over.baseUrl).toBe('http://127.0.0.1:8080/v1');
      expect(stored.apiKey).toBe('sk-storedstoredstoredstored');
    } finally {
      if (prevKey === undefined) delete process.env.GIT_COCKPIT_LLM_API_KEY;
      else process.env.GIT_COCKPIT_LLM_API_KEY = prevKey;
      if (prevModel === undefined) delete process.env.GIT_COCKPIT_LLM_MODEL;
      else process.env.GIT_COCKPIT_LLM_MODEL = prevModel;
      if (prevBase === undefined) delete process.env.GIT_COCKPIT_LLM_BASE_URL;
      else process.env.GIT_COCKPIT_LLM_BASE_URL = prevBase;
    }
  });
});
