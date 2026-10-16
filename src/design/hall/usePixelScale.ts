// DS-H-01 red-first stub: the naive scale, not yet whole device pixels.
export const pixelScale = (dpr: number, target = 2) => ({ device: target * dpr, css: target });
export const usePixelScale = (target = 2) => pixelScale(window.devicePixelRatio, target);
