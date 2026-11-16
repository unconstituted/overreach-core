import { fitCrc } from './crc';
import { BaseType, baseTypeSize } from './types';

export interface FieldSpec {
  num: number;
  type: number;
  /** Total size in bytes. Required for strings; defaults to one element otherwise. */
  size?: number;
}

function encodeUtf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

function invalidValue(type: number): number {
  switch (type & 0x1f) {
    case 0x00: case 0x02: case 0x0d: return 0xff;
    case 0x01: return 0x7f;
    case 0x03: return 0x7fff;
    case 0x04: return 0xffff;
    case 0x05: return 0x7fffffff;
    case 0x06: return 0xffffffff;
    default: return 0;
  }
}

/**
 * Minimal FIT writer: little-endian, 14-byte header with header CRC, normal
 * record headers only. Define a local message type, then write data messages
 * for it. `finish()` returns the complete file including the trailing CRC.
 */
export class FitWriter {
  private buf: number[] = [];
  private defs = new Map<number, FieldSpec[]>();

  define(local: number, global: number, fields: FieldSpec[]): void {
    if (local < 0 || local > 15) throw new Error('Local message type must be 0 to 15');
    this.buf.push(0x40 | local, 0, 0, global & 0xff, (global >> 8) & 0xff, fields.length);
    for (const f of fields) {
      const size = f.size ?? baseTypeSize(f.type);
      this.buf.push(f.num, size, f.type);
    }
    this.defs.set(local, fields);
  }

  /** Write one data message. `undefined` values are written as the type's invalid value. */
  write(local: number, values: (number | string | undefined)[]): void {
    const fields = this.defs.get(local);
    if (!fields) throw new Error(`Local message type ${local} is not defined`);
    if (values.length !== fields.length) throw new Error('Value count does not match the definition');
    this.buf.push(local);
    fields.forEach((f, i) => {
      const v = values[i];
      const size = f.size ?? baseTypeSize(f.type);
      if (f.type === BaseType.string) {
        const bytes = typeof v === 'string' ? encodeUtf8(v).slice(0, size - 1) : [];
        for (let k = 0; k < size; k++) this.buf.push(k < bytes.length ? bytes[k] : 0);
        return;
      }
      let n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : invalidValue(f.type);
      if (n < 0) n = n + 2 ** (size * 8); // two's complement
      for (let k = 0; k < size; k++) {
        this.buf.push(Math.floor(n / 2 ** (8 * k)) & 0xff);
      }
    });
  }

  finish(profileVersion = 2132, protocolVersion = 0x20): Uint8Array {
    const dataSize = this.buf.length;
    const out = new Uint8Array(14 + dataSize + 2);
    out[0] = 14;
    out[1] = protocolVersion;
    out[2] = profileVersion & 0xff;
    out[3] = (profileVersion >> 8) & 0xff;
    out[4] = dataSize & 0xff;
    out[5] = (dataSize >> 8) & 0xff;
    out[6] = (dataSize >> 16) & 0xff;
    out[7] = (dataSize >> 24) & 0xff;
    out[8] = 0x2e; out[9] = 0x46; out[10] = 0x49; out[11] = 0x54; // ".FIT"
    const hcrc = fitCrc(out, 0, 12);
    out[12] = hcrc & 0xff;
    out[13] = hcrc >> 8;
    out.set(this.buf, 14);
    const crc = fitCrc(out, 0, 14 + dataSize);
    out[14 + dataSize] = crc & 0xff;
    out[15 + dataSize] = crc >> 8;
    return out;
  }
}
