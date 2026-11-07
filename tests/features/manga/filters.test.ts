import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DETECTION_FILTERS,
  countNearViewport,
  displayShortEdge,
  filterMangaImages,
  imageLongEdge,
  imageShortEdge,
  isOverwide,
  passesDetectionFilters,
} from '../../../features/manga/domain/filters';
import type { ImageGeometry, MangaImage } from '../../../features/manga/domain/types';

function geometry(overrides: Partial<ImageGeometry> = {}): ImageGeometry {
  return {
    naturalWidth: 800,
    naturalHeight: 1200,
    displayWidth: 400,
    displayHeight: 600,
    ...overrides,
  };
}

function image(overrides: Partial<MangaImage> = {}): MangaImage {
  return {
    id: 'img-0',
    url: 'https://example.com/page.jpg',
    alt: '',
    sourceKind: 'img',
    geometry: geometry(),
    nearViewport: true,
    ...overrides,
  };
}

describe('image geometry helpers', () => {
  it('取原始尺寸与显示尺寸中较大的短边', () => {
    expect(imageShortEdge(geometry({ naturalWidth: 0, naturalHeight: 0 }))).toBe(400);
    expect(imageShortEdge(geometry())).toBe(800);
    expect(imageLongEdge(geometry())).toBe(1200);
  });

  it('显示尺寸缺失时短边为 0', () => {
    expect(displayShortEdge(geometry({ displayWidth: 0, displayHeight: 0 }))).toBe(0);
  });
});

describe('passesDetectionFilters', () => {
  it('默认过滤掉小图标', () => {
    const icon = image({ geometry: geometry({ naturalWidth: 64, naturalHeight: 64, displayWidth: 32, displayHeight: 32 }) });
    expect(passesDetectionFilters(icon)).toBe(false);
  });

  it('短边恰好等于阈值时通过，低于阈值时拒绝', () => {
    const edge = image({ geometry: geometry({ naturalWidth: 280, naturalHeight: 900 }) });
    expect(passesDetectionFilters(edge)).toBe(true);

    // 显示尺寸一并缩小，避免"原始短边 279 但显示短边 400"被 max() 抬回阈值之上
    const belowEdge = image({
      geometry: geometry({ naturalWidth: 279, naturalHeight: 900, displayWidth: 139, displayHeight: 450 }),
    });
    expect(passesDetectionFilters(belowEdge)).toBe(false);
  });

  it('原图很大但被缩成缩略图时跳过', () => {
    const thumbnail = image({
      geometry: geometry({ naturalWidth: 2000, naturalHeight: 3000, displayWidth: 60, displayHeight: 90 }),
    });
    expect(passesDetectionFilters(thumbnail)).toBe(false);
  });

  it('过滤过宽的横幅广告', () => {
    const banner = image({ geometry: geometry({ naturalWidth: 1000, naturalHeight: 200, displayWidth: 500, displayHeight: 100 }) });
    expect(isOverwide(banner, DEFAULT_DETECTION_FILTERS.maxAspectRatio)).toBe(true);
    expect(passesDetectionFilters(banner)).toBe(false);
  });

  it('不误伤竖向长条漫画（1:15 的 webtoon 截图）', () => {
    const strip = image({ geometry: geometry({ naturalWidth: 800, naturalHeight: 12000, displayWidth: 400, displayHeight: 6000 }) });
    expect(isOverwide(strip, DEFAULT_DETECTION_FILTERS.maxAspectRatio)).toBe(false);
    expect(passesDetectionFilters(strip)).toBe(true);
  });

  it('保留输入顺序并只返回通过筛选的图片', () => {
    const big = image({ id: 'big' });
    const small = image({ id: 'small', geometry: geometry({ naturalWidth: 10, naturalHeight: 10, displayWidth: 10, displayHeight: 10 }) });
    expect(filterMangaImages([big, small]).map((item) => item.id)).toEqual(['big']);
  });
});

describe('countNearViewport', () => {
  it('统计 nearViewport 为真的数量', () => {
    const images = [
      image({ id: 'a', nearViewport: true }),
      image({ id: 'b', nearViewport: false }),
      image({ id: 'c', nearViewport: true }),
    ];
    expect(countNearViewport(images)).toBe(2);
  });
});
