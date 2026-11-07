/**
 * 翻译结果的硬性边界（纯常量，无依赖）。
 *
 * 为什么单独放 shared/lib：
 * - `shared/contracts` 的 zod schema 要用它做上界；
 * - `features/translation/domain` 的纯函数校验也要用它；
 * - domain 不允许依赖 zod（ADR-08），所以常量不能写在 contracts 里，只能放在
 *   两者都可依赖的 shared/lib。
 */

/** 单张图最多接受多少个文字区域。超过说明模型在乱标，直接截断。 */
export const MAX_TRANSLATION_REGIONS = 80;

/** 单个区域的原文 / 译文最长字符数（防止模型复读整章）。 */
export const MAX_REGION_TEXT_LENGTH = 2000;

/** 归一化坐标下的最小边长；小于它的框视为噪点。 */
export const MIN_REGION_EDGE = 0.004;

/** 判定两个区域是否属于同一"行"的 y 轴容差（归一化坐标）。 */
export const READING_ROW_TOLERANCE = 0.03;

/** 归一化坐标因浮点误差允许的溢出量。 */
export const COORDINATE_EPSILON = 1e-4;
