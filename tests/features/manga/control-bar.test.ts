import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ControlBar from '../../../features/manga/presentation/ControlBar.vue';
import type { ControlBarModel } from '../../../features/manga/presentation/control-bar-model';

function model(overrides: Partial<ControlBarModel> = {}): ControlBarModel {
  return {
    running: true,
    count: 3,
    nearViewportCount: 2,
    dark: false,
    providerReady: true,
    translating: false,
    translateTotal: 0,
    translatedCount: 0,
    failedCount: 0,
    regionCount: 0,
    lastError: null,
    ...overrides,
  };
}

describe('ControlBar', () => {
  it('渲染品牌、数量与运行状态', () => {
    const wrapper = mount(ControlBar, { props: { model: model() } });

    expect(wrapper.text()).toContain('KomaLingo');
    expect(wrapper.text()).toContain('3');
    expect(wrapper.text()).toContain('视口附近 2 张');
    expect(wrapper.text()).toContain('运行中');
    expect(wrapper.text()).toContain('开始翻译');
  });

  it('深色模式下使用深色卡片类名', () => {
    const wrapper = mount(ControlBar, { props: { model: model({ dark: true }) } });
    expect(wrapper.html()).toContain('bg-slate-900/95');
  });

  it('暂停状态显示"已暂停"与"开始识别"', () => {
    const wrapper = mount(ControlBar, { props: { model: model({ running: false }) } });

    expect(wrapper.text()).toContain('已暂停');
    expect(wrapper.find('[aria-label="开始识别"]').exists()).toBe(true);
  });

  it('点击暂停按钮发出 toggle', async () => {
    const wrapper = mount(ControlBar, { props: { model: model() } });

    await wrapper.get('[aria-label="暂停识别"]').trigger('click');

    expect(wrapper.emitted('toggle')).toHaveLength(1);
  });

  it('刷新与设置按钮分别发出事件', async () => {
    const wrapper = mount(ControlBar, { props: { model: model() } });

    await wrapper.get('[aria-label="重新扫描"]').trigger('click');
    await wrapper.get('[aria-label="打开设置"]').trigger('click');

    expect(wrapper.emitted('refresh')).toHaveLength(1);
    expect(wrapper.emitted('openSettings')).toHaveLength(1);
  });

  it('未配置引擎时给出提示并可跳转设置', async () => {
    const wrapper = mount(ControlBar, { props: { model: model({ providerReady: false }) } });

    expect(wrapper.text()).toContain('尚未配置翻译引擎');
    const hint = wrapper.findAll('button').find((button) => button.text().includes('去设置'));
    await hint?.trigger('click');

    expect(wrapper.emitted('openSettings')).toHaveLength(1);
  });

  it('翻译中显示取消按钮与进度，点击发出 cancel', async () => {
    const wrapper = mount(ControlBar, {
      props: {
        model: model({ translating: true, translateTotal: 3, translatedCount: 1, regionCount: 4 }),
      },
    });

    expect(wrapper.text()).toContain('取消翻译');
    expect(wrapper.text()).toContain('33%');

    const cancel = wrapper.findAll('button').find((button) => button.text().includes('取消翻译'));
    await cancel?.trigger('click');

    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });

  it('把最近一次错误显示给用户', () => {
    const wrapper = mount(ControlBar, { props: { model: model({ lastError: '网络请求失败' }) } });
    expect(wrapper.text()).toContain('网络请求失败');
  });
});
