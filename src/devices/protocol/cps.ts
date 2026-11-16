/**
 * Cycling Power Service (0x1818): pure parsing of Cycling Power Measurement
 * (0x2A63), plus the crank-revolution maths that turns it into cadence.
 */

export const CPS_SERVICE = 0x1818;
export const CPS_MEASUREMENT = 0x2a63;

export interface CyclingPowerMeasurement {
  /** Watts. */
  power: number;
  /** Percent, when reported. */
  pedalBalance?: number;
  accumulatedTorque?: number;
  wheelRevolutions?: number;
  /** Last wheel event time, in 1/2048 s units. */
  wheelEventTime?: number;
  crankRevolutions?: number;
  /** Last crank event time, in 1/1024 s units. */
  crankEventTime?: number;
}

export function parseCyclingPowerMeasurement(input: Uint8Array | DataView): CyclingPowerMeasurement {
  const v = input instanceof DataView ? input : new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (v.byteLength < 4) throw new Error('Cycling Power Measurement packet too short');
  const flags = v.getUint16(0, true);
  const out: CyclingPowerMeasurement = { power: v.getInt16(2, true) };
  let o = 4;
  const has = (n: number) => o + n <= v.byteLength;
  if (flags & 0x0001 && has(1)) { out.pedalBalance = v.getUint8(o) / 2; o += 1; }
  if (flags & 0x0004 && has(2)) { out.accumulatedTorque = v.getUint16(o, true) / 32; o += 2; }
  if (flags & 0x0010 && has(6)) {
    out.wheelRevolutions = v.getUint32(o, true);
    out.wheelEventTime = v.getUint16(o + 4, true);
    o += 6;
  }
  if (flags & 0x0020 && has(4)) {
    out.crankRevolutions = v.getUint16(o, true);
    out.crankEventTime = v.getUint16(o + 2, true);
    o += 4;
  }
  return out;
}

export function encodeCyclingPowerMeasurement(m: CyclingPowerMeasurement): Uint8Array {
  const b: number[] = [0, 0];
  let flags = 0;
  let p = Math.round(m.power);
  if (p < 0) p += 65536;
  b.push(p & 0xff, (p >> 8) & 0xff);
  if (m.crankRevolutions !== undefined && m.crankEventTime !== undefined) {
    flags |= 0x0020;
    b.push(m.crankRevolutions & 0xff, (m.crankRevolutions >> 8) & 0xff, m.crankEventTime & 0xff, (m.crankEventTime >> 8) & 0xff);
  }
  b[0] = flags & 0xff;
  b[1] = flags >> 8;
  return new Uint8Array(b);
}

/**
 * Cadence from successive crank revolution data. Both counters are uint16 and
 * wrap; the event time is in 1/1024 s. When no new revolution arrives the
 * last cadence is held briefly, then drops to zero (the rider has stopped).
 */
export class CrankCadence {
  private lastRevs?: number;
  private lastTime?: number;
  private cadence = 0;
  private stale = 0;

  constructor(private readonly staleLimit = 3) {}

  update(revs: number, eventTime: number): number {
    if (this.lastRevs === undefined || this.lastTime === undefined) {
      this.lastRevs = revs;
      this.lastTime = eventTime;
      return 0;
    }
    const dRevs = (revs - this.lastRevs + 0x10000) & 0xffff;
    const dTime = (eventTime - this.lastTime + 0x10000) & 0xffff;
    if (dRevs === 0 || dTime === 0) {
      // No new crank event in this packet.
      if (++this.stale >= this.staleLimit) this.cadence = 0;
      return this.cadence;
    }
    this.stale = 0;
    this.lastRevs = revs;
    this.lastTime = eventTime;
    const rpm = (dRevs / (dTime / 1024)) * 60;
    // Reject impossible values from a counter reset or a corrupt packet.
    if (rpm > 0 && rpm < 250) this.cadence = rpm;
    return this.cadence;
  }

  reset(): void {
    this.lastRevs = undefined;
    this.lastTime = undefined;
    this.cadence = 0;
    this.stale = 0;
  }
}
