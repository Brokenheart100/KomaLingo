/**
 * 漫画图片的领域模型。
 *
 * 本文件不依赖 Vue / WXT / Chrome API，可在 Node、内容脚本、后台脚本中复用。
 */

/** 图片的承载方式，用于后续按来源做差异化处理（如 canvas 需要重新读取像素）。 */
export const IMAGE_SOURCE_KINDS = ['img', 'picture', 'canvas', 'background'] as const;

export type ImageSourceKind = (typeof IMAGE_SOURCE_KINDS)[number];

/**
 * 图片的尺寸信息。
 *
 * - `naturalWidth/Height`：图片自身的像素尺寸；`canvas` 取画布缓冲尺寸；内联背景图无法得知时为 0。
 * - `displayWidth/Height`：在页面上的 CSS 显示尺寸（来自 `getBoundingClientRect`）。
 */
export interface ImageGeometry {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
}

/** 通过尺寸、比例等启发式规则筛选后的漫画图片。 */
export interface MangaImage {
  /** 在页面生命周期内稳定的标识，用于去重与后续任务键。 */
  readonly id: string;
  /** 图片地址；`canvas` 等无地址的来源为空字符串。 */
  readonly url: string;
  /** `alt` 文本（可能为空）。 */
  readonly alt: string;
  readonly sourceKind: ImageSourceKind;
  readonly geometry: ImageGeometry;
  /** 元素是否落在视口上下各一屏范围内，用于"当前正在阅读"的判断。 */
  readonly nearViewport: boolean;
}

/** 检测阶段的筛选参数，由用户设置中的 `detection` 段派生。 */
export interface DetectionFilters {
  /** 图片短边最小值（像素），低于该值视为图标 / 装饰图。 */
  readonly minImageEdge: number;
  /** 长宽比上限，过滤横幅、广告条等极端比例。 */
  readonly maxAspectRatio: number;
  /** 显示短边最小值（像素），过滤被缩成小缩略图的图片。 */
  readonly minDisplayEdge: number;
}

/** 一次扫描的不可变结果，供 UI 渲染。 */
export interface DetectionSnapshot {
  readonly images: readonly MangaImage[];
  /** `images` 中位于视口附近的数量。 */
  readonly nearViewportCount: number;
  /** 快照生成时间（毫秒时间戳）。 */
  readonly updatedAt: number;
}
