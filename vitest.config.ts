import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

/**
 * 单元测试覆盖纯逻辑层（contracts / lib / storage）与漫画识别链路。
 *
 * - WxtVitest 按 wxt.config.ts 解析别名，并用 fake browser 替换 `browser` / `chrome`，
 *   因此 `wxt/utils/storage` 可以在 Node 下直接跑。
 * - `@vitejs/plugin-vue` 单独引入：WxtVitest 不包含 Vue SFC 编译，
 *   但控制栏组件需要在 happy-dom 中真实挂载。
 */
export default defineConfig({
  plugins: [WxtVitest(), vue()],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
