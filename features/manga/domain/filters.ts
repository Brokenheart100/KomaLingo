/**
 * 漫画图片的筛选规则（纯函数）。
 *
 * 目标：把网页里大量图标、头像、广告横幅、占位图过滤掉，只留下"像漫画分镜"的图片。
 * 规则刻意保守：误判为漫画只是多显示一个数字，漏判则用户完全感觉不到功能存在。
 */
import type { DetectionFilters, ImageGeometry, MangaImage } from './types';

/**
 * 默认筛选参数。
 *
 * - `minImageEdge: 280`：短边小于 280px 的多为图标、头像、表情。
 * - `maxAspectRatio: 4`：仅对"横图"生效（宽 > 高），用于过滤横幅广告；
 *   竖向长条（webtoon 条漫可高达 1:20）不参与该判断。
 * - `minDisplayEdge: 80`：被 CSS 缩成小缩略图的图片即使原图很大也跳过。
 */
export const DEFAULT_DETECTION_FILTERS: DetectionFilters = Object.freeze({
  minImageEdge: 280,
  maxAspectRatio: 4,
  minDisplayEdge: 80,
});

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 图片的短边：优先取原始尺寸，退化为显示尺寸。 */
export function imageShortEdge(geometry: ImageGeometry): number {
  const naturalShort =
    positive(geometry.naturalWidth) > 0 && positive(geometry.naturalHeight) > 0
      ? Math.min(geometry.naturalWidth, geometry.naturalHeight)
      : 0;
  const displayShort =
    positive(geometry.displayWidth) > 0 && positive(geometry.displayHeight) > 0
      ? Math.min(geometry.displayWidth, geometry.displayHeight)
      : 0;
  return Math.max(naturalShort, displayShort);
}

/** 图片的长边：与 {@link imageShortEdge} 使用同一套取值规则。 */
export function imageLongEdge(geometry: ImageGeometry): number {
  const naturalLong =
    positive(geometry.naturalWidth) > 0 && positive(geometry.naturalHeight) > 0
      ? Math.max(geometry.naturalWidth, geometry.naturalHeight)
      : 0;
  const displayLong =
    positive(geometry.displayWidth) > 0 && positive(geometry.displayHeight) > 0
      ? Math.max(geometry.displayWidth, geometry.displayHeight)
      : 0;
  return Math.max(naturalLong, displayLong);
}

/** 显示区域的短边；为 0 表示当前不可见（调用方通常已跳过）。 */
export function displayShortEdge(geometry: ImageGeometry): number {
  const width = positive(geometry.displayWidth);
  const height = positive(geometry.displayHeight);
  if (width === 0 || height === 0) {
    return 0;
  }
  return Math.min(width, height);
}

/**
 * 是否为"过宽"的横图（横幅广告、分隔条）。
 *
 * 仅在宽大于高时判断比例，竖长的条漫不受影响。
 */
export function isOverwide(image: MangaImage, maxAspectRatio: number): boolean {
  const { naturalWidth, naturalHeight, displayWidth, displayHeight } = image.geometry;
  const width = positive(naturalWidth) > 0 ? naturalWidth : displayWidth;
  const height = positive(naturalHeight) > 0 ? naturalHeight : displayHeight;
  if (width <= 0 || height <= 0 || width <= height) {
    return false;
  }
  if (!Number.isFinite(maxAspectRatio) || maxAspectRatio <= 0) {
    return false;
  }
  return width / height > maxAspectRatio;
}

/** 判断单张图片是否应被视为漫画候选。 */
export function passesDetectionFilters(
  image: MangaImage,
  filters: DetectionFilters = DEFAULT_DETECTION_FILTERS,
): boolean {
  if (imageShortEdge(image.geometry) < filters.minImageEdge) {
    return false;
  }
  const displayShort = displayShortEdge(image.geometry);
  if (displayShort > 0 && displayShort < filters.minDisplayEdge) {
    return false;
  }
  return !isOverwide(image, filters.maxAspectRatio);
}

/** 批量筛选，保持输入顺序。 */
export function filterMangaImages(
  images: readonly MangaImage[],
  filters: DetectionFilters = DEFAULT_DETECTION_FILTERS,
): MangaImage[] {
  return images.filter((image) => passesDetectionFilters(image, filters));
}

/** 统计位于视口附近的图片数量。 */
export function countNearViewport(images: readonly MangaImage[]): number {
  return images.reduce((count, image) => (image.nearViewport ? count + 1 : count), 0);
}
