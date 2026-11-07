/**
 * 翻译调度器（Application 层，运行在 Content Script 侧）。
 *
 * 为什么在页面侧而不是 Background：
 * - 只有页面知道哪些图在视口附近、哪些已经翻译过；
 * - Background 的 SW 随时可能被回收，不能长期持有"这个页面翻到第几张"的状态；
 * - 并发上限按"每页"控制，避免多个页面同时打满配额。
 *
 * 不含任何 DOM 访问，也不认识具体消息协议：收发函数由组合根注入。
 */

import type { Result } from '../../../shared/lib/result';

/** 一个待翻译目标；`key` 用页面内的稳定元素 key，天然去重。 */
export interface TranslationTarget {
  readonly key: string;
  readonly url: string;
}

export interface RunnerError {
  readonly message: string;
  readonly retryable?: boolean;
}

export interface RunnerResult {
  readonly regions: readonly { readonly id: string }[];
}

export type TranslateFn = (request: {
  readonly jobId: string;
  readonly imageKey: string;
  readonly imageUrl: string;
}) => Promise<Result<RunnerResult, RunnerError>>;

export type CancelFn = (jobId: string) => Promise<unknown>;

export interface TranslationRunnerProgress {
  readonly status: 'idle' | 'running';
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly regions: number;
  readonly active: number;
  readonly lastError: string | null;
}

export interface ImageTranslationRunnerOptions {
  readonly translate: TranslateFn;
  readonly cancel: CancelFn;
  readonly concurrency?: number;
  readonly createJobId?: () => string;
  readonly onProgress?: (progress: TranslationRunnerProgress) => void;
}

const DEFAULT_CONCURRENCY = 2;

/** 生成 jobId：优先用 crypto.randomUUID，缺省时退回时间戳 + 随机数。 */
function defaultJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ImageTranslationRunner {
  readonly #translate: TranslateFn;

  readonly #cancel: CancelFn;

  readonly #concurrency: number;

  readonly #createJobId: () => string;

  readonly #onProgress: ((progress: TranslationRunnerProgress) => void) | undefined;

  /** 已经成功翻译过的 key（同一页面内不重复付费）。 */
  readonly #done = new Set<string>();

  /** 正在排队/在途的 key。 */
  readonly #seen = new Set<string>();

  /** 在途 jobId → key。 */
  readonly #active = new Map<string, string>();

  #status: 'idle' | 'running' = 'idle';

  #total = 0;

  #completed = 0;

  #failed = 0;

  #regions = 0;

  #lastError: string | null = null;

  constructor(options: ImageTranslationRunnerOptions) {
    this.#translate = options.translate;
    this.#cancel = options.cancel;
    this.#concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    this.#createJobId = options.createJobId ?? defaultJobId;
    this.#onProgress = options.onProgress;
  }

  get progress(): TranslationRunnerProgress {
    return {
      status: this.#status,
      total: this.#total,
      completed: this.#completed,
      failed: this.#failed,
      regions: this.#regions,
      active: this.#active.size,
      lastError: this.#lastError,
    };
  }

  /** 标记某张图已翻译（例如命中了缓存但没经过本 runner）。 */
  markDone(key: string): void {
    this.#done.add(key);
  }

  /**
   * 翻译一批目标。已完成的 key 会跳过；并发固定为 `concurrency`。
   * 返回时所有任务都已结算（成功、失败或取消）。
   */
  async start(targets: readonly TranslationTarget[]): Promise<void> {
    const pending: TranslationTarget[] = [];
    const queued = new Set<string>();
    for (const target of targets) {
      if (this.#done.has(target.key) || this.#seen.has(target.key) || queued.has(target.key)) continue;
      queued.add(target.key);
      pending.push(target);
    }
    if (pending.length === 0) return;

    for (const target of pending) {
      this.#seen.add(target.key);
      this.#total += 1;
    }

    this.#status = 'running';
    this.#lastError = null;
    this.#emit();

    const queue = [...pending];
    const workers = Array.from(
      { length: Math.min(this.#concurrency, queue.length) },
      () => this.#work(queue),
    );

    try {
      await Promise.all(workers);
    } finally {
      if (this.#status === 'running') {
        this.#status = 'idle';
      }
      this.#emit();
    }
  }

  /** 取消全部排队与在途任务；已完成的记录保留。 */
  async cancelAll(): Promise<void> {
    this.#status = 'idle';
    const jobIds = [...this.#active.keys()];
    this.#active.clear();
    this.#seen.clear();

    await Promise.all(jobIds.map((jobId) => this.#cancel(jobId).catch(() => undefined)));

    // 取消后允许用户再次点击"开始翻译"重试失败的图。
    this.#emit();
  }

  /** 清空统计（切换页面/重新扫描时用不到，保留给测试与调试）。 */
  reset(): void {
    this.#done.clear();
    this.#seen.clear();
    this.#active.clear();
    this.#status = 'idle';
    this.#total = 0;
    this.#completed = 0;
    this.#failed = 0;
    this.#regions = 0;
    this.#lastError = null;
    this.#emit();
  }

  async #work(queue: TranslationTarget[]): Promise<void> {
    for (;;) {
      if (this.#status !== 'running') return;
      const target = queue.shift();
      if (target === undefined) return;
      await this.#translateOne(target);
    }
  }

  async #translateOne(target: TranslationTarget): Promise<void> {
    if (this.#status !== 'running' || this.#done.has(target.key)) return;

    const jobId = this.#createJobId();
    this.#active.set(jobId, target.key);
    this.#emit();

    try {
      const result = await this.#translate({
        jobId,
        imageKey: target.key,
        imageUrl: target.url,
      });

      if (this.#status !== 'running') return;

      if (result.ok) {
        this.#done.add(target.key);
        this.#completed += 1;
        this.#regions += result.value.regions.length;
        if (result.value.regions.length === 0) {
          this.#lastError = '这张图没有识别到文字';
        }
      } else {
        this.#failed += 1;
        this.#lastError = result.error.message;
      }
    } catch (cause) {
      if (this.#status !== 'running') return;
      this.#failed += 1;
      this.#lastError = cause instanceof Error ? cause.message : '翻译失败';
    } finally {
      this.#active.delete(jobId);
      this.#seen.delete(target.key);
      this.#emit();
    }
  }

  #emit(): void {
    this.#onProgress?.(this.progress);
  }
}
