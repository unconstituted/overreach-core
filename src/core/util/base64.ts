/** Base64 without host APIs, for putting ride files inside a JSON export. */
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REV = new Map([...ABC].map((c, i) => [c, i]));

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += ABC[a >> 2] + ABC[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? ABC[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? ABC[c & 63] : '=';
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = REV.get(clean[i]) ?? 0;
    const b = REV.get(clean[i + 1]) ?? 0;
    const c = i + 2 < clean.length ? REV.get(clean[i + 2]) ?? 0 : -1;
    const d = i + 3 < clean.length ? REV.get(clean[i + 3]) ?? 0 : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = (((c < 0 ? 0 : c) & 3) << 6) | d;
  }
  return out.subarray(0, o);
}
