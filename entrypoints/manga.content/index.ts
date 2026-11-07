/**
 * 漫画图片识别 + 翻译内容脚本（阶段三）。
 *
 * 职责边界：本文件是"组合根" —— 负责把应用层用例、基础设施实现和 Vue 控制栏接在一起，
 * 并把浏览器 / Shadow DOM 的细节留在此处；domain 与 application 不认识浏览器。
 *
 * 生命周期：WXT 在扩展更新、卸载或页面卸载时使 ctx 失效；`createShadowRootUi` 会自动移除 UI，
 * 我们额外清理 detector、runner、设置订阅与媒体查询监听，避免残留回调。
 */
import { createApp, reactive, type App } from 'vue';
import { browser } from 'wxt/browser';
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { MangaDetector } from '../../features/manga/application/manga-detector';
import { DEFAULT_DETECTION_FILTERS } from '../../features/manga/domain/filters';
import type { DetectionFilters } from '../../features/manga/domain/types';
import { DomImageScanner } from '../../features/manga/infrastructure/dom-scanner';
import { DomImageWatcher } from '../../features/manga/infrastructure/image-observer';
import ControlBar from '../../features/manga/presentation/ControlBar.vue';
import type { ControlBarModel } from '../../features/manga/presentation/control-bar-model';
import { ImageTranslationRunner } from '../../features/translation/application/image-translation-runner';
import {
  describeSkippedImages,
  selectTranslationTargets,
} from '../../features/translation/application/select-targets';
import { err, ok } from '../../shared/lib/result';
import {
  DEFAULT_SETTINGS,
  isProviderConfigured,
  type Settings,
} from '../../shared/contracts/settings';
import { sendMessage } from '../../shared/messaging';
import { watchSettings } from '../../shared/storage/settings-store';
import './style.css';

const BAR_ELEMENT_NAME = 'koma-lingo-ui';

function toDetectionFilters(detection: Settings['detection']): DetectionFilters {
  return {
    minImageEdge: detection.minImageEdge,
    maxAspectRatio: DEFAULT_DETECTION_FILTERS.maxAspectRatio,
    minDisplayEdge: DEFAULT_DETECTION_FILTERS.minDisplayEdge,
  };
}

/**
 * 通过消息读取设置（I1：跨上下文只走 ProtocolMap）。
 * 后台未响应时回退默认值：识别能力不依赖翻译引擎是否配置。
 */
