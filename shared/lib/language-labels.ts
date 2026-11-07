import type { LanguageCode } from './languages';

/**
 * 语言展示名（简体中文界面）。
 * 只做展示，不参与任何业务判断；第五阶段接入 i18n 后会改为按界面语言查表。
 */
export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  ja: '日语',
  ko: '韩语',
  en: '英语',
  'zh-CN': '简体中文',
  'zh-TW': '繁体中文',
};

/** 源语言的“自动识别”选项文案。 */
export const AUTO_LANGUAGE_LABEL = '自动识别';
