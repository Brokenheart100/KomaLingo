/**
 * 设置存储适配层（WXT Storage）。
 *
 * 职责边界：
 * - 只做“持久化 + 校验 + 串行化”，不含业务规则（业务规则在 shared/contracts）；
 * - 唯一写入方是 Background（见 docs/ARCHITECTURE.md §7），其它上下文通过消息读写；
 * - 读取永远返回完整、合法的 `Settings`：存储里的历史数据或手工改坏的数据都会回退默认值。
 *
 * 失败语义：
 * - 数据损坏 → 回退默认值并尝试修复存储，不抛异常；
 * - 写入非法值 → `applySettingsPatch` / schema 抛 ZodError，写入不会发生；
 * - storage 本身不可用（极少见）→ 异常向上抛，由 Background 转成 `Result` 错误码。
 */

import { storage } from 'wxt/utils/storage';

import {
  DEFAULT_SETTINGS,
  applySettingsPatch,
  settingsSchema,
  type Settings,
  type SettingsPatch,
} from '../contracts/settings';

/** 存储键。集中在此处定义，避免各上下文各写一份字符串。 */
export const SETTINGS_STORAGE_KEY = 'local:settings';

const settingsItem = storage.defineItem<Settings>(SETTINGS_STORAGE_KEY, {
  fallback: DEFAULT_SETTINGS,
});

/**
 * 写操作串行化：`read → merge → write` 不是原子操作，
 * 两个并发的 patch 交错会互相覆盖。这里用一条 Promise 链保证顺序。
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeChain.then(operation, operation);
  // 无论成功失败都继续下一条，避免一次失败卡死后续写入。
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** 数据损坏时把默认值写回去；修复失败不影响本次读取结果。 */
async function healStorage(): Promise<void> {
  try {
    await settingsItem.setValue(DEFAULT_SETTINGS);
  } catch (cause) {
    console.warn('[KomaLingo] 设置数据损坏且无法写回默认值', cause);
  }
}

/**
 * 读取设置快照。
 * 返回值一定是新的对象（zod 解析会重建），调用方可以随意持有或比较。
 */
export async function readSettings(): Promise<Settings> {
  const raw: unknown = await settingsItem.getValue();
  const parsed = settingsSchema.safeParse(raw);

  if (parsed.success) return parsed.data;

  const firstIssue = parsed.error.issues[0];
  console.warn(
    '[KomaLingo] 设置数据不合法，已回退默认值',
    firstIssue ? `${firstIssue.path.join('.') || '<root>'}：${firstIssue.message}` : '未知原因',
  );
  await healStorage();
  return settingsSchema.parse({});
}

/** 整份写入。写入前强制校验，杜绝越界值落库。 */
export function writeSettings(next: Settings): Promise<Settings> {
  return serialized(async () => {
    const validated = settingsSchema.parse(next);
    await settingsItem.setValue(validated);
    return validated;
  });
}

/**
 * 局部更新（Popup / Options 的唯一写入口）。
 * 校验失败时 reject，存储保持不变。
 */
export function patchSettings(patch: SettingsPatch): Promise<Settings> {
  return serialized(async () => {
    const current = await readSettings();
    const next = applySettingsPatch(current, patch);
    await settingsItem.setValue(next);
    return next;
  });
}

/** 恢复出厂设置。 */
export function resetSettings(): Promise<Settings> {
  return serialized(async () => {
    const fresh = settingsSchema.parse({});
    await settingsItem.setValue(fresh);
    return fresh;
  });
}

/**
 * 监听设置变化（任何上下文写入都会触发）。
 * 回调收到的同样是经过校验的完整快照；不属于本上下文的 UI 状态请勿写进这里。
 *
 * @returns 取消监听的函数，组件卸载时必须调用。
 */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  return settingsItem.watch((next) => {
    const parsed = settingsSchema.safeParse(next);
    if (parsed.success) {
      listener(parsed.data);
      return;
    }
    console.warn('[KomaLingo] 收到非法设置变更，已按默认值处理');
    listener(settingsSchema.parse({}));
  });
}
