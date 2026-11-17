/**
 * FTMS for treadmills: pure packet parsing and encoding, written from the
 * Bluetooth Fitness Machine Service 1.0 specification. The service, control
 * point, status and feature characteristics are shared with bikes (see
 * `ftms.ts`); this file adds what is treadmill-specific.
 */

export const FTMS_TREADMILL_DATA = 0x2acd;
export const FTMS_SUPPORTED_SPEED_RANGE = 0x2ad4;
export const FTMS_SUPPORTED_INCLINATION_RANGE = 0x2ad5;

/** Control point op codes used for treadmills (request control, reset, start and stop are in `ftms.ts`). */
export const TreadmillOp = {
  setTargetSpeed: 0x02,
  setTargetInclination: 0x03,
} as const;

export interface TreadmillData {
  /** km/h */
  speedKmh?: number;
  avgSpeedKmh?: number;
  /** metres */
  totalDistance?: number;
  /** percent */
  inclination?: number;
  /** degrees */
  rampAngle?: number;
  /** metres */
  elevationGainPositive?: number;
  elevationGainNegative?: number;
  /** km per minute, as the spec defines it (so 0.2 km/min is 12 km/h). */
  pace?: number;
  avgPace?: number;
  totalEnergyKcal?: number;
  energyPerHourKcal?: number;
  energyPerMinuteKcal?: number;
  heartRate?: number;
  metabolicEquivalent?: number;
  /** seconds */
  elapsedTime?: number;
  remainingTime?: number;
  /** newtons */
  forceOnBelt?: number;
  /** watts */
  power?: number;
}

function view(bytes: Uint8Array | DataView): DataView {
  return bytes instanceof DataView ? bytes : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u24(v: DataView, o: number): number {
  return v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16);
}

/**
 * Parse a Treadmill Data (0x2ACD) notification. As with Indoor Bike Data,
 * flag bit 0 is "more data": when it is clear, instantaneous speed is present.
 * A treadmill may split one reading over several packets; merge them.
 *
 * Instantaneous and average pace are read as uint8 in units of 0.1 km/min, as
 * FTMS 1.0 defines them. Some machines are known to get this wrong; nothing in
 * the engine depends on the pace fields, only on speed.
 */
export function parseTreadmillData(input: Uint8Array | DataView): TreadmillData {
  const v = view(input);
  if (v.byteLength < 2) throw new Error('Treadmill Data packet too short');
  const flags = v.getUint16(0, true);
  const out: TreadmillData = {};
  let o = 2;
  const need = (n: number) => o + n <= v.byteLength;
  if (!(flags & 0x0001) && need(2)) { out.speedKmh = v.getUint16(o, true) / 100; o += 2; }
  if (flags & 0x0002 && need(2)) { out.avgSpeedKmh = v.getUint16(o, true) / 100; o += 2; }
  if (flags & 0x0004 && need(3)) { out.totalDistance = u24(v, o); o += 3; }
  if (flags & 0x0008 && need(4)) { out.inclination = v.getInt16(o, true) / 10; out.rampAngle = v.getInt16(o + 2, true) / 10; o += 4; }
  if (flags & 0x0010 && need(4)) { out.elevationGainPositive = v.getUint16(o, true) / 10; out.elevationGainNegative = v.getUint16(o + 2, true) / 10; o += 4; }
  if (flags & 0x0020 && need(1)) { out.pace = v.getUint8(o) / 10; o += 1; }
  if (flags & 0x0040 && need(1)) { out.avgPace = v.getUint8(o) / 10; o += 1; }
  if (flags & 0x0080 && need(5)) {
    out.totalEnergyKcal = v.getUint16(o, true);
    out.energyPerHourKcal = v.getUint16(o + 2, true);
    out.energyPerMinuteKcal = v.getUint8(o + 4);
    o += 5;
  }
  if (flags & 0x0100 && need(1)) { out.heartRate = v.getUint8(o); o += 1; }
  if (flags & 0x0200 && need(1)) { out.metabolicEquivalent = v.getUint8(o) / 10; o += 1; }
  if (flags & 0x0400 && need(2)) { out.elapsedTime = v.getUint16(o, true); o += 2; }
  if (flags & 0x0800 && need(2)) { out.remainingTime = v.getUint16(o, true); o += 2; }
  if (flags & 0x1000 && need(4)) { out.forceOnBelt = v.getInt16(o, true); out.power = v.getInt16(o + 2, true); o += 4; }
  return out;
}

