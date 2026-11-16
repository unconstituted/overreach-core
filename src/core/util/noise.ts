/** Cheap deterministic hashes and value noise, shared by scene kits and effects. */
export const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export const hash2 = (a: number, b: number): number => hash(a * 57.31 + b * 113.7 + 0.5);
/** Smooth 1D value noise in [-1, 1]. */
export const noise1 = (x: number): number => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i) + (hash(i + 1) - hash(i)) * u) * 2 - 1;
};
