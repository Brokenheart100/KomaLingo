<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { BookOpenText, CircleAlert, KeyRound, Settings2, ShieldCheck, ShieldOff } from 'lucide-vue-next';
import { browser } from 'wxt/browser';

import {
  LANGUAGE_CODES,
  isProviderConfigured,
  languageSchema,
  sourceLanguageSchema,
  type Settings,
  type SettingsPatch,
} from '../../shared/contracts/settings';
import { AUTO_LANGUAGE_LABEL, LANGUAGE_LABELS } from '../../shared/lib/language-labels';
import { sendMessage } from '../../shared/messaging';

type ConnectionStatus = 'connecting' | 'online' | 'offline';

const settings = ref<Settings | null>(null);
const status = ref<ConnectionStatus>('connecting');
const version = ref('');
const errorMessage = ref('');
const saving = ref(false);
/** 是否已在 Background 保存 API Key（明文永不下发到 Popup）。 */
const keyConfigured = ref(false);
const keyHint = ref<string | null>(null);
/** 跨域取图所需的可选 host 权限。 */
const hostGranted = ref(false);

const targetOptions = LANGUAGE_CODES.map((code) => ({
  value: code,
  label: LANGUAGE_LABELS[code],
}));

const sourceOptions = [
  { value: 'auto', label: AUTO_LANGUAGE_LABEL },
  ...targetOptions,
];

const statusText = computed(() => {
  switch (status.value) {
    case 'online':
      return '后台已连接';
    case 'offline':
      return '后台未响应';
    default:
      return '连接中…';
  }
});

const statusDotClass = computed(() => {
  switch (status.value) {
    case 'online':
      return 'bg-emerald-500';
    case 'offline':
      return 'bg-rose-500';
    default:
      return 'bg-amber-400';
  }
});

const providerReady = computed(
  () => (settings.value ? isProviderConfigured(settings.value) : false) && keyConfigured.value,
);

onMounted(() => {
  void pingBackground();
  void loadSettings();
  void loadCredentials();
  void loadHostPermission();
});

async function loadCredentials(): Promise<void> {
  try {
    const result = await sendMessage('credentials:status');
    if (!result.ok) return;
    keyConfigured.value = result.value.configured;
    keyHint.value = result.value.maskedHint;
  } catch {
    // 状态读取失败不阻塞弹窗其余部分。
  }
}

async function loadHostPermission(): Promise<void> {
  try {
    hostGranted.value = await browser.permissions.contains({ origins: ['<all_urls>'] });
  } catch {
    hostGranted.value = false;
  }
}

async function requestHostPermission(): Promise<void> {
  try {
    // Popup 是扩展页面，点击即用户手势，可以直接申请。
    hostGranted.value = await browser.permissions.request({ origins: ['<all_urls>'] });
  } catch {
    hostGranted.value = false;
  }
}

async function pingBackground(): Promise<void> {
  status.value = 'connecting';
  try {
    const result = await sendMessage('app:ping');
    if (result.ok) {
      status.value = 'online';
      version.value = result.value.version;
      return;
    }
    status.value = 'offline';
    errorMessage.value = result.error.message;
  } catch (cause) {
    status.value = 'offline';
    errorMessage.value = cause instanceof Error ? cause.message : '无法连接后台服务';
  }
}

async function loadSettings(): Promise<void> {
  try {
    const result = await sendMessage('settings:get');
    if (result.ok) {
      settings.value = result.value;
      return;
    }
    errorMessage.value = result.error.message;
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : '读取设置失败';
  }
}

async function applyPatch(patch: SettingsPatch): Promise<void> {
  saving.value = true;
  errorMessage.value = '';
  try {
    const result = await sendMessage('settings:patch', patch);
    if (result.ok) {
      settings.value = result.value;
    } else {
      errorMessage.value = result.error.message;
    }
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : '保存设置失败';
  } finally {
    saving.value = false;
  }
}

/** 从事件里取 select 的值；不用类型断言，靠 instanceof 收窄。 */
function readSelectValue(event: Event): string {
  const target = event.target;
  return target instanceof HTMLSelectElement ? target.value : '';
}

function onTargetLanguageChange(event: Event): void {
  const parsed = languageSchema.safeParse(readSelectValue(event));
  if (!parsed.success) return;
  void applyPatch({ targetLanguage: parsed.data });
}

