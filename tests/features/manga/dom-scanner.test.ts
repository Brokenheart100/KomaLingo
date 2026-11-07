import { beforeEach, describe, expect, it } from 'vitest';
import { DomImageScanner } from '../../../features/manga/infrastructure/dom-scanner';

function stubRect(element: Element, x: number, y: number, width: number, height: number): void {
  const rect = new DOMRect(x, y, width, height);
  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => rect,
    configurable: true,
  });
}

function stubNaturalSize(image: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(image, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: height, configurable: true });
}

function absolute(path: string): string {
  return new URL(path, document.baseURI).href;
}

describe('DomImageScanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('扫描 <img>：解析绝对地址、原始尺寸与显示尺寸', () => {
    document.body.innerHTML = '<img src="/img/page-01.jpg" alt="第 1 页" />';
    const img = document.querySelector('img');
    if (img === null) {
      throw new Error('测试 DOM 未创建 img');
    }
    stubNaturalSize(img, 800, 1200);
    stubRect(img, 0, 0, 400, 600);

    const [candidate] = new DomImageScanner(document).scan();

    expect(candidate).toBeDefined();
    expect(candidate?.url).toBe(absolute('/img/page-01.jpg'));
    expect(candidate?.alt).toBe('第 1 页');
    expect(candidate?.sourceKind).toBe('img');
    expect(candidate?.geometry).toEqual({
      naturalWidth: 800,
      naturalHeight: 1200,
      displayWidth: 400,
      displayHeight: 600,
    });
    expect(candidate?.key).toMatch(/^img-\d+$/);
  });

  it('识别 <picture> 内的图片', () => {
    document.body.innerHTML = '<picture><source srcset="/a.webp" /><img src="/a.jpg" /></picture>';
    const img = document.querySelector('img');
    if (img === null) {
      throw new Error('测试 DOM 未创建 img');
    }
    stubNaturalSize(img, 800, 1200);
    stubRect(img, 0, 0, 400, 600);

    const [candidate] = new DomImageScanner(document).scan();
    expect(candidate?.sourceKind).toBe('picture');
  });

  it('识别 <canvas>：以画布缓冲尺寸作为原始尺寸', () => {
    document.body.innerHTML = '<canvas width="1000" height="1500"></canvas>';
    const canvas = document.querySelector('canvas');
    if (canvas === null) {
      throw new Error('测试 DOM 未创建 canvas');
    }
    stubRect(canvas, 0, 0, 500, 750);

    const [candidate] = new DomImageScanner(document).scan();
    expect(candidate?.sourceKind).toBe('canvas');
    expect(candidate?.url).toBe('');
    expect(candidate?.geometry.naturalWidth).toBe(1000);
    expect(candidate?.geometry.naturalHeight).toBe(1500);
  });

  it('识别内联背景图并解析相对地址', () => {
    document.body.innerHTML = '<div aria-label="封面"></div>';
    const div = document.querySelector('div');
    if (div === null) {
      throw new Error('测试 DOM 未创建 div');
    }
    div.setAttribute('style', 'background-image: url("/bg/cover.jpg"); background-size: cover;');
    stubRect(div, 0, 0, 300, 400);

    const [candidate] = new DomImageScanner(document).scan();
    expect(candidate?.sourceKind).toBe('background');
    expect(candidate?.url).toBe(absolute('/bg/cover.jpg'));
    expect(candidate?.alt).toBe('封面');
    expect(candidate?.geometry.naturalWidth).toBe(0);
  });

  it('跳过不可见元素（尺寸为 0）', () => {
    document.body.innerHTML = '<img src="/hidden.jpg" /><div style="background-image: url(/x.jpg)"></div>';
    const img = document.querySelector('img');
    if (img !== null) {
      stubNaturalSize(img, 800, 1200);
      stubRect(img, 0, 0, 0, 0);
    }

    expect(new DomImageScanner(document).scan()).toEqual([]);
  });

  it('跳过标记了 data-koma-lingo-ignore 的子树', () => {
    document.body.innerHTML =
      '<div data-koma-lingo-ignore><img src="/ignored.jpg" alt="忽略" /></div>';
    const img = document.querySelector('img');
    if (img === null) {
      throw new Error('测试 DOM 未创建 img');
    }
    stubNaturalSize(img, 800, 1200);
    stubRect(img, 0, 0, 400, 600);

    expect(new DomImageScanner(document).scan()).toEqual([]);
  });

  it('同一元素在多次扫描间保持稳定 key', () => {
    document.body.innerHTML = '<img src="/same.jpg" />';
    const img = document.querySelector('img');
    if (img === null) {
      throw new Error('测试 DOM 未创建 img');
    }
    stubNaturalSize(img, 800, 1200);
    stubRect(img, 0, 0, 400, 600);

    const scanner = new DomImageScanner(document);
    const first = scanner.scan()[0]?.key;
    const second = scanner.scan()[0]?.key;
    expect(first).toBe(second);
  });

  it('根据元素与视口的距离计算 nearViewport', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    document.body.innerHTML = '<img id="near" src="/near.jpg" /><img id="far" src="/far.jpg" />';
    const near = document.querySelector<HTMLImageElement>('#near');
    const far = document.querySelector<HTMLImageElement>('#far');
    if (near === null || far === null) {
      throw new Error('测试 DOM 未创建 img');
    }
    stubNaturalSize(near, 800, 1200);
    stubNaturalSize(far, 800, 1200);
    stubRect(near, 0, 100, 400, 600);
    stubRect(far, 0, 5000, 400, 600);

    const candidates = new DomImageScanner(document).scan();
    const nearCandidate = candidates.find((item) => item.key.endsWith('-0'));
    const farCandidate = candidates.find((item) => item.key.endsWith('-1'));

    expect(nearCandidate?.nearViewport).toBe(true);
    expect(farCandidate?.nearViewport).toBe(false);
  });

  it('遵守 maxCandidates 上限', () => {
    document.body.innerHTML = Array.from(
      { length: 5 },
      (_, index) => `<img src="/p-${index}.jpg" />`,
    ).join('');
    for (const element of document.querySelectorAll('img')) {
      stubNaturalSize(element, 800, 1200);
      stubRect(element, 0, 0, 400, 600);
    }

    const candidates = new DomImageScanner(document, { maxCandidates: 2 }).scan();
    expect(candidates).toHaveLength(2);
  });
});
