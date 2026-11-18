import type { Scheduler } from '../src/core';

/** 手動推進的排程器：frame(ms) 模擬經過一幀 */
export function fakeScheduler() {
  let now = 0;
  let pending: ((t: number) => void) | null = null;
  const scheduler: Scheduler = {
    request(cb) {
      pending = cb;
      return 1;
    },
    cancel() {
      pending = null;
    },
    now: () => now,
  };
  return {
    scheduler,
    get pending() {
      return pending;
    },
    advance(ms: number) {
      now += ms;
    },
    frame(ms: number) {
      now += ms;
      const cb = pending;
      if (!cb) throw new Error('沒有排定的下一幀');
      pending = null;
      cb(now);
    },
  };
}
