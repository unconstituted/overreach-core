/**
 * A simple flat-road bike model: the "realistic" speed written to FIT files so
 * distance looks sensible on Strava and Garmin Connect. The game speed is a
 * separate, far more dramatic number.
 */
export interface BikeParams {
  /** Rider plus bike, kg. */
  mass: number;
  /** Drag area, m^2. */
  cda: number;
  /** Rolling resistance coefficient. */
  crr: number;
  /** Air density, kg/m^3. */
  rho: number;
  /** Drivetrain efficiency, 0 to 1. */
  efficiency: number;
  /** Road grade as a fraction (0.05 = 5%). */
  grade: number;
}

export const DEFAULT_BIKE: BikeParams = { mass: 83, cda: 0.32, crr: 0.004, rho: 1.225, efficiency: 0.975, grade: 0 };

const G = 9.80665;

/** Advance bike speed (m/s) by `dt` seconds at a given power. Semi-implicit, stable at 1 s steps. */
export function stepBikeSpeed(v: number, powerWatts: number, dt: number, p: BikeParams = DEFAULT_BIKE): number {
  const sub = Math.max(1, Math.ceil(dt / 0.25));
  const h = dt / sub;
  let speed = Math.max(0, v);
  for (let i = 0; i < sub; i++) {
    // Kinetic-energy form avoids the divide-by-zero in F = P / v at standstill.
    const drag = 0.5 * p.rho * p.cda * speed * speed * speed;
    const roll = (p.crr * Math.cos(Math.atan(p.grade)) + Math.sin(Math.atan(p.grade))) * p.mass * G * speed;
    const net = Math.max(0, powerWatts) * p.efficiency - drag - roll;
    const ke = Math.max(0, 0.5 * p.mass * speed * speed + net * h);
    speed = Math.sqrt((2 * ke) / p.mass);
  }
  return speed;
}

/** Steady-state speed (m/s) for a given power, by bisection. */
export function steadyBikeSpeed(powerWatts: number, p: BikeParams = DEFAULT_BIKE): number {
  if (powerWatts <= 0) return 0;
  const need = (v: number) =>
    0.5 * p.rho * p.cda * v * v * v + (p.crr * Math.cos(Math.atan(p.grade)) + Math.sin(Math.atan(p.grade))) * p.mass * G * v;
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (need(mid) < powerWatts * p.efficiency) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
