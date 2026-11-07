<script setup lang="ts">
import { computed } from 'vue';
import {
  Languages,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Square,
  TriangleAlert,
} from 'lucide-vue-next';
import type { ControlBarModel } from './control-bar-model';

// 只读视图：父级持有可变状态，组件永远不写回
const props = defineProps<{ model: Readonly<ControlBarModel> }>();

const emit = defineEmits<{
  toggle: [];
  refresh: [];
  openSettings: [];
  translate: [];
  cancel: [];
}>();

/**
 * 深浅色两套类名以字面量形式写在源码里，Tailwind 才能扫描到；
 * 不使用 `dark:` 前缀，是因为 Shadow DOM 内的媒体查询与页面偏好未必一致。
 */
const tone = computed(() => {
  if (props.model.dark) {
    return {
      root: 'text-slate-100',
      card: 'border-white/10 bg-slate-900/95 shadow-black/50',
      title: 'text-white',
      muted: 'text-slate-400',
      faint: 'text-slate-500',
      track: 'bg-slate-700/70',
      row: 'border-white/10 bg-white/[0.03]',
      footer: 'border-white/10',
      warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15',
      error: 'text-rose-300',
      statusOn: 'bg-emerald-500/15 text-emerald-300',
      statusOff: 'bg-amber-500/15 text-amber-300',
      primaryButton: 'bg-indigo-500 text-white hover:bg-indigo-400',
      secondaryButton: 'bg-white/10 text-slate-100 hover:bg-white/15',
      dangerButton: 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25',
      iconButton: 'text-slate-300 hover:bg-white/10 hover:text-white',
    };
  }
  return {
    root: 'text-slate-800',
    card: 'border-slate-200 bg-white/95 shadow-slate-900/10',
    title: 'text-slate-900',
    muted: 'text-slate-500',
    faint: 'text-slate-400',
    track: 'bg-slate-200',
    row: 'border-slate-200 bg-slate-50/80',
    footer: 'border-slate-200',
    warning: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100',
    error: 'text-rose-600',
    statusOn: 'bg-emerald-50 text-emerald-700',
    statusOff: 'bg-amber-50 text-amber-700',
    primaryButton: 'bg-indigo-600 text-white hover:bg-indigo-500',
    secondaryButton: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
    dangerButton: 'bg-rose-50 text-rose-700 hover:bg-rose-100',
    iconButton: 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
  };
});

const statusText = computed(() => (props.model.running ? '运行中' : '已暂停'));
const toggleText = computed(() => (props.model.running ? '暂停识别' : '开始识别'));

const finishedCount = computed(() => props.model.translatedCount + props.model.failedCount);

const progressPercent = computed(() => {
  const total = props.model.translateTotal;
  if (total === 0) return 0;
  return Math.min(100, Math.round((finishedCount.value / total) * 100));
});

const progressHint = computed(() => {
  if (props.model.translating) return '正在翻译视口附近的图片…';
  if (props.model.translateTotal > 0) {
    return `已完成 ${finishedCount.value} / ${props.model.translateTotal} 张 · ${props.model.regionCount} 段文字`;
  }
  return '点击开始翻译视口附近的图片';
});

const canTranslate = computed(
  () => props.model.providerReady && props.model.nearViewportCount > 0 && !props.model.translating,
);
</script>

