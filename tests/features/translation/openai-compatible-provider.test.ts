import { describe, expect, it } from 'vitest';
import {
  OpenAICompatibleProvider,
  SYSTEM_PROMPT,
  extractJsonObject,
  readCompletionContent,
} from '../../../features/translation/infrastructure/openai-compatible-provider';
import { TranslationFailure } from '../../../features/translation/domain/errors';
import type { ProviderTranslateInput } from '../../../features/translation/domain/ports';

function completionResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function input(): ProviderTranslateInput {
  return {
    image: {
      dataUrl: 'data:image/jpeg;base64,AAAA',
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
    },
    sourceLanguage: 'ja',
    targetLanguage: 'zh-CN',
  };
}

function createProvider(
  fetchImpl: typeof fetch,
  overrides: { apiKey?: string; model?: string; maxAttempts?: number } = {},
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: 'https://api.example.test/v1/',
    apiKey: overrides.apiKey ?? 'sk-test-123456789',
    model: overrides.model ?? 'vision-model',
    temperature: 0.2,
    requestTimeoutMs: 5000,
    maxAttempts: overrides.maxAttempts ?? 1,
    fetchImpl,
    sleep: async () => undefined,
  });
}

describe('extractJsonObject', () => {
  it('去掉 markdown 围栏后解析', () => {
    expect(extractJsonObject('```json\n{"regions":[]}\n```')).toEqual({ regions: [] });
  });

  it('允许前后有说明文字', () => {
    expect(extractJsonObject('结果如下：{"regions":[]} 以上。')).toEqual({ regions: [] });
  });

  it('不是 JSON 时抛 invalid-response', () => {
    expect(() => extractJsonObject('抱歉，我不明白')).toThrowError(TranslationFailure);
  });
});

describe('readCompletionContent', () => {
  it('读取 choices[0].message.content', () => {
    expect(readCompletionContent({ choices: [{ message: { content: '{"a":1}' } }] })).toBe('{"a":1}');
  });

  it('结构缺失时报错', () => {
    expect(() => readCompletionContent({ choices: [] })).toThrowError(TranslationFailure);
  });
});

describe('OpenAICompatibleProvider', () => {
  it('缺少密钥或模型时构造失败', () => {
    const fetchImpl: typeof fetch = async () => completionResponse('{"regions":[]}');

    expect(() => createProvider(fetchImpl, { apiKey: '   ' })).toThrowError(TranslationFailure);
    expect(() => createProvider(fetchImpl, { model: '' })).toThrowError(TranslationFailure);
  });

  it('发送多模态请求并解析区域', async () => {
    let requestUrl = '';
    let requestBody = '';
    const fetchImpl: typeof fetch = async (inputUrl, init) => {
      requestUrl = String(inputUrl);
      requestBody = typeof init?.body === 'string' ? init.body : '';
      return completionResponse(
        JSON.stringify({
          regions: [
            {
              sourceText: 'こんにちは',
              translatedText: '你好',
              box: { x: 0.1, y: 0.2, width: 0.3, height: 0.25 },
            },
          ],
        }),
      );
    };

    const regions = await createProvider(fetchImpl).translate(input());

    expect(requestUrl).toBe('https://api.example.test/v1/chat/completions');
    expect(requestBody).toContain('"response_format":{"type":"json_object"}');
    expect(requestBody).toContain('data:image/jpeg;base64,AAAA');
    expect(requestBody).toContain('vision-model');
    expect(regions).toHaveLength(1);
    expect(regions[0]?.translatedText).toBe('你好');
  });

  it('系统提示包含防注入与坐标规则', () => {
    expect(SYSTEM_PROMPT).toContain('{"regions"');
    expect(SYSTEM_PROMPT).toContain('0');
  });

  it('401 映射为 auth 且不可重试', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'bad key' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });

    await expect(createProvider(fetchImpl).translate(input())).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
  });

  it('429 映射为 rate-limit 且可重试', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'slow down' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      });

    await expect(createProvider(fetchImpl).translate(input())).rejects.toMatchObject({
      kind: 'rate-limit',
      retryable: true,
    });
  });

  it('5xx 映射为 server', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });

    await expect(createProvider(fetchImpl).translate(input())).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('模型返回结构不符合约定时报 invalid-response', async () => {
    const fetchImpl: typeof fetch = async () =>
      completionResponse(JSON.stringify({ regions: [{ sourceText: 'x' }] }));

    await expect(createProvider(fetchImpl).translate(input())).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('空 regions 视为合法结果', async () => {
    const fetchImpl: typeof fetch = async () => completionResponse('{"regions":[]}');

    await expect(createProvider(fetchImpl).translate(input())).resolves.toEqual([]);
  });
});
