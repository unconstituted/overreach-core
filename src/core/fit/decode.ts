import { fitCrc } from './crc';
import { baseTypeSize, type FitFile, type FitMessage, type FitValue } from './types';

interface FieldDef { num: number; size: number; baseType: number }
interface MesgDef { global: number; littleEndian: boolean; fields: FieldDef[]; devBytes: number }

export class FitDecodeError extends Error {}

function isInvalid(base: number, v: number): boolean {
  switch (base & 0x1f) {
    case 0x00: case 0x02: case 0x0d: return v === 0xff;
    case 0x01: return v === 0x7f;
    case 0x03: return v === 0x7fff;
    case 0x04: return v === 0xffff;
    case 0x05: return v === 0x7fffffff;
    case 0x06: return v === 0xffffffff;
    case 0x0a: case 0x0b: case 0x0c: return v === 0;
    case 0x08: case 0x09: return Number.isNaN(v);
    default: return false;
  }
}

function readOne(view: DataView, off: number, base: number, le: boolean): number {
  switch (base & 0x1f) {
    case 0x01: return view.getInt8(off);
    case 0x03: return view.getInt16(off, le);
    case 0x04: case 0x0b: return view.getUint16(off, le);
    case 0x05: return view.getInt32(off, le);
    case 0x06: case 0x0c: return view.getUint32(off, le);
    case 0x08: return view.getFloat32(off, le);
    case 0x09: return view.getFloat64(off, le);
    case 0x0e: return Number(view.getBigInt64(off, le));
    case 0x0f: case 0x10: return Number(view.getBigUint64(off, le));
    default: return view.getUint8(off);
  }
}

function decodeString(bytes: Uint8Array, off: number, size: number): string | undefined {
  let end = off;
  while (end < off + size && bytes[end] !== 0) end++;
  if (end === off) return undefined;
  // UTF-8 decode without TextDecoder so the core stays free of host APIs.
  let out = '';
  let i = off;
  while (i < end) {
    const b = bytes[i++];
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i] & 0x3f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i] & 0x3f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

/**
 * Decode a FIT file into raw messages. Values are raw (no scale/offset); the
 * caller applies the profile. Developer fields are skipped. Compressed
 * timestamp headers are supported (the timestamp is written to field 253).
 */
export function decodeFit(bytes: Uint8Array): FitFile {
  if (bytes.length < 14) throw new FitDecodeError('File too short to be FIT');
  const headerSize = bytes[0];
  if (headerSize !== 12 && headerSize !== 14) throw new FitDecodeError(`Unexpected header size ${headerSize}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sig = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (sig !== '.FIT') throw new FitDecodeError('Missing .FIT signature');
  const protocolVersion = bytes[1];
  const profileVersion = view.getUint16(2, true);
  const dataSize = view.getUint32(4, true);
  const dataEnd = headerSize + dataSize;
  if (dataEnd + 2 > bytes.length) throw new FitDecodeError('File is truncated');

  const fileCrc = view.getUint16(dataEnd, true);
  let crcOk = fitCrc(bytes, 0, dataEnd) === fileCrc;
  if (headerSize === 14) {
    const headerCrc = view.getUint16(12, true);
    if (headerCrc !== 0 && headerCrc !== fitCrc(bytes, 0, 12)) crcOk = false;
  }

  const defs = new Map<number, MesgDef>();
  const messages: FitMessage[] = [];
  let lastTimestamp = 0;
  let off = headerSize;

  while (off < dataEnd) {
    const head = bytes[off++];
    const compressed = (head & 0x80) !== 0;
    if (!compressed && (head & 0x40)) {
      // Definition message.
      const local = head & 0x0f;
      const hasDev = (head & 0x20) !== 0;
      off++; // reserved
      const littleEndian = bytes[off++] === 0;
      const global = view.getUint16(off, littleEndian);
      off += 2;
      const n = bytes[off++];
      const fields: FieldDef[] = [];
      for (let i = 0; i < n; i++) {
        fields.push({ num: bytes[off], size: bytes[off + 1], baseType: bytes[off + 2] });
        off += 3;
      }
      let devBytes = 0;
      if (hasDev) {
        const nd = bytes[off++];
        for (let i = 0; i < nd; i++) {
          devBytes += bytes[off + 1];
          off += 3;
        }
      }
      defs.set(local, { global, littleEndian, fields, devBytes });
      continue;
    }

    const local = compressed ? (head >> 5) & 0x03 : head & 0x0f;
    const def = defs.get(local);
    if (!def) throw new FitDecodeError(`Data message for undefined local type ${local} at byte ${off - 1}`);
    const out: Record<number, FitValue> = {};
    for (const f of def.fields) {
      const base = f.baseType;
      if ((base & 0x1f) === 0x07) {
        const s = decodeString(bytes, off, f.size);
        if (s !== undefined) out[f.num] = s;
      } else {
        const esz = baseTypeSize(base);
        const count = Math.floor(f.size / esz);
        if (count <= 1) {
          if (f.size >= esz) {
            const v = readOne(view, off, base, def.littleEndian);
            if (!isInvalid(base, v)) out[f.num] = v;
          }
        } else {
          const arr: number[] = [];
          let anyValid = false;
          for (let i = 0; i < count; i++) {
            const v = readOne(view, off + i * esz, base, def.littleEndian);
            if (!isInvalid(base, v)) anyValid = true;
            arr.push(v);
          }
          if (anyValid) out[f.num] = arr;
        }
      }
      off += f.size;
    }
    off += def.devBytes;
    if (compressed) {
      const offset5 = head & 0x1f;
      const base5 = lastTimestamp & 0x1f;
      lastTimestamp = offset5 >= base5
        ? (lastTimestamp & ~0x1f) + offset5
        : (lastTimestamp & ~0x1f) + 0x20 + offset5;
      out[253] = lastTimestamp;
    } else if (typeof out[253] === 'number') {
      lastTimestamp = out[253] as number;
    }
    messages.push({ num: def.global, fields: out });
  }

  return { protocolVersion, profileVersion, dataSize, headerSize, crcOk, messages };
}

/** Convenience: all messages with a given global number. */
export function messagesOf(file: FitFile, num: number): FitMessage[] {
  return file.messages.filter((m) => m.num === num);
}