/** Encode Treadmill Data, as a treadmill would send it. Used by the simulator and in tests. */
export function encodeTreadmillData(d: TreadmillData): Uint8Array {
  let flags = 0;
  const b: number[] = [0, 0];
  const u16 = (x: number) => { const n = Math.max(0, Math.min(65535, Math.round(x))); b.push(n & 0xff, n >> 8); };
  const s16 = (x: number) => { let n = Math.max(-32768, Math.min(32767, Math.round(x))); if (n < 0) n += 65536; b.push(n & 0xff, n >> 8); };
  if (d.speedKmh !== undefined) u16(d.speedKmh * 100); else flags |= 0x0001;
  if (d.avgSpeedKmh !== undefined) { flags |= 0x0002; u16(d.avgSpeedKmh * 100); }
  if (d.totalDistance !== undefined) {
    flags |= 0x0004;
    const n = Math.max(0, Math.min(0xffffff, Math.round(d.totalDistance)));
    b.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff);
  }
  if (d.inclination !== undefined) { flags |= 0x0008; s16(d.inclination * 10); s16((d.rampAngle ?? Math.atan(d.inclination / 100) * 180 / Math.PI) * 10); }
  if (d.heartRate !== undefined) { flags |= 0x0100; b.push(Math.max(0, Math.min(255, Math.round(d.heartRate)))); }
  if (d.elapsedTime !== undefined) { flags |= 0x0400; u16(d.elapsedTime); }
  if (d.power !== undefined) { flags |= 0x1000; s16(d.forceOnBelt ?? 0); s16(d.power); }
  b[0] = flags & 0xff;
  b[1] = flags >> 8;
  return new Uint8Array(b);
}

function s16le(x: number): [number, number] {
  let n = Math.max(-32768, Math.min(32767, Math.round(x)));
  if (n < 0) n += 65536;
  return [n & 0xff, n >> 8];
}

/** Target speed in km/h (uint16, resolution 0.01 km/h). */
export function encodeSetTargetSpeed(kmh: number): Uint8Array {
  const n = Math.max(0, Math.min(65535, Math.round(kmh * 100)));
  return new Uint8Array([TreadmillOp.setTargetSpeed, n & 0xff, n >> 8]);
}

/** Target inclination in percent (sint16, resolution 0.1 %). */
export function encodeSetTargetInclination(percent: number): Uint8Array {
  return new Uint8Array([TreadmillOp.setTargetInclination, ...s16le(percent * 10)]);
}

export interface Range { min: number; max: number; increment: number }

/** Supported Speed Range (0x2AD4), in km/h. */
export function parseSupportedSpeedRange(input: Uint8Array | DataView): Range | undefined {
  const v = view(input);
  if (v.byteLength < 6) return undefined;
  return { min: v.getUint16(0, true) / 100, max: v.getUint16(2, true) / 100, increment: v.getUint16(4, true) / 100 };
}

/** Supported Inclination Range (0x2AD5), in percent. */
export function parseSupportedInclinationRange(input: Uint8Array | DataView): Range | undefined {
  const v = view(input);
  if (v.byteLength < 6) return undefined;
  return { min: v.getInt16(0, true) / 10, max: v.getInt16(2, true) / 10, increment: v.getUint16(4, true) / 10 };
}

export function encodeSupportedSpeedRange(r: Range): Uint8Array {
  const u = (x: number) => { const n = Math.round(x * 100); return [n & 0xff, n >> 8]; };
  return new Uint8Array([...u(r.min), ...u(r.max), ...u(r.increment)]);
}
