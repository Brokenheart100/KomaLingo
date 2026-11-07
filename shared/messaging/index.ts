import { defineExtensionMessaging } from '@webext-core/messaging';

import type { LanguageCode, SourceLanguage } from '../lib/languages';
import type { Settings, SettingsPatch } from '../contracts/settings';
import type { Result } from '../lib/result';

/**
 * 扩展上下文之间的唯一通信契约。
 *
 * 规则：
 * - 所有跨上下文调用必须在此登记，禁止裸用 browser.runtime.sendMessage；
 * - 载荷必须是结构化克隆可序列化的纯数据（不能带 Map / Class / 函数）；
 * - 消息本身是不可信输入，Background 收到后仍要用 schema 校验；
 * - 可能失败的调用一律返回 `Result`，而不是抛异常——异常过不了消息边界，
 *   到对岸只会剩下一个丢失类型的 Error 字符串。
 *
 * 传输类型在这里独立声明（而不是 import 域模型），保证 shared 不反向依赖 features；
 * Background 侧可以用结构化兼容的对象直接返回，无需额外转换函数。
 */

/** Background 侧可返回的错误码，Popup / Content Script 依此决定提示文案与重试策略。 */
export type MessagingErrorCode =
  /** 载荷结构非法（例如 patch 不是对象、字段越界）。 */
  | 'invalid-patch'
  /** 翻译请求载荷非法。 */
  | 'invalid-payload'
  /** 存储层失败（读写异常、配额问题）。 */
  | 'storage-failure'
  /** 未配置翻译引擎或 API Key。 */
  | 'not-configured'
  /** 密钥无效 / 权限不足（401、403）。 */
  | 'auth'
  /** 触发限流（429）。 */
  | 'rate-limit'
  /** Provider 返回结构非法或拒绝请求。 */
  | 'provider-error'
  /** 图片下载失败。 */
  | 'image-fetch'
  /** 任务被取消。 */
  | 'cancelled'
  /** 未预期的异常，详情见 message。 */
  | 'unexpected';

export interface MessagingError {
  readonly code: MessagingErrorCode;
  readonly message: string;
  /** 是否值得重试（由 Background 判定，Content Script 直接照做）。 */
  readonly retryable?: boolean;
  /** HTTP 状态码，便于 UI 区分 401 与 429。 */
  readonly status?: number;
}

export type MessagingResult<T> = Result<T, MessagingError>;

/** 探活响应：Popup 用它确认 Background 存活并展示版本号。 */
export interface PingResponse {
  readonly name: string;
  readonly version: string;
}

/** 凭据状态：永远不含明文，只给脱敏提示。 */
export interface CredentialStatusPayload {
  readonly configured: boolean;
  readonly maskedHint: string | null;
}

export interface SaveCredentialPayload {
  readonly apiKey: string;
}

/** 翻译请求载荷；`jobId` 由客户端生成，用于取消与结果关联。 */
export interface TranslateImagePayload {
  readonly jobId: string;
  readonly imageKey: string;
  readonly imageUrl: string;
  readonly targetLanguage?: LanguageCode;
}

export interface CancelTranslationPayload {
  readonly jobId: string;
}

export interface TranslatedRegionPayload {
  readonly id: string;
  readonly sourceText: string;
  readonly translatedText: string;
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface TranslateImageResponse {
  readonly jobId: string;
  readonly imageKey: string;
  readonly targetLanguage: LanguageCode;
  readonly sourceLanguage: SourceLanguage;
  readonly providerId: string;
  readonly model: string;
  readonly regions: readonly TranslatedRegionPayload[];
  readonly createdAt: number;
  readonly fromCache: boolean;
}

export interface ProtocolMap {
  /** 探活 + 版本号。 */
  'app:ping'(): MessagingResult<PingResponse>;
  /** 读取当前设置快照。 */
  'settings:get'(): MessagingResult<Settings>;
  /** Background 作为唯一写入方，合并 patch 后返回最新快照。 */
  'settings:patch'(patch: SettingsPatch): MessagingResult<Settings>;
  /** 恢复默认设置。 */
  'settings:reset'(): MessagingResult<Settings>;
  /** 查询是否已保存 API Key（只回脱敏状态）。 */
  'credentials:status'(): MessagingResult<CredentialStatusPayload>;
  /** 保存 API Key（仅 Background 落库，不回显明文）。 */
  'credentials:set'(payload: SaveCredentialPayload): MessagingResult<CredentialStatusPayload>;
  /** 清除 API Key。 */
  'credentials:clear'(): MessagingResult<CredentialStatusPayload>;
  /** 翻译一张图片：下载图片、调用模型、清洗区域并写缓存。 */
  'translate:image'(payload: TranslateImagePayload): MessagingResult<TranslateImageResponse>;
  /** 取消在途翻译任务。 */
  'translate:cancel'(payload: CancelTranslationPayload): MessagingResult<{ readonly cancelled: boolean }>;
  /**
   * 申请图片站点访问权限（`optional_host_permissions`）。
   * Content Script 没有 `permissions` API，只能转给 Background；仍可能因缺少用户手势失败。
   */
  'permissions:ensure-host'(): MessagingResult<{ readonly granted: boolean }>;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
