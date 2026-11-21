/**
 * Screens refresh themselves every few seconds. A tab nobody is looking at does not need that:
 * while it is hidden, the refreshes are skipped, so the server only works for what is on screen.
 * Short timers (under 4 seconds, such as animations) and clocks are left alone.
 */
let done = false;
export function pauseRefreshWhenHidden() {
  if (done || typeof window === 'undefined') return;
  done = true;
  const original = window.setInterval.bind(window);
  window.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (typeof handler !== 'function' || !ms || ms < 4000) return original(handler, ms, ...args);
    return original(((...a: unknown[]) => { if (!document.hidden) (handler as (...x: unknown[]) => void)(...a); }) as TimerHandler, ms, ...args);
  }) as typeof window.setInterval;
}
