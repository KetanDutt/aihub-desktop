/**
 * Queue + rate limit for the local API (pure).
 *
 * The endpoint drives real browser tabs, so an unbounded caller could fork a
 * hundred renderers on a laptop in one command. Two small limiters stand in the
 * way: a concurrency queue with a bounded backlog, and a sliding-window request
 * budget.
 */

class QueueFullError extends Error {
  constructor(message = 'Local queue is full') {
    super(message);
    this.name = 'QueueFullError';
    this.code = 'queue_full';
  }
}

class CancelledError extends Error {
  constructor(message = 'Request cancelled') {
    super(message);
    this.name = 'CancelledError';
    this.code = 'cancelled';
  }
}

/**
 * @param {{concurrency?: number, maxQueued?: number}} [options]
 */
function createQueue({ concurrency = 2, maxQueued = 16 } = {}) {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  const backlog = Math.max(0, Math.floor(maxQueued));
  const waiting = [];
  let active = 0;
  let served = 0;
  let rejected = 0;

  function drain() {
    while (active < limit && waiting.length > 0) {
      const task = waiting.shift();
      if (task.cancelled) continue;
      active += 1;
      runTask(task);
    }
  }

  function runTask(task) {
    const settle = (settlement) => {
      active = Math.max(0, active - 1);
      if (task.timer) {
        clearTimeout(task.timer);
        task.timer = null;
      }
      const index = waiting.indexOf(task);
      if (index !== -1) waiting.splice(index, 1);
      drain();
      settlement();
    };

    served += 1;
    let result;
    try {
      result = task.fn(task.signal);
    } catch (error) {
      settle(() => task.reject(error));
      return;
    }

    Promise.resolve(result).then(
      (value) => settle(() => task.resolve(value)),
      (error) => settle(() => task.reject(error))
    );
  }

  /**
   * @param {(signal: {aborted: boolean, onAbort: (fn: () => void) => void}) => Promise<any>} fn
   * @param {{timeoutMs?: number, signal?: {aborted: boolean, addEventListener?: Function}}} [options]
   *   `signal` lets the caller cancel: a task that has not started is dropped
   *   from the queue, one that is already running is told to stop.
   */
  function run(fn, { timeoutMs = 0, signal: externalSignal = null } = {}) {
    if (typeof fn !== 'function') return Promise.reject(new TypeError('fn must be a function'));

    const signal = {
      aborted: false,
      _listeners: [],
      onAbort(listener) {
        if (typeof listener === 'function') this._listeners.push(listener);
      },
      abort(reason) {
        if (signal.aborted) return;
        signal.aborted = true;
        for (const listener of signal._listeners) {
          try {
            listener(reason);
          } catch (e) {
            /* a broken listener must not stall the queue */
          }
        }
      }
    };

    if (active >= limit && waiting.length >= backlog) {
      rejected += 1;
      return Promise.reject(new QueueFullError());
    }

    return new Promise((resolve, reject) => {
      const task = { fn, resolve, reject, cancelled: false, signal, timer: null };
      signal.onAbort(() => {
        const index = waiting.indexOf(task);
        if (index !== -1) {
          // Still queued: drop it, the work never started.
          task.cancelled = true;
          waiting.splice(index, 1);
          reject(new CancelledError());
          drain();
        }
        // If it is already running the task itself observes `signal.aborted`
        // and tears its work down; the settle path resolves the promise.
      });
      if (timeoutMs > 0) {
        task.timer = setTimeout(() => {
          if (waiting.includes(task)) {
            task.cancelled = true;
            waiting.splice(waiting.indexOf(task), 1);
            reject(new Error('Timed out waiting for a free slot'));
            drain();
          }
        }, timeoutMs);
        if (typeof task.timer.unref === 'function') task.timer.unref();
      }
      waiting.push(task);

      if (externalSignal) {
        if (externalSignal.aborted) {
          task.signal.abort('cancelled before start');
        } else if (typeof externalSignal.addEventListener === 'function') {
          externalSignal.addEventListener(
            'abort',
            () => task.signal.abort('cancelled by caller'),
            { once: true }
          );
        }
      }

      drain();
    });
  }

  return {
    run,
    get active() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
    get limit() {
      return limit;
    },
    stats() {
      return { active, queued: waiting.length, limit, served, rejected };
    }
  };
}

/**
 * Sliding-window limiter keyed per caller.
 * @param {{limit?: number, windowMs?: number}} [options]
 */
function createRateLimiter({ limit = 60, windowMs = 60000 } = {}) {
  const max = Math.max(1, Math.floor(limit) || 1);
  const window = Math.max(1000, Math.floor(windowMs) || 60000);
  /** key -> number[] (request timestamps) */
  const hits = new Map();

  function tryAcquire(key = 'default', now = Date.now()) {
    const cutoff = now - window;
    const list = (hits.get(key) || []).filter((stamp) => stamp > cutoff);

    if (list.length >= max) {
      hits.set(key, list);
      const waitMs = Math.max(0, list[0] + window - now);
      return { allowed: false, remaining: 0, retryAfterMs: waitMs, limit: max };
    }

    list.push(now);
    hits.set(key, list);
    return { allowed: true, remaining: max - list.length, retryAfterMs: 0, limit: max };
  }

  function reset(key) {
    if (key === undefined) hits.clear();
    else hits.delete(key);
  }

  return {
    tryAcquire,
    reset,
    get size() {
      return hits.size;
    }
  };
}

/** Fixed retry budget for a request that should not outlive its client. */
function withTimeout(promise, ms, message = 'Timed out') {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    if (typeof timer.unref === 'function') timer.unref();
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

module.exports = { createQueue, createRateLimiter, QueueFullError, CancelledError, withTimeout };
