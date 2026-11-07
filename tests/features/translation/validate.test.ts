import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  clampUnit,
  normalizeBox,
  prepareRegions,
  sortRegionsInReadingOrder,
} from '../../../features/translation/domain/validate';
import type { RawTranslatedRegion } from '../../../features/translation/domain/ports';
import type { TextRegion } from '../../../features/translation/domain/types';

function raw(
  sourceText: string,
  translatedText: string,
  box: { x: number; y: number; width: number; height: number },
): RawTranslatedRegion {
  return { sourceText, translatedText, box };
}

describe('clampUnit / normalizeBox', () => {
  it('把越界与非法数字收进 [0,1]', () => {
    expect(clampUnit(-0.5)).toBe(0);
    expect(clampUnit(1.5)).toBe(1);
    expect(clampUnit(Number.NaN)).toBe(0);
    expect(clampUnit(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('限制 x + width 与 y + height 不越界', () => {
    const box = normalizeBox({ x: 0.9, y: 0.8, width: 0.5, height: 0.6 });

    expect(box.width).toBeCloseTo(0.1, 6);
    expect(box.height).toBeCloseTo(0.2, 6);
  });
});

describe('prepareRegions', () => {
  it('丢弃空白文本与过小的噪点框', () => {
    const regions = prepareRegions(
      [
        raw('  ', '空原文', { x: 0.1, y: 0.1, width: 0.3, height: 0.2 }),
        raw('原文', '   ', { x: 0.2, y: 0.2, width: 0.3, height: 0.2 }),
        raw('噪点', '噪点', { x: 0.3, y: 0.3, width: 0.001, height: 0.001 }),
        raw('有效', '有效', { x: 0.4, y: 0.4, width: 0.3, height: 0.2 }),
      ],
      'ltr',
    );

    expect(regions).toHaveLength(1);
    expect(regions[0]?.sourceText).toBe('有效');
  });

  it('折叠空白并重建 r1.. 形式的 id', () => {
    const regions = prepareRegions(
      [
        raw('  こんにちは   世界 ', '你好 世界', { x: 0.1, y: 0.1, width: 0.3, height: 0.2 }),
        raw('第二格', '第二格', { x: 0.1, y: 0.6, width: 0.3, height: 0.2 }),
      ],
      'ltr',
    );

    expect(regions.map((region) => region.id)).toEqual(['r1', 'r2']);
    expect(regions[0]?.sourceText).toBe('こんにちは 世界');
  });

  it('先按行再按阅读方向排序（rtl 行内从右到左）', () => {
    const regions = prepareRegions(
      [
        raw('右下', '右下', { x: 0.6, y: 0.1, width: 0.2, height: 0.1 }),
        raw('左下', '左下', { x: 0.1, y: 0.1, width: 0.2, height: 0.1 }),
        raw('下一行', '下一行', { x: 0.1, y: 0.5, width: 0.2, height: 0.1 }),
      ],
      'rtl',
    );

    expect(regions.map((region) => region.translatedText)).toEqual(['右下', '左下', '下一行']);
  });

  it('把行内同一行的中心点 y 视为同一行而非按框顶拆分', () => {
    const regions = prepareRegions(
      [
        raw('高一点的', '高一点的', { x: 0.1, y: 0.1, width: 0.2, height: 0.12 }),
        raw('低一点的', '低一点的', { x: 0.5, y: 0.12, width: 0.2, height: 0.12 }),
      ],
      'ltr',
    );

    expect(regions.map((region) => region.translatedText)).toEqual(['高一点的', '低一点的']);
  });

  it('超过上限时截断到 80 条', () => {
    const many = Array.from({ length: 120 }, (_value, index) =>
      raw(`原文${index}`, `译文${index}`, { x: 0.1, y: 0.1, width: 0.2, height: 0.1 }),
    );

    expect(prepareRegions(many, 'ltr')).toHaveLength(80);
  });
});

describe('sortRegionsInReadingOrder', () => {
  it('ltr 行内从左到右', () => {
    const left: TextRegion = {
      id: 'a',
      sourceText: '左',
      translatedText: '左',
      box: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
    };
    const right: TextRegion = {
      id: 'b',
      sourceText: '右',
      translatedText: '右',
      box: { x: 0.6, y: 0.1, width: 0.2, height: 0.1 },
    };

    expect(sortRegionsInReadingOrder([right, left], 'ltr').map((region) => region.id)).toEqual(['a', 'b']);
  });
});

describe('boxesOverlap', () => {
  it('相交时返回 true，相切或分离时返回 false', () => {
    const base = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };

    expect(boxesOverlap(base, { x: 0.2, y: 0.2, width: 0.2, height: 0.2 })).toBe(true);
    expect(boxesOverlap(base, { x: 0.3, y: 0.1, width: 0.2, height: 0.2 })).toBe(false);
    expect(boxesOverlap(base, { x: 0.5, y: 0.5, width: 0.2, height: 0.2 })).toBe(false);
  });
});
