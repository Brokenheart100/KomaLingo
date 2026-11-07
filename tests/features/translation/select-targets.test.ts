import { describe, expect, it } from 'vitest';

import {
  describeSkippedImages,
  selectTranslationTargets,
  type TranslationCandidateInput,
} from '../../../features/translation/application/select-targets';

function image(id: string, url: string, nearViewport = true): TranslationCandidateInput {
  return { id, url, nearViewport };
}

describe('selectTranslationTargets', () => {
  it('保留 http(s) 地址，忽略视口外的图片', () => {
    const selection = selectTranslationTargets([
      image('a', 'https://cdn.example.com/a.jpg'),
      image('b', 'http://cdn.example.com/b.png'),
      image('c', 'https://cdn.example.com/c.jpg', false),
    ]);

    expect(selection.targets).toEqual([
      { key: 'a', url: 'https://cdn.example.com/a.jpg' },
      { key: 'b', url: 'http://cdn.example.com/b.png' },
    ]);
    expect(selection.considered).toBe(2);
    expect(selection.skipped.total).toBe(0);
    expect(describeSkippedImages(selection)).toBe('');
  });

  it('跳过 blob: 并记录协议名', () => {
    const selection = selectTranslationTargets([
      image('a', 'blob:https://site.example.com/2f7c-11ee'),
      image('b', 'https://cdn.example.com/b.jpg'),
    ]);

    expect(selection.targets).toHaveLength(1);
    expect(selection.skipped.unsupportedScheme).toBe(1);
    expect(selection.schemes).toEqual(['blob']);
  });

  it('跳过 data: 内嵌图', () => {
    const selection = selectTranslationTargets([
      image('a', 'data:image/gif;base64,R0lGODlhAQABAAAAACw='),
    ]);

    expect(selection.targets).toHaveLength(0);
    expect(selection.skipped.unsupportedScheme).toBe(1);
    expect(selection.schemes).toEqual(['data']);
  });

  it('跳过没有地址的画布与懒加载占位', () => {
    const selection = selectTranslationTargets([image('canvas-0', ''), image('img-1', '  ')]);

    expect(selection.targets).toHaveLength(0);
    expect(selection.skipped.empty).toBe(2);
    expect(selection.skipped.total).toBe(2);
  });

  it('跳过超长地址（>4096 字符）', () => {
    const longUrl = `https://cdn.example.com/${'a'.repeat(4100)}.jpg`;
    const selection = selectTranslationTargets([image('a', longUrl)]);

    expect(selection.targets).toHaveLength(0);
    expect(selection.skipped.tooLong).toBe(1);
  });

  it('跳过无法解析的地址', () => {
    const selection = selectTranslationTargets([image('a', 'not a url')]);

    expect(selection.targets).toHaveLength(0);
    expect(selection.skipped.invalid).toBe(1);
  });

  it('两种协议并存时排序去重', () => {
    const selection = selectTranslationTargets([
      image('a', 'data:image/png;base64,AAAA'),
      image('b', 'blob:https://site.example.com/1'),
      image('c', 'blob:https://site.example.com/2'),
    ]);

    expect(selection.schemes).toEqual(['blob', 'data']);
  });
});

describe('describeSkippedImages', () => {
  it('汇总多种不可读原因', () => {
    const selection = selectTranslationTargets([
      image('a', 'blob:https://site.example.com/1'),
      image('b', ''),
      image('c', `https://cdn.example.com/${'x'.repeat(4100)}.jpg`),
    ]);

    const message = describeSkippedImages(selection);

    expect(message).toContain('3 张图片都不可读取');
    expect(message).toContain('懒加载占位');
    expect(message).toContain('blob');
    expect(message).toContain('4096');
  });

  it('视口附近没有图片时提示先滚动或刷新', () => {
    const selection = selectTranslationTargets([
      image('a', 'https://cdn.example.com/a.jpg', false),
    ]);

    expect(describeSkippedImages(selection)).toBe('视口附近没有可翻译的图片');
  });
});
