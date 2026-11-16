/**
 * Fitness Machine Service (FTMS, 0x1826): pure packet parsing and encoding,
 * written from the Bluetooth FTMS 1.0 specification. No Bluetooth access here.
 */

export const FTMS_SERVICE = 0x1826;
export const FTMS_FEATURE = 0x2acc;
export const FTMS_INDOOR_BIKE_DATA = 0x2ad2;
export const FTMS_SUPPORTED_POWER_RANGE = 0x2ad8;
export const FTMS_CONTROL_POINT = 0x2ad9;
export const FTMS_STATUS = 0x2ada;

export interface IndoorBikeData {
  /** km/h */
  speedKmh?: number;
  avgSpeedKmh?: number;
  /** rpm */
  cadence?: number;
  avgCadence?: number;
  /** metres */
  totalDistance?: number;
  resistanceLevel?: number;
  /** watts */
  power?: number;
  avgPower?: number;
  totalEnergyKcal?: number;
  energyPerHourKcal?: number;
  energyPerMinuteKcal?: number;
  heartRate?: number;
  metabolicEquivalent?: number;
  /** seconds */
  elapsedTime?: number;
  remainingTime?: number;
}

function view(bytes: Uint8Array | DataView): DataView {
  return bytes instanceof DataView ? bytes : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Parse an Indoor Bike Data (0x2AD2) notification. */
export function parseIndoorBikeData(input: Uint8Array | DataView): IndoorBikeData {
  const v = view(input);
  if (v.byteLength < 2) throw new Error('Indoor Bike Data packet too short');
  const flags = v.getUint16(0, true);
  let o = 2;
  const out: IndoorBikeData = {};
  const has = (n: number) => o + n <= v.byteLength;
  // Bit 0 is "More Data": instantaneous speed is present when it is CLEAR.
  if (!(flags & 0x0001) && has(2)) { out.speedKmh = v.getUint16(o, true) / 100; o += 2; }
  if (flags & 0x0002 && has(2)) { out.avgSpeedKmh = v.getUint16(o, true) / 100; o += 2; }
  if (flags & 0x0004 && has(2)) { out.cadence = v.getUint16(o, true) / 2; o += 2; }
  if (flags & 0x0008 && has(2)) { out.avgCadence = v.getUint16(o, true) / 2; o += 2; }
  if (flags & 0x0010 && has(3)) { out.totalDistance = v.getUint16(o, true) | (v.getUint8(o + 2) << 16); o += 3; }
  if (flags & 0x0020 && has(2)) { out.resistanceLevel = v.getInt16(o, true); o += 2; }
  if (flags & 0x0040 && has(2)) { out.power = v.getInt16(o, true); o += 2; }
  if (flags & 0x0080 && has(2)) { out.avgPower = v.getInt16(o, true); o += 2; }
  if (flags & 0x0100 && has(5)) {
    const total = v.getUint16(o, true);
    const perHour = v.getUint16(o + 2, true);
    const perMin = v.getUint8(o + 4);
    if (total !== 0xffff) out.totalEnergyKcal = total;
    if (perHour !== 0xffff) out.energyPerHourKcal = perHour;
    if (perMin !== 0xff) out.energyPerMinuteKcal = perMin;
    o += 5;
  }
  if (flags & 0x0200 && has(1)) { out.heartRate = v.getUint8(o); o += 1; }
  if (flags & 0x0400 && has(1)) { out.metabolicEquivalent = v.getUint8(o) / 10; o += 1; }
  if (flags & 0x0800 && has(2)) { out.elapsedTime = v.getUint16(o, true); o += 2; }
  if (flags & 0x1000 && has(2)) { out.remainingTime = v.getUint16(o, true); o += 2; }
  return out;
}

/** Encode Indoor Bike Data, as a trainer would send it. Used by the simulated trainer. */
export function encodeIndoorBikeData(d: IndoorBikeData): Uint8Array {
  const b: number[] = [0, 0];
  let flags = 0;
  const u16 = (x: number) => { const n = Math.max(0, Math.min(0xffff, Math.round(x))); b.push(n & 0xff, n >> 8); };
  const s16 = (x: number) => { let n = Math.max(-32768, Math.min(32767, Math.round(x))); if (n < 0) n += 65536; b.push(n & 0xff, n >> 8); };
  if (d.speedKmh !== undefined) u16(d.speedKmh * 100); else flags |= 0x0001;
  if (d.avgSpeedKmh !== undefined) { flags |= 0x0002; u16(d.avgSpeedKmh * 100); }
  if (d.cadence !== undefined) { flags |= 0x0004; u16(d.cadence * 2); }
  if (d.avgCadence !== undefined) { flags |= 0x0008; u16(d.avgCadence * 2); }
  if (d.totalDistance !== undefined) {
    flags |= 0x0010;
    const n = Math.max(0, Math.min(0xffffff, Math.round(d.totalDistance)));
    b.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff);
  }
  if (d.resistanceLevel !== undefined) { flags |= 0x0020; s16(d.resistanceLevel); }
  if (d.power !== undefined) { flags |= 0x0040; s16(d.power); }
  if (d.avgPower !== undefined) { flags |= 0x0080; s16(d.avgPower); }
  if (d.totalEnergyKcal !== undefined) {
    flags |= 0x0100;
    u16(d.totalEnergyKcal); u16(d.energyPerHourKcal ?? 0xffff); b.push(d.energyPerMinuteKcal ?? 0xff);
  }
  if (d.heartRate !== undefined) { flags |= 0x0200; b.push(Math.round(d.heartRate) & 0xff); }
  if (d.metabolicEquivalent !== undefined) { flags |= 0x0400; b.push(Math.round(d.metabolicEquivalent * 10) & 0xff); }
  if (d.elapsedTime !== undefined) { flags |= 0x0800; u16(d.elapsedTime); }
  if (d.remainingTime !== undefined) { flags |= 0x1000; u16(d.remainingTime); }
  b[0] = flags & 0xff;
  b[1] = flags >> 8;
  return new Uint8Array(b);
}

