<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRaw } from 'vue';
import { CircleAlert, CircleCheck, KeyRound, RotateCcw, Save, ShieldCheck, ShieldOff } from 'lucide-vue-next';
import { browser } from 'wxt/browser';

import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch,
} from '../../shared/contracts/settings';
import { sendMessage } from '../../shared/messaging';

/**
 * 完整设置页。
 *
 * 数据流：本页只维护一份本地草稿（`form`），点击保存才发 patch；
 * 真正的校验发生在 Background（写入前必须过 schema），因此这里不重复实现业务校验，
 * 只需要把服务端返回的非法字段提示原样展示出来。
 */

const form = reactive<Settings>(structuredClone(DEFAULT_SETTINGS));
const savedJson = ref(JSON.stringify(form));
const saving = ref(false);
const message = ref('');
const errorMessage = ref('');

const isDirty = computed(() => JSON.stringify(form) !== savedJson.value);

/** 密钥草稿：只在本页内存里存在，保存后立即清空。 */
const apiKeyDraft = ref('');
const keyConfigured = ref(false);
const keyHint = ref<string | null>(null);
const keySaving = ref(false);
const keyMessage = ref('');

/** 跨域取图需要可选 host 权限（`<all_urls>` 仅用于读取图片二进制）。 */
const hostGranted = ref(false);
const hostRequesting = ref(false);

onMounted(() => {
  void load();
  void loadCredentials();
  void loadHostPermission();
});

async function load(): Promise<void> {
  try {
    const result = await sendMessage('settings:get');
    if (!result.ok) {
      errorMessage.value = result.error.message;
      return;
    }
    Object.assign(form, result.value);
    savedJson.value = JSON.stringify(form);
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : '读取设置失败';
  }
}

/** 只取可写字段；`version` 由存储层与 schema 管理，UI 不参与。 */
function toPatch(value: Settings): SettingsPatch {
  return {
    sourceLanguage: value.sourceLanguage,
    targetLanguage: value.targetLanguage,
    provider: value.provider,
    translation: value.translation,
    overlay: value.overlay,
    detection: value.detection,
  };
}

async function save(): Promise<void> {
  saving.value = true;
  message.value = '';
  errorMessage.value = '';
  try {
    // reactive 代理不能直接过消息边界，先取原始对象再序列化。
    const result = await sendMessage('settings:patch', toPatch(toRaw(form)));
    if (!result.ok) {
      errorMessage.value = result.error.message;
      return;
    }
    Object.assign(form, result.value);
    savedJson.value = JSON.stringify(form);
    message.value = '设置已保存';
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : '保存设置失败';
  } finally {
    saving.value = false;
  }
}

async function resetToDefaults(): Promise<void> {
  if (!window.confirm('恢复默认设置？当前配置会被覆盖。')) return;

  saving.value = true;
  message.value = '';
  errorMessage.value = '';
  try {
    const result = await sendMessage('settings:reset');
    if (!result.ok) {
      errorMessage.value = result.error.message;
      return;
    }
    Object.assign(form, result.value);
    savedJson.value = JSON.stringify(form);
    message.value = '已恢复默认设置';
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : '恢复默认设置失败';
  } finally {
    saving.value = false;
  }
}

async function loadCredentials(): Promise<void> {
  try {
    const result = await sendMessage('credentials:status');
    if (!result.ok) return;
    keyConfigured.value = result.value.configured;
    keyHint.value = result.value.maskedHint;
  } catch {
    // 读不到凭据状态不影响设置页其余功能。
  }
}

async function saveKey(): Promise<void> {
  if (keySaving.value) return;
  keySaving.value = true;
  keyMessage.value = '';
  errorMessage.value = '';

  try {
    const result = await sendMessage('credentials:set', { apiKey: apiKeyDraft.value });
    if (!result.ok) {
      errorMessage.value = result.error.message;
      return;
    }
    keyConfigured.value = result.value.configured;
    keyHint.value = result.value.maskedHint;
    apiKeyDraft.value = '';
    keyMessage.value = 'API Key 已保存，仅 Background 可读取';
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : '保存 API Key 失败';
  } finally {
    keySaving.value = false;
  }
}

