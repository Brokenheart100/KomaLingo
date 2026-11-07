/**
 * 图片地址的可读取性判定。
 *
 * Background 只能 `fetch` 公网 http(s) 地址：`blob:` 由页面创建、`data:` 内嵌、
 * 空地址（懒加载占位）都拿不到。与其把注定失败的请求发给 Background 再让
 * 载荷校验报错，不如在内容脚本组装任务时就分类丢弃，并给出可读原因。
 */

export const MAX_IMAGE_URL_LENGTH = 4096;

export type ImageUrlProblem = 'empty' | 'too-long' | 'unsupported-scheme' | 'invalid';

export type ImageUrlInspection =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly problem: ImageUrlProblem; readonly scheme: string };

/** 只允许 http(s)：`data:` / `blob:` / `file:` 一律拒绝。 */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function inspectImageUrl(value: string): ImageUrlInspection {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { ok: false, problem: 'empty', scheme: '' };
  }
  if (trimmed.length > MAX_IMAGE_URL_LENGTH) {
    return { ok: false, problem: 'too-long', scheme: '' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, problem: 'invalid', scheme: '' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, problem: 'unsupported-scheme', scheme: url.protocol.replace(/:$/, '') };
  }

  return { ok: true, url: trimmed };
}

export function isFetchableImageUrl(value: string): boolean {
  return inspectImageUrl(value).ok;
}
