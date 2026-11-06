 /**
  * Shared motion helpers so every surface transitions the same way.
  * Micro-transitions: short exits, slightly longer entrances.
  */

/** True the first time the app shell paints in this browser session. */
let firstPaint = true;
export function firstAppPaint(): boolean {
  const first = firstPaint;
  firstPaint = false;
  return first;
}

/** The user asked the system for reduced motion. */
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