async function loadSettings(): Promise<Settings> {
  try {
    const result = await sendMessage('settings:get');
    return result.ok ? result.value : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** 翻译就绪 = 引擎设置完整 + 已在 Background 保存密钥。 */
async function loadProviderReady(settings: Settings): Promise<boolean> {
  if (!isProviderConfigured(settings)) return false;
  try {
    const result = await sendMessage('credentials:status');
    return result.ok && result.value.configured;
  } catch {
    return false;
  }
}

/** 图片由 Background 跨域下载，需要可选 host 权限；Content 没有 permissions API。 */
async function ensureHostPermission(): Promise<boolean> {
  try {
    const result = await sendMessage('permissions:ensure-host');
    return result.ok && result.value.granted;
  } catch {
    return false;
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  // 由 WXT 把打包后的 CSS 注入 Shadow DOM（见 style.css）
  cssInjectionMode: 'ui',

  async main(ctx) {
    const initialSettings = await loadSettings();
    if (!ctx.isValid) {
      return;
    }
    const providerReady = await loadProviderReady(initialSettings);
    if (!ctx.isValid) {
      return;
    }

    const state = reactive<ControlBarModel>({
      running: true,
      count: 0,
      nearViewportCount: 0,
      dark: false,
      providerReady,
      translating: false,
      translateTotal: 0,
      translatedCount: 0,
      failedCount: 0,
      regionCount: 0,
      lastError: null,
    });

    let latestSettings = initialSettings;
    const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = (): void => {
      const theme = latestSettings.overlay.theme;
      state.dark = theme === 'dark' || (theme === 'auto' && darkMedia.matches);
    };
    applyTheme();

    const detector = new MangaDetector({
      scanner: new DomImageScanner(document),
      watcher: new DomImageWatcher(document),
      filters: toDetectionFilters(initialSettings.detection),
    });

    const runner = new ImageTranslationRunner({
      translate: async (request) => {
        const result = await sendMessage('translate:image', {
          jobId: request.jobId,
          imageKey: request.imageKey,
          imageUrl: request.imageUrl,
        });
        return result.ok
          ? ok({ regions: result.value.regions })
          : err({ message: result.error.message, retryable: result.error.retryable });
      },
      cancel: async (jobId) => {
        await sendMessage('translate:cancel', { jobId });
      },
      onProgress: (progress) => {
        state.translating = progress.status === 'running';
        state.translateTotal = progress.total;
        state.translatedCount = progress.completed;
        state.failedCount = progress.failed;
        state.regionCount = progress.regions;
        state.lastError = progress.lastError;
      },
    });

    let mountedUi: ShadowRootContentScriptUi<App<Element>> | null = null;
    let mounting: Promise<void> | null = null;

    const openSettings = (): void => {
      void browser.runtime.openOptionsPage();
    };

    const toggle = (): void => {
      if (detector.running) {
        detector.stop();
        state.running = false;
        return;
      }
      detector.start();
      state.running = true;
    };

    const startTranslation = async (): Promise<void> => {
      if (state.translating) return;

      const granted = await ensureHostPermission();
      if (!ctx.isValid) return;
      if (!granted) {
        state.lastError = '需要授权访问图片站点：点击扩展图标，在弹窗里点「授权访问图片」';
        return;
      }

      // 先收敛目标：canvas、blob:/data: 内嵌图、尚未换出真实地址的懒加载占位
      // 都无法被 Background fetch，提前丢弃并给出可读原因，而不是发出去再报载荷错误。
      const selection = selectTranslationTargets(
        detector
          .getSnapshot()
          .images.map((image) => ({ id: image.id, url: image.url, nearViewport: image.nearViewport })),
      );

      if (selection.targets.length === 0) {
        state.lastError = describeSkippedImages(selection);
        return;
      }

      if (selection.skipped.total > 0) {
        console.info('[KomaLingo] 跳过不可读取的图片', selection.skipped, selection.schemes);
      }

      state.lastError = null;
      await runner.start(selection.targets);
    };

    const cancelTranslation = async (): Promise<void> => {
      await runner.cancelAll();
      state.translating = false;
    };

    /**
     * 只有检测到候选图片才挂载控制栏，避免在新闻、购物等页面无端出现悬浮窗。
     * 挂载后不再因数量归零而卸载：页面可能仍在懒加载，反复挂载会让按钮状态抖动。
     */
    const ensureBar = async (): Promise<void> => {
      if (mountedUi !== null || mounting !== null) {
        return;
      }
      mounting = (async () => {
        const ui = await createShadowRootUi(ctx, {
          name: BAR_ELEMENT_NAME,
          position: 'inline',
          anchor: 'body',
          append: 'last',
          onMount: (container) => {
            const app = createApp(ControlBar, {
              model: state,
              onToggle: toggle,
              onRefresh: () => {
                detector.refresh();
              },
              onOpenSettings: openSettings,
              onTranslate: () => {
                void startTranslation();
              },
              onCancel: () => {
                void cancelTranslation();
              },
            });
            app.mount(container);
            return app;
          },
          onRemove: (app) => {
            app?.unmount();
          },
        });
        ui.mount();
        mountedUi = ui;
      })();

      try {
        await mounting;
      } catch (error) {
        console.warn('[KomaLingo] 控制栏挂载失败', error);
      } finally {
        mounting = null;
      }
    };

    const unsubscribe = detector.subscribe((snapshot) => {
      state.count = snapshot.images.length;
      state.nearViewportCount = snapshot.nearViewportCount;
      if (state.count > 0) {
        void ensureBar();
      }
    });

    detector.start();

    const unwatchSettings = watchSettings((next) => {
      latestSettings = next;
      applyTheme();
      detector.setFilters(toDetectionFilters(next.detection));
      void loadProviderReady(next).then((ready) => {
        if (ctx.isValid) {
          state.providerReady = ready;
        }
      });
    });

    const onSchemeChange = (): void => {
      applyTheme();
    };
    darkMedia.addEventListener('change', onSchemeChange);

    ctx.onInvalidated(() => {
      darkMedia.removeEventListener('change', onSchemeChange);
      unwatchSettings();
      unsubscribe();
      detector.stop();
      void runner.cancelAll();
      mountedUi = null;
    });
  },
});
