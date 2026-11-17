/**
 * Running Speed and Cadence Service (RSC, 0x1814): footpods. Pure parsing
 * and encoding of RSC Measurement (0x2A53), from the Bluetooth RSC 1.0
 * specification.
 *
 * Footpods that report running power (Stryd, for example) do it over the
 * Cycling Power Service, which `cps.ts` already parses.
 */

export const RSC_SERVICE = 0x1814;
export const RSC_MEASUREMENT = 0x2a53;

export interface RscMeasurement {
  /** m/s */
  speed: number;
  /** Steps per minute. */
  cadence: number;
  /** metres, when reported */
  strideLength?: number;
  /** metres, when reported */
  totalDistance?: number;
  /** True when the sensor says the wearer is running rather than walking (if it says). */
  running?: boolean;
}

/**
 * Parse an RSC Measurement notification. Speed is uint16 in 1/256 m/s,
 * cadence uint8 in steps per minute, stride length uint16 in centimetres,
 * total distance uint32 in decimetres.
 *
 * The specification says "per minute" without saying steps or strides. Most
 * footpods send steps (160 to 190 when running); a few send strides (80 to
 * 95). Values under 120 while running are doubled, so both read as steps.
 */
export function parseRscMeasurement(input: Uint8Array | DataView): RscMeasurement {
  const v = input instanceof DataView ? input : new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (v.byteLength < 4) throw new Error('RSC Measurement packet too short');
  const flags = v.getUint8(0);
  const speed = v.getUint16(1, true) / 256;
  let cadence = v.getUint8(3);
  let o = 4;
  const out: RscMeasurement = { speed, cadence };
  if (flags & 0x01 && o + 2 <= v.byteLength) { out.strideLength = v.getUint16(o, true) / 100; o += 2; }
  if (flags & 0x02 && o + 4 <= v.byteLength) { out.totalDistance = v.getUint32(o, true) / 10; }
  // Bit 2 is the walking (0) or running (1) status, and only means something when the feature is supported; report it as given.
  out.running = (flags & 0x04) !== 0;
  if (speed > 2.2 && cadence > 0 && cadence < 120) cadence *= 2; // strides, not steps
  out.cadence = cadence;
  return out;
}

export function encodeRscMeasurement(m: RscMeasurement): Uint8Array {
  let flags = 0;
  const b: number[] = [0];
  const sp = Math.max(0, Math.min(65535, Math.round(m.speed * 256)));
  b.push(sp & 0xff, sp >> 8, Math.max(0, Math.min(255, Math.round(m.cadence))));
  if (m.strideLength !== undefined) {
    flags |= 0x01;
    const n = Math.round(m.strideLength * 100);
    b.push(n & 0xff, n >> 8);
  }
  if (m.totalDistance !== undefined) {
    flags |= 0x02;
    const n = Math.max(0, Math.round(m.totalDistance * 10)) >>> 0;
    b.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  }
  if (m.running) flags |= 0x04;
  b[0] = flags;
  return new Uint8Array(b);
}