function onSourceLanguageChange(event: Event): void {
  const parsed = sourceLanguageSchema.safeParse(readSelectValue(event));
  if (!parsed.success) return;
  void applyPatch({ sourceLanguage: parsed.data });
}

function toggleAutoTranslate(): void {
  if (!settings.value || saving.value) return;
  void applyPatch({ detection: { autoTranslate: !settings.value.detection.autoTranslate } });
}

function openOptions(): void {
  void browser.runtime.openOptionsPage();
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4 text-slate-800 dark:text-slate-100">
    <header class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <span
          class="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm"
        >
          <BookOpenText :size="19" aria-hidden="true" />
        </span>
        <div>
          <h1 class="text-sm leading-tight font-semibold">KomaLingo 漫格译</h1>
          <p class="text-xs text-slate-500 dark:text-slate-400">AI 漫画实时翻译</p>
        </div>
      </div>
      <div class="flex items-center gap-1.5 pt-1">
        <span class="size-2 rounded-full" :class="statusDotClass" aria-hidden="true"></span>
        <span class="text-xs text-slate-500 dark:text-slate-400">{{ statusText }}</span>
      </div>
    </header>

    <div
      v-if="errorMessage"
      class="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
    >
      <CircleAlert :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />
      <span class="break-all">{{ errorMessage }}</span>
    </div>

    <template v-if="settings">
      <section
        class="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
      >
        <div class="flex items-center justify-between gap-3">
          <label for="target-language" class="text-sm font-medium">译文语言</label>
          <select
            id="target-language"
            :value="settings.targetLanguage"
            :disabled="saving"
            class="w-36 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
            @change="onTargetLanguageChange"
          >
            <option v-for="option in targetOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="flex items-center justify-between gap-3">
          <label for="source-language" class="text-sm font-medium">原文语言</label>
          <select
            id="source-language"
            :value="settings.sourceLanguage"
            :disabled="saving"
            class="w-36 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
            @change="onSourceLanguageChange"
          >
            <option v-for="option in sourceOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-700">
          <div>
            <p class="text-sm font-medium">进入视口后自动翻译</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">关闭时需在页面上手动触发</p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="settings.detection.autoTranslate"
            :disabled="saving"
            class="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60"
            :class="settings.detection.autoTranslate ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'"
            @click="toggleAutoTranslate"
          >
            <span
              class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform"
              :class="settings.detection.autoTranslate ? 'translate-x-5' : 'translate-x-0'"
            ></span>
          </button>
        </div>
      </section>

      <section
        v-if="!providerReady"
        class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        <p class="font-medium">尚未配置翻译引擎</p>
        <p class="mt-1 text-amber-700 dark:text-amber-300">
          需要填写模型与服务地址，并在「完整设置」里保存 API Key。
        </p>
        <button
          type="button"
          class="mt-2 inline-flex items-center gap-1.5 font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100"
          @click="openOptions"
        >
          前往配置
        </button>
      </section>

      <section
        class="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <KeyRound :size="14" aria-hidden="true" />
            API Key
          </span>
          <span v-if="keyConfigured" class="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck :size="14" aria-hidden="true" />
            <span class="font-mono">{{ keyHint }}</span>
          </span>
          <span v-else class="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <ShieldOff :size="14" aria-hidden="true" />
            未保存
          </span>
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-slate-100 pt-2.5 dark:border-slate-700">
          <span class="text-slate-600 dark:text-slate-300">图片访问权限</span>
          <button
            v-if="hostGranted"
            type="button"
            class="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            @click="requestHostPermission"
          >
            <ShieldCheck :size="13" aria-hidden="true" />
            已授权
          </button>
          <button
            v-else
            type="button"
            class="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            @click="requestHostPermission"
          >
            授权访问图片
          </button>
        </div>
      </section>

      <footer class="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
        <span class="text-xs text-slate-400 dark:text-slate-500">
          {{ version ? `v${version}` : '版本未知' }}
        </span>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          @click="openOptions"
        >
          <Settings2 :size="14" aria-hidden="true" />
          完整设置
        </button>
      </footer>

      <p class="text-center text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
        第三阶段：图片识别与 AI 翻译已接入；译文覆盖层将在第四阶段实现。
      </p>
    </template>

    <p v-else-if="!errorMessage" class="py-6 text-center text-xs text-slate-400">正在读取设置…</p>
  </div>
</template>