/* ---------- Control Point (0x2AD9) ---------- */

export const FtmsOp = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetResistance: 0x04,
  setTargetPower: 0x05,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  setIndoorBikeSimulation: 0x11,
  response: 0x80,
} as const;

export const FtmsResult = {
  success: 0x01,
  opCodeNotSupported: 0x02,
  invalidParameter: 0x03,
  operationFailed: 0x04,
  controlNotPermitted: 0x05,
} as const;

const RESULT_TEXT: Record<number, string> = {
  1: 'success', 2: 'op code not supported', 3: 'invalid parameter', 4: 'operation failed', 5: 'control not permitted',
};

function s16le(x: number): [number, number] {
  let n = Math.max(-32768, Math.min(32767, Math.round(x)));
  if (n < 0) n += 65536;
  return [n & 0xff, n >> 8];
}

export function encodeRequestControl(): Uint8Array {
  return new Uint8Array([FtmsOp.requestControl]);
}
export function encodeReset(): Uint8Array {
  return new Uint8Array([FtmsOp.reset]);
}
export function encodeStart(): Uint8Array {
  return new Uint8Array([FtmsOp.startOrResume]);
}
export function encodeStop(pause = false): Uint8Array {
  return new Uint8Array([FtmsOp.stopOrPause, pause ? 0x02 : 0x01]);
}
/** Target power in watts (sint16, resolution 1 W). */
export function encodeSetTargetPower(watts: number): Uint8Array {
  return new Uint8Array([FtmsOp.setTargetPower, ...s16le(watts)]);
}
/** Target resistance level (uint8, resolution 0.1). */
export function encodeSetTargetResistance(level: number): Uint8Array {
  return new Uint8Array([FtmsOp.setTargetResistance, Math.max(0, Math.min(255, Math.round(level * 10)))]);
}
/**
 * Indoor bike simulation parameters: wind speed (sint16, 0.001 m/s), grade
 * (sint16, 0.01 %), rolling resistance (uint8, 0.0001), wind resistance (uint8, 0.01 kg/m).
 */
export function encodeSetSimulation(p: { grade: number; windSpeed?: number; crr?: number; cw?: number }): Uint8Array {
  return new Uint8Array([
    FtmsOp.setIndoorBikeSimulation,
    ...s16le((p.windSpeed ?? 0) * 1000),
    ...s16le(p.grade * 100),
    Math.max(0, Math.min(255, Math.round((p.crr ?? 0.004) * 10000))),
    Math.max(0, Math.min(255, Math.round((p.cw ?? 0.51) * 100))),
  ]);
}

export type ControlPointCommand =
  | { op: 'requestControl' } | { op: 'reset' } | { op: 'start' } | { op: 'stop'; pause: boolean }
  | { op: 'setTargetPower'; watts: number } | { op: 'setTargetResistance'; level: number }
  | { op: 'setSimulation'; windSpeed: number; grade: number; crr: number; cw: number }
  | { op: 'unknown'; code: number };

