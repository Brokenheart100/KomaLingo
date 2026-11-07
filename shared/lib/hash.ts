/**
 * SHA-256（十六进制小写）。
 *
 * 用途：把"图片 key + 目标语言 + Provider/模型"折叠成稳定的缓存键。
 * Service Worker 与 Node 22 都提供 `crypto.subtle`，因此这是纯运行时能力，不引入依赖。
 */

const HEX = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, '0'));

/** 计算 SHA-256；输入按 UTF-8 编码。 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);

  let output = '';
  for (const byte of view) {
    output += HEX[byte] ?? '00';
  }
  return output;
}
