/**
 * Base64 编码工具（Service Worker 友好）。
 *
 * 为什么不用 `FileReader` / `URL.createObjectURL`：
 * - `FileReader` 在 MV3 Service Worker 中不可用（WorkerGlobalScope 没有它）；
 * - MV3 对 SW 里的 `URL.createObjectURL` 也有限制。
 * 因此统一走 `ArrayBuffer → 二进制字符串 → btoa`，分块拼接避免超长参数爆栈。
 */

/** 单次 `String.fromCharCode` 的字节数，避免 apply 参数过多。 */
const CHUNK_SIZE = 0x8000;

/** ArrayBuffer → base64（无前缀）。 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const slice = bytes.subarray(offset, offset + CHUNK_SIZE);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

/** 字节 → `data:` URL。 */
export function bytesToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
}