<template>
  <aside
    class="fixed bottom-4 right-4 z-[2147483646] w-[300px] select-none font-sans text-[13px] leading-snug antialiased"
    :class="tone.root"
    data-koma-lingo-bar=""
  >
    <div class="overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-md" :class="tone.card">
      <header class="flex items-center gap-2 px-3.5 pt-3">
        <span
          class="grid size-6 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-[11px] font-bold text-white"
          aria-hidden="true"
        >
          漫
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[13px] font-semibold" :class="tone.title">KomaLingo</p>
          <p class="truncate text-[11px]" :class="tone.muted">漫格译 · 图片识别</p>
        </div>
        <span
          class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
          :class="model.running ? tone.statusOn : tone.statusOff"
        >
          <span
            class="size-1.5 rounded-full"
            :class="model.running ? 'bg-emerald-400' : 'bg-amber-400'"
            aria-hidden="true"
          />
          {{ statusText }}
        </span>
      </header>

      <div class="px-3.5 pb-3 pt-3">
        <div class="flex items-end justify-between gap-2">
          <p class="flex items-baseline gap-1">
            <span class="text-2xl font-semibold tabular-nums" :class="tone.title">{{ model.count }}</span>
            <span class="text-[11px]" :class="tone.muted">张候选图</span>
          </p>
          <p class="text-[11px]" :class="tone.muted">视口附近 {{ model.nearViewportCount }} 张</p>
        </div>

        <div class="mt-3">
          <div class="flex items-center justify-between text-[11px]" :class="tone.muted">
            <span>翻译进度</span>
            <span class="tabular-nums">{{ progressPercent }}%</span>
          </div>
          <div class="mt-1 h-1 overflow-hidden rounded-full" :class="tone.track">
            <div
              class="h-full rounded-full bg-indigo-500 transition-[width] duration-300"
              :style="{ width: `${progressPercent}%` }"
            />
          </div>
          <p class="mt-1 flex items-center gap-1 text-[11px]" :class="tone.faint">
            <Loader2 v-if="model.translating" class="size-3 animate-spin" aria-hidden="true" />
            {{ progressHint }}
          </p>
          <p v-if="model.lastError" class="mt-1 flex items-start gap-1 text-[11px]" :class="tone.error">
            <TriangleAlert class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span class="min-w-0 break-words">{{ model.lastError }}</span>
          </p>
        </div>

        <button
          v-if="!model.providerReady"
          type="button"
          class="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition"
          :class="tone.warning"
          @click="emit('openSettings')"
        >
          <span>尚未配置翻译引擎</span>
          <span class="font-medium underline underline-offset-2">去设置</span>
        </button>

        <div
          class="mt-3 flex items-center justify-between rounded-lg border px-2.5 py-1.5"
          :class="tone.row"
        >
          <span class="flex items-center gap-1.5 text-[11px]" :class="tone.muted">
            <Languages class="size-3.5" aria-hidden="true" />
            原文 / 译文
          </span>
          <button
            type="button"
            role="switch"
            aria-checked="false"
            disabled
            class="relative h-4 w-8 shrink-0 cursor-not-allowed rounded-full opacity-50"
            :class="tone.track"
            title="第四阶段可用"
          >
            <span class="absolute left-0.5 top-0.5 size-3 rounded-full bg-white" />
          </button>
        </div>
      </div>

      <footer class="flex items-center gap-1.5 border-t px-2 py-2" :class="tone.footer">
        <button
          v-if="model.translating"
          type="button"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition"
          :class="tone.dangerButton"
          @click="emit('cancel')"
        >
          <Square class="size-3.5" aria-hidden="true" />
          取消翻译
        </button>
        <button
          v-else
          type="button"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
          :class="tone.primaryButton"
          :disabled="!canTranslate"
          @click="emit('translate')"
        >
          <Languages class="size-3.5" aria-hidden="true" />
          开始翻译
        </button>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-lg transition"
          :class="tone.iconButton"
          :title="toggleText"
          :aria-label="toggleText"
          @click="emit('toggle')"
        >
          <Pause v-if="model.running" class="size-3.5" aria-hidden="true" />
          <Play v-else class="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-lg transition"
          :class="tone.iconButton"
          title="重新扫描"
          aria-label="重新扫描"
          @click="emit('refresh')"
        >
          <RefreshCw class="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-lg transition"
          :class="tone.iconButton"
          title="打开设置"
          aria-label="打开设置"
          @click="emit('openSettings')"
        >
          <Settings class="size-3.5" aria-hidden="true" />
        </button>
      </footer>
    </div>
  </aside>
</template>
