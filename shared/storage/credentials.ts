/**
 * API Key 存储（Background 独占）。
 *
 * 安全约束（docs/ARCHITECTURE.md §9 / 不变量 I2）：
 * - 只有 Background 读写本项；Content Script / Popup / Options 只能通过消息拿到
 *   `{ configured, maskedHint }`，永远拿不到明文；
 * - 不写日志、不进 `Settings`、不出现在任何返回值里；
 * - 存储本身是 `storage.local`（用户自担本地风险，README 已说明）。
 *
 * 数据损坏（手工改坏、旧版本字段）时直接清除并返回"未配置"，不抛异常。
 */

import { storage } from 'wxt/utils/storage';

/** 存储键。 */
export const CREDENTIALS_STORAGE_KEY = 'local:credentials';

/** 落库形状：带时间戳便于将来做轮换提示。 */
interface StoredCredentials {
  readonly apiKey: string;
  readonly updatedAt: number;
}

const MIN_API_KEY_LENGTH = 8;
const MAX_API_KEY_LENGTH = 512;

const credentialsItem = storage.defineItem<StoredCredentials | null>(CREDENTIALS_STORAGE_KEY, {
  fallback: null,
});

/** 脱敏展示：只保留前缀 3 位与末尾 4 位。 */
export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= MIN_API_KEY_LENGTH) return '••••••';
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

/** 对外状态：不含明文、不含长度（长度也能泄露信息）。 */
export interface CredentialStatus {
  readonly configured: boolean;
  readonly maskedHint: string | null;
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.apiKey === 'string'
    && candidate.apiKey.trim().length >= MIN_API_KEY_LENGTH
    && typeof candidate.updatedAt === 'number';
}

/** 读取明文；仅供 Background 内部使用（Provider 构造时）。 */
export async function readApiKey(): Promise<string | null> {
  const raw: unknown = await credentialsItem.getValue();
  if (raw === null) return null;

  if (!isStoredCredentials(raw)) {
    console.warn('[KomaLingo] 凭据数据不合法，已清除');
    await credentialsItem.setValue(null);
    return null;
  }

  return raw.apiKey;
}

export async function getCredentialStatus(): Promise<CredentialStatus> {
  const apiKey = await readApiKey();
  return apiKey === null
    ? { configured: false, maskedHint: null }
    : { configured: true, maskedHint: maskApiKey(apiKey) };
}

/**
 * 保存密钥。校验失败抛 Error（消息里不含密钥本身），由 Background 转成 Result。
 */
export async function saveApiKey(raw: string): Promise<CredentialStatus> {
  const apiKey = raw.trim();

  if (apiKey.length < MIN_API_KEY_LENGTH) {
    throw new Error('API Key 太短');
  }
  if (apiKey.length > MAX_API_KEY_LENGTH) {
    throw new Error('API Key 过长');
  }
  if (/\s/.test(apiKey)) {
    throw new Error('API Key 不能包含空白字符');
  }

  await credentialsItem.setValue({ apiKey, updatedAt: Date.now() });
  return { configured: true, maskedHint: maskApiKey(apiKey) };
}

/** 清除密钥（用户主动登出 / 换服务商）。 */
export async function clearApiKey(): Promise<CredentialStatus> {
  await credentialsItem.setValue(null);
  return { configured: false, maskedHint: null };
}
