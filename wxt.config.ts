import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

/**
 * KomaLingo（漫格译）扩展构建配置。
 *
 * 设计原则：
 * - 权限最小化：第一阶段只声明 storage；访问任意站点与第三方 AI 端点的
 *   host 权限留到用户真正启用翻译时通过 optional_host_permissions 动态申请。
 * - 样式构建交给 Tailwind CSS v4 的 Vite 插件（v4 不再需要 tailwind.config.js）。
 * - Vue 支持由官方模块 @wxt-dev/module-vue 提供。
 */
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],

  manifest: {
    name: 'KomaLingo 漫格译',
    description: 'AI 漫画实时翻译：识别画面文字，把译文原位覆盖回气泡中。',
    permissions: ['storage'],
    optional_host_permissions: ['<all_urls>'],
  },

  // WXT 每次构建都会重新调用该函数，避免插件实例跨构建复用导致的状态泄漏。
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
