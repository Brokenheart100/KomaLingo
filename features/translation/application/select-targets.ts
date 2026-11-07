/**
 * 应用层：把"页面上看到的候选图"收敛成"Background 真能取到的翻译任务"。
 *
 * 这是纯函数，不做任何 DOM 操作，方便单测；内容脚本只负责把结果展示出来。
 */
import { inspectImageUrl } from '../../../shared/lib/image-url';
import type { TranslationTarget } from './image-translation-runner';

export interface TranslationCandidateInput {
  readonly id: string;
  readonly url: string;
  readonly nearViewport: boolean;
}

export interface SkippedImages {
  readonly empty: number;
  readonly tooLong: number;
  readonly unsupportedScheme: number;
  readonly invalid: number;
  readonly total: number;
}

export interface TargetSelection {
  readonly targets: readonly TranslationTarget[];
  readonly considered: number;
  readonly skipped: SkippedImages;
  /** 被跳过的非 http(s) 协议名（如 `blob`、`data`），用于提示文案。 */
  readonly schemes: readonly string[];
}

export function selectTranslationTargets(
  images: readonly TranslationCandidateInput[],
): TargetSelection {
  const targets: TranslationTarget[] = [];
  const skipped = { empty: 0, tooLong: 0, unsupportedScheme: 0, invalid: 0, total: 0 };
  const schemes = new Set<string>();
  let considered = 0;

  for (const image of images) {
    if (!image.nearViewport) {
      continue;
    }
    considered += 1;

    const inspection = inspectImageUrl(image.url);
    if (inspection.ok) {
      targets.push({ key: image.id, url: inspection.url });
      continue;
    }

    skipped.total += 1;
    switch (inspection.problem) {
      case 'empty':
        skipped.empty += 1;
        break;
      case 'too-long':
        skipped.tooLong += 1;
        break;
      case 'invalid':
        skipped.invalid += 1;
        break;
      case 'unsupported-scheme':
        skipped.unsupportedScheme += 1;
        if (inspection.scheme !== '') {
          schemes.add(inspection.scheme);
        }
        break;
    }
  }

  return { targets, considered, skipped, schemes: [...schemes].sort() };
}

/** 生成"为什么一张都翻不了"的可读解释；什么都不缺时返回空串。 */
export function describeSkippedImages(selection: TargetSelection): string {
  const { considered, skipped, schemes } = selection;
  if (considered === 0) {
    return '视口附近没有可翻译的图片';
  }
  if (skipped.total === 0) {
    return '';
  }

  const parts: string[] = [];
  if (skipped.empty > 0) {
    parts.push(`${skipped.empty} 张还没有加载出真实地址（懒加载占位）`);
  }
  if (skipped.unsupportedScheme > 0) {
    const names = schemes.length > 0 ? `（${schemes.join(' / ')}）` : '';
    parts.push(`${skipped.unsupportedScheme} 张是页面内嵌图片${names}，Background 无法跨域读取`);
  }
  if (skipped.invalid > 0) {
    parts.push(`${skipped.invalid} 张地址无法解析`);
  }
  if (skipped.tooLong > 0) {
    parts.push(`${skipped.tooLong} 张地址超过 4096 字符`);
  }

  return `视口附近 ${considered} 张图片都不可读取：${parts.join('；')}`;
}
