import { ZodError } from 'zod';

import { err, ok } from '../shared/lib/result';
import type { Settings } from '../shared/contracts/settings';
import {
  apiKeyPayloadSchema,
  cancelTranslationPayloadSchema,
  translateImagePayloadSchema,
} from '../shared/contracts/translation';
import {
  onMessage,
  type CredentialStatusPayload,
  type MessagingError,
  type MessagingResult,
  type PingResponse,
  type TranslateImageResponse,
} from '../shared/messaging';
import { ImageTranslationService } from '../features/translation/application/translate-image';
import { toTranslationFailure } from '../features/translation/domain/errors';
import type { TranslationErrorKind } from '../features/translation/domain/types';
import { FetchImageLoader } from '../features/translation/infrastructure/image-loader';
import { OpenAICompatibleProvider } from '../features/translation/infrastructure/openai-compatible-provider';
import {
  clearApiKey,
  getCredentialStatus,
  readApiKey,
  saveApiKey,
} from '../shared/storage/credentials';
import {
  patchSettings,
  readSettings,
  resetSettings,
} from '../shared/storage/settings-store';
import { translationCache } from '../shared/storage/translation-cache';

/**
 * Background Service Worker —— 扩展的唯一"大脑"。
 *
 * 职责（见 docs/ARCHITECTURE.md §3）：
 * - 注册并处理跨上下文消息；
 * - 作为设置的唯一写入方（Popup / Options / Content Script 都只能发 patch）；
 * - 唯一的网络出口（取图 + AI Provider），并保管 API Key；
 * - 翻译任务取消表（阶段三起）。
 *
 * 约束：
 * - SW 随时可能被回收，所有 handler 必须无状态、可重入；
 * - 不缓存设置快照，每次都从 storage 读取（storage 是唯一事实来源）；
 * - handler 一律返回 Result，异常在边界处收敛，绝不把抛出物丢过消息边界。
 */

const translationService = new ImageTranslationService({
  imageLoader: new FetchImageLoader(),
  cache: translationCache,
  getSettings: readSettings,
  getApiKey: readApiKey,
  createProvider: (config) => new OpenAICompatibleProvider(config),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toMessagingError(cause: unknown): MessagingError {
  if (cause instanceof ZodError) {
    const issue = cause.issues[0];
    const path = issue ? issue.path.join('.') || '<root>' : '<root>';
    const message = issue ? issue.message : '设置校验失败';
    return { code: 'invalid-patch', message: `${path}：${message}` };
  }
  return {
    code: 'storage-failure',
    message: cause instanceof Error ? cause.message : '设置存储不可用',
  };
}

const TRANSLATION_ERROR_CODES: Record<TranslationErrorKind, MessagingError['code']> = {
  'not-configured': 'not-configured',
  auth: 'auth',
  'rate-limit': 'rate-limit',
  'bad-request': 'provider-error',
  server: 'provider-error',
  network: 'provider-error',
  timeout: 'provider-error',
  cancelled: 'cancelled',
  'invalid-response': 'provider-error',
  'image-fetch': 'image-fetch',
  unknown: 'unexpected',
};

/** 把领域错误压平成可过消息边界的结构（不带堆栈、不带请求体）。 */
function toTranslationMessagingError(cause: unknown): MessagingError {
  const failure = toTranslationFailure(cause);
  const base = {
    code: TRANSLATION_ERROR_CODES[failure.kind],
    message: failure.message,
    retryable: failure.retryable,
  };
  return failure.status === null ? base : { ...base, status: failure.status };
}

/** 统一收敛设置类操作的异常。 */
async function guardSettings(
  action: () => Promise<Settings>,
): Promise<MessagingResult<Settings>> {
  try {
    return ok(await action());
  } catch (cause) {
    return err(toMessagingError(cause));
  }
}

async function guardCredentials(
  action: () => Promise<CredentialStatusPayload>,
): Promise<MessagingResult<CredentialStatusPayload>> {
  try {
    return ok(await action());
  } catch (cause) {
    return err({
      code: 'storage-failure',
      message: cause instanceof Error ? cause.message : '凭据存储不可用',
    });
  }
}

export default defineBackground(() => {
  onMessage('app:ping', (): MessagingResult<PingResponse> => {
    const manifest = browser.runtime.getManifest();
    return ok({ name: manifest.name, version: manifest.version });
  });

  onMessage('settings:get', () => guardSettings(readSettings));

  onMessage('settings:reset', () => guardSettings(resetSettings));

  onMessage('settings:patch', ({ data }) => {
    // 消息是不可信输入：先确认是对象，再交给 applySettingsPatch 做字段级校验。
    if (!isPlainObject(data)) {
      return err<MessagingError>({ code: 'invalid-patch', message: '设置补丁必须是对象' });
    }
    return guardSettings(() => patchSettings(data));
  });

  onMessage('credentials:status', () => guardCredentials(getCredentialStatus));

  onMessage('credentials:set', ({ data }) => {
    const parsed = apiKeyPayloadSchema.safeParse(data);
    if (!parsed.success) {
      return err<MessagingError>({ code: 'invalid-payload', message: 'API Key 格式不正确' });
    }
    return guardCredentials(() => saveApiKey(parsed.data.apiKey));
  });

  onMessage('credentials:clear', () => guardCredentials(clearApiKey));

  onMessage('translate:image', async ({ data }): Promise<MessagingResult<TranslateImageResponse>> => {
    const parsed = translateImagePayloadSchema.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue ? issue.path.join('.') || '<root>' : '<root>';
      return err<MessagingError>({
        code: 'invalid-payload',
        // imageUrl 失败通常不是"用户填错了"，而是页面图片是 blob/data/画布：
        // 单独给一条能指导处理的文案，避免用户对着字段名猜。
        message:
          path === 'imageUrl'
            ? '图片地址不可用：Background 只能读取 http(s) 链接（画布、blob:/data:、懒加载占位都不支持）'
            : `翻译请求不合法（${path}）`,
      });
    }

    try {
      // 结构化兼容：ImageTranslation 与 TranslateImageResponse 字段一一对应。
      const translation = await translationService.translate(parsed.data);
      return ok(translation);
    } catch (cause) {
      return err(toTranslationMessagingError(cause));
    }
  });

  onMessage('translate:cancel', ({ data }): MessagingResult<{ readonly cancelled: boolean }> => {
    const parsed = cancelTranslationPayloadSchema.safeParse(data);
    if (!parsed.success) {
      return err<MessagingError>({ code: 'invalid-payload', message: '取消失败：jobId 不合法' });
    }
    return ok({ cancelled: translationService.cancel(parsed.data.jobId) });
  });

  onMessage('permissions:ensure-host', async (): Promise<MessagingResult<{ readonly granted: boolean }>> => {
    try {
      const origins = ['<all_urls>'];
      if (await browser.permissions.contains({ origins })) {
        return ok({ granted: true });
      }
      // 只有用户手势触发的调用才会真正弹窗；失败时返回 false，由 UI 提示去扩展面板授权。
      return ok({ granted: await browser.permissions.request({ origins }) });
    } catch (cause) {
      return err<MessagingError>({
        code: 'unexpected',
        message: cause instanceof Error ? cause.message : '无法申请图片访问权限',
      });
    }
  });
});
