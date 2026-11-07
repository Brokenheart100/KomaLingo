import { describe, expect, it, vi } from 'vitest';
import { fetchJson } from '../../shared/lib/fetch-json';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const noSleep = async (): Promise<void> => undefined;

describe('fetchJson', () => {
  it('解析成功响应', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ hello: 'world' });

    const result = await fetchJson('https://example.test/api', { fetchImpl, sleep: noSleep });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ hello: 'world' });
    }
  });

  it('5xx 重试后成功，并报告重试次数', async () => {
    let calls = 0;
    const onRetry = vi.fn();
    const sleep = vi.fn(noSleep);
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: 'busy' }, 503) : jsonResponse({ ok: true });
    };

    const result = await fetchJson('https://example.test/api', {
      fetchImpl,
      sleep,
      onRetry,
      maxAttempts: 2,
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('401 是确定性失败，不重试', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ error: 'unauthorized' }, 401);
    };

    const result = await fetchJson('https://example.test/api', {
      fetchImpl,
      sleep: noSleep,
      maxAttempts: 3,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('http');
      expect(result.error.status).toBe(401);
      expect(result.error.retryable).toBe(false);
    }
    expect(calls).toBe(1);
  });

  it('调用方已取消时不发起请求', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await fetchJson('https://example.test/api', {
      fetchImpl,
      signal: controller.signal,
      sleep: noSleep,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('aborted');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('响应不是 JSON 时报 parse 错误', async () => {
    const fetchImpl: typeof fetch = async () => new Response('<html>oops</html>', { status: 200 });

    const result = await fetchJson('https://example.test/api', { fetchImpl, sleep: noSleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('超时报 timeout 且标记可重试', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('已超时', 'AbortError'));
        });
      });

    const result = await fetchJson('https://example.test/api', {
      fetchImpl,
      sleep: noSleep,
      timeoutMs: 5,
      maxAttempts: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('timeout');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('尊重 Retry-After 的等待时间', async () => {
    const sleep = vi.fn(noSleep);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('{}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
        });
      }
      return jsonResponse({ ok: true });
    };

    const result = await fetchJson('https://example.test/api', {
      fetchImpl,
      sleep,
      maxAttempts: 2,
    });

    expect(result.ok).toBe(true);
    expect(sleep).toHaveBeenCalledWith(2000);
  });
});
