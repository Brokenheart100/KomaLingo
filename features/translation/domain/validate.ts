/**
 * 模型输出的清洗与校验（纯函数，无 IO）。
 *
 * 这里把"模型返回的文字与坐标"一律当成不可信输入（见 docs/ARCHITECTURE.md §9）：
 * - 坐标 NaN / 越界 → clamp 到 [0,1] 并保证 x+w ≤ 1；
 * - 文字去空白、截断到上限，空文本区域丢弃；
 * - 过小的噪点框丢弃；
 * - 最后按阅读方向排序并重建 id。
 */

import {
  COORDINATE_EPSILON,
  MAX_REGION_TEXT_LENGTH,
  MAX_TRANSLATION_REGIONS,
  MIN_REGION_EDGE,
  READING_ROW_TOLERANCE,
} from '../../../shared/lib/translation-limits';
import type { RawTranslatedRegion } from './ports';
import type { NormalizedBox, TextRegion } from './types';

export type ReadingDirection = 'ltr' | 'rtl';

/** 把任意数字收进 [0,1]；NaN 视为 0，正负无穷分别收到 1 / 0。 */
export function clampUnit(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 归一化一个框：clamp 原点、限制宽高不越界。 */
export function normalizeBox(input: NormalizedBox): NormalizedBox {
  const x = clampUnit(input.x);
  const y = clampUnit(input.y);
  const width = Math.min(clampUnit(input.width), Math.max(0, 1 - x));
  const height = Math.min(clampUnit(input.height), Math.max(0, 1 - y));
  return { x, y, width, height };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_REGION_TEXT_LENGTH);
}

function isUsable(box: NormalizedBox): boolean {
  return box.width >= MIN_REGION_EDGE && box.height >= MIN_REGION_EDGE;
}

function centerY(region: TextRegion): number {
  return region.box.y + region.box.height / 2;
}

function centerX(region: TextRegion): number {
  return region.box.x + region.box.width / 2;
}

/**
 * 按阅读顺序排序：自上而下分行，行内按方向排列。
 *
 * 行的判定用中心点 y 的容差，而不是框的 y：气泡常常高低错落，
 * 用框顶会让同一行被拆开。
 */
export function sortRegionsInReadingOrder(
  regions: readonly TextRegion[],
  direction: ReadingDirection,
): TextRegion[] {
  const sorted = [...regions].sort((left, right) => centerY(left) - centerY(right) || centerX(left) - centerX(right));

  const rows: TextRegion[][] = [];
  for (const region of sorted) {
    const currentRow = rows.at(-1);
    const anchor = currentRow?.[0];
    if (currentRow !== undefined && anchor !== undefined
      && Math.abs(centerY(region) - centerY(anchor)) <= READING_ROW_TOLERANCE) {
      currentRow.push(region);
      continue;
    }
    rows.push([region]);
  }

  const ordered: TextRegion[] = [];
  for (const row of rows) {
    const inRow = [...row].sort((left, right) => (
      direction === 'rtl' ? centerX(right) - centerX(left) : centerX(left) - centerX(right)
    ));
    ordered.push(...inRow);
  }
  return ordered;
}

/**
 * 清洗 + 排序 + 重建 id。
 *
 * id 在排序之后统一生成（`r1`, `r2`…），因此同一份模型输出总是得到同一组 id，
 * 方便渲染层做差分与调试。
 */
export function prepareRegions(
  raw: readonly RawTranslatedRegion[],
  direction: ReadingDirection,
): TextRegion[] {
  const cleaned: TextRegion[] = [];

  for (const item of raw) {
    if (cleaned.length >= MAX_TRANSLATION_REGIONS) break;

    const sourceText = normalizeText(item.sourceText);
    const translatedText = normalizeText(item.translatedText);
    if (sourceText === '' || translatedText === '') continue;

    const box = normalizeBox(item.box);
    if (!isUsable(box)) continue;

    cleaned.push({
      id: '',
      sourceText,
      translatedText,
      box,
    });
  }

  const ordered = sortRegionsInReadingOrder(cleaned, direction);
  return ordered.map((region, index) => ({ ...region, id: `r${index + 1}` }));
}

/** 判断两个框是否几乎重合（调试/去重用，容差略大于浮点误差）。 */
export function boxesOverlap(left: NormalizedBox, right: NormalizedBox): boolean {
  const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return overlapX > COORDINATE_EPSILON && overlapY > COORDINATE_EPSILON;
}