async function clearKey(): Promise<void> {
  if (!window.confirm('清除已保存的 API Key？清除后无法翻译。')) return;
  keyMessage.value = '';
  try {
    const result = await sendMessage('credentials:clear');
    if (!result.ok) {
      errorMessage.value = result.error.message;
      return;
    }
    keyConfigured.value = false;
    keyHint.value = null;
    keyMessage.value = 'API Key 已清除';
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : '清除 API Key 失败';
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
  if (hostRequesting.value) return;
  hostRequesting.value = true;
  try {
    // 必须在用户手势（点击）里调用，否则 chrome 直接拒绝。
    hostGranted.value = await browser.permissions.request({ origins: ['<all_urls>'] });
  } catch {
    hostGranted.value = false;
  } finally {
    hostRequesting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10 text-slate-800 dark:text-slate-100">
    <header class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">KomaLingo 设置</h1>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
          配置翻译引擎、识别阈值与译文覆盖样式。
        </p>
      </div>
      <span
        class="mt-1 shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
        :class="
          isDirty
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
        "
      >
        {{ isDirty ? '有未保存修改' : '已同步' }}
      </span>
    </header>

    <div
      v-if="errorMessage"
      class="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
    >
      <CircleAlert :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />
      <span class="break-all">{{ errorMessage }}</span>
    </div>

    <div
      v-if="message"
      class="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
    >
      <CircleCheck :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{{ message }}</span>
    </div>

    <form class="flex flex-col gap-5" @submit.prevent="save">
      <section
        class="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 class="text-sm font-semibold">翻译引擎</h2>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
          OpenAI 兼容接口。密钥在下方「API Key」中单独保存，只存在 Background，不会暴露给页面脚本。
        </p>

        <div class="mt-4 flex flex-col gap-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">服务地址（baseUrl）</span>
            <input
              v-model="form.provider.baseUrl"
              type="url"
              required
              placeholder="https://api.openai.com/v1"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-indigo-900"
            />
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">模型名</span>
            <input
              v-model="form.provider.model"
              type="text"
              placeholder="填写支持图片理解的多模态模型"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-indigo-900"
            />
            <span class="text-xs text-slate-500 dark:text-slate-400">
              模型需要同时具备看图、识别文字与翻译的能力。
            </span>
          </label>
        </div>
      </section>

      <section
        class="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 class="flex items-center gap-2 text-sm font-semibold">
          <KeyRound :size="16" aria-hidden="true" />
          API Key
        </h2>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
          仅保存在 Background 的 <code>storage.local</code>，页面脚本、Popup 与 Content Script 永远拿不到明文。
          浏览器扩展的本地存储并非保险箱，请使用可随时吊销的专用密钥。
        </p>

        <p v-if="keyConfigured" class="mt-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <ShieldCheck :size="16" aria-hidden="true" />
          已保存：<span class="font-mono">{{ keyHint }}</span>
        </p>
        <p v-else class="mt-3 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <ShieldOff :size="16" aria-hidden="true" />
          尚未保存密钥
        </p>

        <div class="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            v-model="apiKeyDraft"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="sk-..."
            class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-indigo-900"
            @keydown.enter.prevent="saveKey"
          />
          <button
            type="button"
            class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="keySaving || apiKeyDraft.trim().length < 8"
            @click="saveKey"
          >
            {{ keySaving ? '保存中…' : '保存密钥' }}
          </button>
          <button
            v-if="keyConfigured"
            type="button"
            class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            @click="clearKey"
          >
            清除
          </button>
        </div>
        <p v-if="keyMessage" class="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{{ keyMessage }}</p>
      </section>

      <section
        class="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 class="text-sm font-semibold">图片访问权限</h2>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Background 需要下载漫画原图再交给模型；由于请求发生在扩展侧，必须授予可选的站点访问权限。
          译文与识别结果不会上传到除你配置的模型服务之外的任何地方。
        </p>
        <button
          type="button"
          class="mt-4 rounded-lg border px-3 py-2 text-sm font-medium transition"
          :class="
            hostGranted
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
              : 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
          "
          :disabled="hostRequesting"
          @click="requestHostPermission"
        >
          {{ hostGranted ? '已授权访问图片' : hostRequesting ? '正在请求…' : '授权访问图片' }}
        </button>
      </section>

      <section
        class="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 class="text-sm font-semibold">翻译质量</h2>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
          并发过高容易触发服务商限流；重试次数不含首次请求。
        </p>

        <div class="mt-4 grid grid-cols-2 gap-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">并发数（1–4）</span>
            <input
              v-model.number="form.translation.concurrency"
              type="number"
              min="1"
              max="4"
              step="1"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">采样温度（0–1）</span>
            <input
              v-model.number="form.translation.temperature"
              type="number"
              min="0"
              max="1"
              step="0.1"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">失败重试（1–3）</span>
            <input
              v-model.number="form.translation.maxAttempts"
              type="number"
              min="1"
              max="3"
              step="1"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">请求超时（毫秒）</span>
            <input
              v-model.number="form.translation.requestTimeoutMs"
              type="number"
              min="5000"
              max="120000"
              step="1000"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        </div>
      </section>

      <section
        class="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 class="text-sm font-semibold">页面识别</h2>

        <div class="mt-4 grid grid-cols-2 gap-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">最小图片短边（像素）</span>
            <input
              v-model.number="form.detection.minImageEdge"
              type="number"
              min="64"
              step="8"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">解码像素上限</span>
            <input
              v-model.number="form.detection.maxDecodedPixels"
              type="number"
              min="1000000"
              step="1000000"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        </div>

        <label class="mt-4 flex items-center gap-2.5 text-sm">
          <input
            v-model="form.detection.autoTranslate"
            type="checkbox"
            class="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
          />
          <span>图片进入视口后自动翻译</span>
        </label>
      </section>

      <section
        class="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 class="text-sm font-semibold">译文覆盖层</h2>

        <div class="mt-4 grid grid-cols-2 gap-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">主题</span>
            <select
              v-model="form.overlay.theme"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="auto">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">控制栏显示</span>
            <select
              v-model="form.overlay.controlBar"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="auto">自动隐藏</option>
              <option value="always">始终显示</option>
              <option value="hidden">不显示</option>
            </select>
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">字号缩放（0.6–1.8）</span>
            <input
              v-model.number="form.overlay.fontScale"
              type="number"
              min="0.6"
              max="1.8"
              step="0.05"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>

          <label class="flex items-center gap-2.5 self-end pb-2 text-sm">
            <input
              v-model="form.overlay.showOriginalToggle"
              type="checkbox"
              class="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
            />
            <span>显示“原文/译文”切换</span>
          </label>
        </div>
      </section>

      <div class="flex items-center justify-between gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          :disabled="saving"
          @click="resetToDefaults"
        >
          <RotateCcw :size="15" aria-hidden="true" />
          恢复默认
        </button>

        <button
          type="submit"
          class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!isDirty || saving"
        >
          <Save :size="15" aria-hidden="true" />
          {{ saving ? '保存中…' : '保存修改' }}
        </button>
      </div>
    </form>
  </div>
</template>
