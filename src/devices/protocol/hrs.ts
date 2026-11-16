/** Heart Rate Service (0x180D): pure parsing of Heart Rate Measurement (0x2A37). */

export const HRS_SERVICE = 0x180d;
export const HRS_MEASUREMENT = 0x2a37;

export interface HeartRateMeasurement {
  bpm: number;
  /** Undefined when the sensor does not support contact detection. */
  contact?: boolean;
  /** Kilojoules, when reported. */
  energyExpended?: number;
  /** RR intervals in seconds. */
  rr: number[];
}

export function parseHeartRateMeasurement(input: Uint8Array | DataView): HeartRateMeasurement {
  const v = input instanceof DataView ? input : new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (v.byteLength < 2) throw new Error('Heart Rate Measurement packet too short');
  const flags = v.getUint8(0);
  let o = 1;
  let bpm: number;
  if (flags & 0x01) { bpm = v.getUint16(o, true); o += 2; }
  else { bpm = v.getUint8(o); o += 1; }
  const out: HeartRateMeasurement = { bpm, rr: [] };
  // Bit 2 = contact detection supported; bit 1 = contact detected.
  if (flags & 0x04) out.contact = (flags & 0x02) !== 0;
  if (flags & 0x08 && o + 2 <= v.byteLength) { out.energyExpended = v.getUint16(o, true); o += 2; }
  if (flags & 0x10) {
    while (o + 2 <= v.byteLength) {
      out.rr.push(v.getUint16(o, true) / 1024);
      o += 2;
    }
  }
  return out;
}

export function encodeHeartRateMeasurement(m: { bpm: number; contact?: boolean; rr?: number[] }): Uint8Array {
  const b: number[] = [0];
  let flags = 0;
  const bpm = Math.max(0, Math.round(m.bpm));
  if (bpm > 255) { flags |= 0x01; b.push(bpm & 0xff, bpm >> 8); }
  else b.push(bpm);
  if (m.contact !== undefined) flags |= 0x04 | (m.contact ? 0x02 : 0);
  if (m.rr && m.rr.length) {
    flags |= 0x10;
    for (const r of m.rr) {
      const n = Math.max(0, Math.min(0xffff, Math.round(r * 1024)));
      b.push(n & 0xff, n >> 8);
    }
  }
  b[0] = flags;
  return new Uint8Array(b);
}
