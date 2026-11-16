export const clamp = (x: number, lo = 0, hi = 1): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
export const smoothstep = (a: number, b: number, x: number): number => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
/** Frame-rate independent exponential approach factor: the fraction of the gap closed in `dt` at time constant `tau`. */
export const approach = (dt: number, tau: number): number => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
