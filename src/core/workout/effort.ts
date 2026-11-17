/**
 * Effort: one scale for cycling and running.
 *
 * The feel layer, the world's speed response and the simulated heart all
 * think in "fraction of FTP". Running is described by pace, and running speed
 * rises far more slowly than cycling power for the same effort. This module
 * maps between the two, so a runner at threshold pace feels exactly like a
 * rider at FTP, and everything downstream is shared.
 *
 *  pace fraction (of threshold speed)   effort (FTP-equivalent)
 *            0.00                             0.00  (standing)
 *            0.80                             0.50  (easy running)
 *            1.00                             1.00  (threshold)
 *            1.08                             1.20  (VO2)
 *            1.20                             1.50
 *
 * Below 0.8 the scale is linear to zero, which covers walking. Above it, each
 * 1% of threshold speed is worth 2.5% of FTP.
 */

/** Pace fraction gained per unit of effort above the easy-running knee. */
export const RUN_PACE_PER_EFFORT = 0.4;
const KNEE_PACE = 0.8;
const KNEE_EFFORT = 1 - (1 - KNEE_PACE) / RUN_PACE_PER_EFFORT; // 0.5

/** Running pace (fraction of threshold speed) to an FTP-equivalent effort. */
export function paceToEffort(paceFraction: number): number {
  const f = Math.max(0, paceFraction);
  return f >= KNEE_PACE ? 1 + (f - 1) / RUN_PACE_PER_EFFORT : (f / KNEE_PACE) * KNEE_EFFORT;
}

/** FTP-equivalent effort to a running pace (fraction of threshold speed). The inverse of `paceToEffort`. */
export function effortToPace(effort: number): number {
  const e = Math.max(0, effort);
  return e >= KNEE_EFFORT ? 1 + RUN_PACE_PER_EFFORT * (e - 1) : (e / KNEE_EFFORT) * KNEE_PACE;
}

/**
 * Extra effort per percent of treadmill incline. Roughly: each 1% of grade
 * costs about as much as running 3.5% faster on the flat.
 */
export const INCLINE_PACE_PER_PERCENT = 0.035;

/**
 * Effort of running at `speed` (m/s) up `inclinePercent`, for a runner whose
 * threshold speed is `thresholdSpeed`. Downhill is treated as flat.
 */
export function runEffort(speed: number, inclinePercent: number, thresholdSpeed: number): number {
  if (!(thresholdSpeed > 0) || !(speed > 0)) return 0;
  const flatEquivalent = (speed / thresholdSpeed) * (1 + INCLINE_PACE_PER_PERCENT * Math.max(0, inclinePercent));
  return paceToEffort(flatEquivalent);
}

/** Threshold heart rate as a fraction of maximum: a heart-rate target this high is "at FTP". */
export const THRESHOLD_HR_FRACTION = 0.9;

/** A heart-rate fraction (of maximum) to an FTP-equivalent effort. Coarse, but heart rate is coarse. */
export function hrToEffort(hrFraction: number): number {
  // 60% of max is easy (about 50% FTP); threshold heart rate is threshold effort.
  const f = Math.max(0, hrFraction);
  const easy = 0.6;
  if (f <= easy) return (f / easy) * 0.5;
  return 0.5 + ((f - easy) / (THRESHOLD_HR_FRACTION - easy)) * 0.5;
}