/** Parse a control point write, as a trainer would. Used by the simulated trainer and by tests. */
export function parseControlPointCommand(input: Uint8Array | DataView): ControlPointCommand {
  const v = view(input);
  const code = v.getUint8(0);
  switch (code) {
    case FtmsOp.requestControl: return { op: 'requestControl' };
    case FtmsOp.reset: return { op: 'reset' };
    case FtmsOp.startOrResume: return { op: 'start' };
    case FtmsOp.stopOrPause: return { op: 'stop', pause: v.byteLength > 1 && v.getUint8(1) === 0x02 };
    case FtmsOp.setTargetPower:
      if (v.byteLength < 3) break;
      return { op: 'setTargetPower', watts: v.getInt16(1, true) };
    case FtmsOp.setTargetResistance:
      if (v.byteLength < 2) break;
      return { op: 'setTargetResistance', level: v.getUint8(1) / 10 };
    case FtmsOp.setIndoorBikeSimulation:
      if (v.byteLength < 7) break;
      return {
        op: 'setSimulation', windSpeed: v.getInt16(1, true) / 1000, grade: v.getInt16(3, true) / 100,
        crr: v.getUint8(5) / 10000, cw: v.getUint8(6) / 100,
      };
  }
  return { op: 'unknown', code };
}

export interface ControlPointResponse {
  requestOp: number;
  result: number;
  ok: boolean;
  text: string;
}

/** Parse a control point indication (0x80, request op code, result code). */
export function parseControlPointResponse(input: Uint8Array | DataView): ControlPointResponse | undefined {
  const v = view(input);
  if (v.byteLength < 3 || v.getUint8(0) !== FtmsOp.response) return undefined;
  const result = v.getUint8(2);
  return { requestOp: v.getUint8(1), result, ok: result === FtmsResult.success, text: RESULT_TEXT[result] ?? `result ${result}` };
}

export function encodeControlPointResponse(requestOp: number, result: number): Uint8Array {
  return new Uint8Array([FtmsOp.response, requestOp, result]);
}

/* ---------- Fitness Machine Status (0x2ADA) ---------- */

export type MachineStatus =
  | { kind: 'reset' } | { kind: 'stopped' } | { kind: 'paused' } | { kind: 'stoppedBySafetyKey' } | { kind: 'started' }
  | { kind: 'targetPowerChanged'; watts: number } | { kind: 'targetResistanceChanged'; level: number }
  | { kind: 'simulationChanged'; windSpeed: number; grade: number; crr: number; cw: number }
  | { kind: 'controlPermissionLost' } | { kind: 'other'; code: number };

export function parseMachineStatus(input: Uint8Array | DataView): MachineStatus {
  const v = view(input);
  const code = v.getUint8(0);
  switch (code) {
    case 0x01: return { kind: 'reset' };
    case 0x02: return v.byteLength > 1 && v.getUint8(1) === 0x02 ? { kind: 'paused' } : { kind: 'stopped' };
    case 0x03: return { kind: 'stoppedBySafetyKey' };
    case 0x04: return { kind: 'started' };
    case 0x07: if (v.byteLength >= 2) return { kind: 'targetResistanceChanged', level: v.getUint8(1) / 10 }; break;
    case 0x08: if (v.byteLength >= 3) return { kind: 'targetPowerChanged', watts: v.getInt16(1, true) }; break;
    case 0x12:
      if (v.byteLength >= 7) {
        return {
          kind: 'simulationChanged', windSpeed: v.getInt16(1, true) / 1000, grade: v.getInt16(3, true) / 100,
          crr: v.getUint8(5) / 10000, cw: v.getUint8(6) / 100,
        };
      }
      break;
    case 0xff: return { kind: 'controlPermissionLost' };
  }
  return { kind: 'other', code };
}

export function encodeStatusTargetPower(watts: number): Uint8Array {
  return new Uint8Array([0x08, ...s16le(watts)]);
}

/* ---------- Supported Power Range (0x2AD8) ---------- */

export interface PowerRange { min: number; max: number; increment: number }

export function parseSupportedPowerRange(input: Uint8Array | DataView): PowerRange | undefined {
  const v = view(input);
  if (v.byteLength < 6) return undefined;
  return { min: v.getInt16(0, true), max: v.getInt16(2, true), increment: v.getUint16(4, true) };
}

/* ---------- Fitness Machine Feature (0x2ACC) ---------- */

export interface MachineFeatures {
  cadence: boolean;
  powerMeasurement: boolean;
  powerTarget: boolean;
  resistanceTarget: boolean;
  simulation: boolean;
}

export function parseMachineFeatures(input: Uint8Array | DataView): MachineFeatures | undefined {
  const v = view(input);
  if (v.byteLength < 8) return undefined;
  const features = v.getUint32(0, true);
  const targets = v.getUint32(4, true);
  return {
    cadence: (features & (1 << 1)) !== 0,
    powerMeasurement: (features & (1 << 14)) !== 0,
    resistanceTarget: (targets & (1 << 2)) !== 0,
    powerTarget: (targets & (1 << 3)) !== 0,
    simulation: (targets & (1 << 13)) !== 0,
  };
}
