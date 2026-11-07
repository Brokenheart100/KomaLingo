/**
 * 图片加载与预处理（Background 实现）。
 *
 * 为什么在 Background：
 * - Content Script 的 `fetch` 受页面 CORS 限制，取不到 CDN 上的漫画图；
 * - Background 持有 host 权限后可跨域取图，并且能统一做体积/像素限制。
 *
 * 预处理：解码后若最长边 > `maxEdge`，用 OffscreenCanvas 缩放并转 JPEG。
 * 这既省 token 也避免超大图直接打爆请求体；服务 Worker 里没有 `FileReader`，
 * 因此编码走 shared/lib/base64 的 ArrayBuffer 路径。
 */

import { bytesToDataUrl } from '../../../shared/lib/base64';
import { TranslationFailure } from '../domain/errors';
import type { ImageLoader, ProviderImage } from '../domain/ports';

export interface ImageLoaderOptions {
  readonly fetchImpl?: typeof fetch;
  /** 原图字节上限，默认 12MB。 */
  readonly maxBytes?: number;
  /** 发送给模型的最长边，默认 1400px。 */
  readonly maxEdge?: number;
  /** JPEG 质量，默认 0.82。 */
  readonly jpegQuality?: number;
}

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_EDGE = 1400;
const DEFAULT_JPEG_QUALITY = 0.82;
const SUPPORTED_IMAGE_PREFIX = 'image/';

interface EncodedImage {
  readonly buffer: ArrayBuffer;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

function assertHttpUrl(url: string): void {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new TranslationFailure('image-fetch', '图片地址不合法');
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new TranslationFailure('image-fetch', '只支持 http(s) 图片');
  }
}

async function transcode(
  blob: Blob,
  maxEdge: number,
  quality: number,
): Promise<EncodedImage> {
  // 测试环境与部分内核没有 OffscreenCanvas：直接发送原图，宁可多花 token 也不失败。
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    const buffer = await blob.arrayBuffer();
    return { buffer, mimeType: blob.type, width: 0, height: 0 };
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longestEdge > maxEdge ? maxEdge / longestEdge : 1;

    if (scale === 1) {
      const buffer = await blob.arrayBuffer();
      return { buffer, mimeType: blob.type, width: bitmap.width, height: bitmap.height };
    }

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context === null) {
      const buffer = await blob.arrayBuffer();
      return { buffer, mimeType: blob.type, width: bitmap.width, height: bitmap.height };
    }

    context.drawImage(bitmap, 0, 0, width, height);
    const encoded = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return { buffer: await encoded.arrayBuffer(), mimeType: 'image/jpeg', width, height };
  } finally {
    bitmap.close();
  }
}

export class FetchImageLoader implements ImageLoader {
  readonly #fetch: typeof fetch;

  readonly #maxBytes: number;

  readonly #maxEdge: number;

  readonly #quality: number;

  constructor(options: ImageLoaderOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
    this.#quality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;
  }

  async load(url: string, signal?: AbortSignal): Promise<ProviderImage> {
    assertHttpUrl(url);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        signal,
        credentials: 'omit',
        cache: 'force-cache',
      });
    } catch (cause) {
      if (signal?.aborted === true) {
        throw new TranslationFailure('cancelled', '翻译已取消');
      }
      throw new TranslationFailure('image-fetch', `图片下载失败：${cause instanceof Error ? cause.message : '网络错误'}`, {
        retryable: true,
        cause,
      });
    }

    if (!response.ok) {
      throw new TranslationFailure('image-fetch', `图片下载失败：HTTP ${response.status}`, {
        status: response.status,
        retryable: response.status >= 500,
      });
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.startsWith(SUPPORTED_IMAGE_PREFIX)) {
      throw new TranslationFailure('image-fetch', `返回内容不是图片（${contentType || '未知类型'}）`);
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > this.#maxBytes) {
      throw new TranslationFailure('image-fetch', '图片体积超过限制');
    }

    const blob = await response.blob();
    if (blob.size > this.#maxBytes) {
      throw new TranslationFailure('image-fetch', '图片体积超过限制');
    }

    const encoded = await transcode(blob, this.#maxEdge, this.#quality);
    if (encoded.buffer.byteLength > this.#maxBytes) {
      throw new TranslationFailure('image-fetch', '图片体积超过限制');
    }

    return {
      dataUrl: bytesToDataUrl(encoded.buffer, encoded.mimeType),
      mimeType: encoded.mimeType,
      width: encoded.width,
      height: encoded.height,
    };
  }
}
