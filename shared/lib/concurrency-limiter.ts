/**
 * 并发限制器 —— 控制“同时在飞”的异步任务数量，超出的按 FIFO 排队。
 *
 * 为什么需要：漫画页会同时命中多张图，而翻译服务商有并发与限流约束；
 * 直接 `Promise.all` 全铺出去会稳定触发 429，也让取消语义难以收敛。
 *
 * 设计约束（见 docs/ARCHITECTURE.md I5、§10）：
 * - 队列严格 FIFO，先入先执行；
 * - 每个任务拿到独立 `AbortSignal`：外部取消与 `clear()` 都能立刻生效；
 * - 不吞异常：任务抛出的错误原样交给调用方；
 * - 零平台依赖，Background / Content Script / 单测都能复用。
 */

export type LimiterTask<T> = (signal: AbortSignal) => T | Promise<T>;

export interface ConcurrencyLimiterOptions {
  /** 同时执行的任务数上限，必须是 >= 1 的整数。 */
  readonly concurrency: number;
  /** 仅用于错误信息与调试，不影响行为。 */
  readonly name?: string;
}

/** 任务被取消时抛出的错误，便于调用方用 `instanceof` 区分“取消”与“真失败”。 */
export class AbortTaskError extends Error {
  constructor(message = '任务已取消') {
    super(message);
    this.name = 'AbortTaskError';
  }
}

interface QueueEntry {
  readonly controller: AbortController;
  /** 执行任务并结算外层 Promise；内部已捕获异常，因此返回的 Promise 永不 reject。 */
  readonly execute: () => Promise<void>;
  /** 尚未开始执行时直接拒绝外层 Promise。 */
  readonly reject: (error: unknown) => void;
  /** 解除外部 signal 的监听。 */
  detach: () => void;
}

export class ConcurrencyLimiter {
  readonly #concurrency: number;
  readonly #name: string;
  #queue: QueueEntry[] = [];
  #running = new Set<QueueEntry>();
  #idleWaiters: Array<() => void> = [];

  constructor(options: ConcurrencyLimiterOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new RangeError(`concurrency 必须是 >= 1 的整数，收到：${String(options.concurrency)}`);
    }
    this.#concurrency = options.concurrency;
    this.#name = options.name ?? 'limiter';
  }

  get name(): string {
    return this.#name;
  }

  /** 并发上限。 */
  get concurrency(): number {
    return this.#concurrency;
  }

  /** 正在执行的任务数。 */
  get active(): number {
    return this.#running.size;
  }

  /** 排队等待的任务数。 */
  get pending(): number {
    return this.#queue.length;
  }

  /** 队列与执行区都为空。 */
  get idle(): boolean {
    return this.#running.size === 0 && this.#queue.length === 0;
  }

  /**
   * 提交任务。任务在轮到它时才真正开始，因此排队期间不会产生任何副作用。
   *
   * @param task 接收本任务的 signal；把它传给 `fetch` 才能让取消真正中断网络请求。
   * @param options.signal 外部取消信号；排队中取消会立即移出队列，执行中取消会中断任务。
   */
  run<T>(task: LimiterTask<T>, options: { signal?: AbortSignal } = {}): Promise<T> {
    const externalSignal = options.signal;

    return new Promise<T>((resolve, reject) => {
      if (externalSignal?.aborted) {
        reject(new AbortTaskError(`${this.#name}：任务在入队前已被取消`));
        return;
      }

      const controller = new AbortController();
      const entry: QueueEntry = {
        controller,
        detach: () => {},
        reject,
        execute: async () => {
          try {
            resolve(await task(controller.signal));
          } catch (error) {
            reject(error);
          }
        },
      };

      if (externalSignal) {
        const onAbort = (): void => {
          const index = this.#queue.indexOf(entry);
          if (index !== -1) {
            // 还在排队：直接移出并拒绝，任务体不会被调用。
            this.#queue.splice(index, 1);
            entry.detach();
            reject(new AbortTaskError(`${this.#name}：任务在排队时被取消`));
            this.#flushIdle();
            return;
          }
          if (this.#running.has(entry)) {
            // 已经在跑：把取消传给任务自己的 signal（例如中断 fetch）。
            controller.abort(externalSignal.reason);
          }
        };

        externalSignal.addEventListener('abort', onAbort, { once: true });
        entry.detach = () => {
          externalSignal.removeEventListener('abort', onAbort);
        };
      }

      this.#queue.push(entry);
      this.#pump();
    });
  }

  /**
   * 清空限制器：排队任务全部拒绝，执行中任务通过 signal 中止。
   * 清空后限制器仍可继续 `run()`（用于“切换页面 / 重新开始”这类重置场景）。
   */
  clear(reason: unknown = new AbortTaskError(`${this.#name}：已清空`)): void {
    const error = reason instanceof Error ? reason : new AbortTaskError(String(reason));
    const queued = this.#queue.splice(0);

    for (const entry of queued) {
      entry.detach();
      entry.reject(error);
    }
    for (const entry of this.#running) {
      entry.controller.abort(error);
    }

    this.#flushIdle();
  }

  /** 等待所有任务结束（无论成功、失败还是被取消）。 */
  drain(): Promise<void> {
    if (this.idle) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#idleWaiters.push(resolve);
    });
  }

  #pump(): void {
    while (this.#running.size < this.#concurrency) {
      const entry = this.#queue.shift();
      if (entry === undefined) break;

      this.#running.add(entry);
      void entry.execute().finally(() => {
        entry.detach();
        this.#running.delete(entry);
        this.#pump();
      });
    }

    this.#flushIdle();
  }

  #flushIdle(): void {
    if (!this.idle) return;
    const waiters = this.#idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}
