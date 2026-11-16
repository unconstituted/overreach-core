import { describe, expect, it } from 'vitest';
import { BaseType, decodeFit, fitCrc, FitWriter, fitTimeToUnix, unixToFitTime } from '../../src/core/fit';

describe('FIT CRC', () => {
  it('matches the reference value for a known string', () => {
    // CRC-16/ARC of "123456789" is 0xBB3D; FIT uses the same polynomial.
    const bytes = new Uint8Array([...'123456789'].map((c) => c.charCodeAt(0)));
    expect(fitCrc(bytes)).toBe(0xbb3d);
  });
});

describe('FIT writer and decoder', () => {
  it('round-trips numbers, negative values, strings and invalid values', () => {
    const w = new FitWriter();
    w.define(0, 20, [
      { num: 253, type: BaseType.uint32 }, { num: 7, type: BaseType.uint16 },
      { num: 13, type: BaseType.sint8 }, { num: 2, type: BaseType.sint32 },
      { num: 3, type: BaseType.uint8 }, { num: 99, type: BaseType.string, size: 12 },
    ]);
    w.write(0, [1000, 250, -5, -123456, undefined, 'Café']);
    const out = decodeFit(w.finish());
    expect(out.crcOk).toBe(true);
    expect(out.headerSize).toBe(14);
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].num).toBe(20);
    expect(out.messages[0].fields).toEqual({ 253: 1000, 7: 250, 13: -5, 2: -123456, 99: 'Café' });
  });

  it('detects corruption through the CRC', () => {
    const w = new FitWriter();
    w.define(0, 20, [{ num: 7, type: BaseType.uint16 }]);
    w.write(0, [200]);
    const bytes = w.finish();
    bytes[bytes.length - 4] ^= 0xff;
    expect(decodeFit(bytes).crcOk).toBe(false);
  });

  it('rejects files that are not FIT', () => {
    expect(() => decodeFit(new Uint8Array(20))).toThrow();
  });

  it('converts between Unix and FIT time', () => {
    expect(unixToFitTime(631065600)).toBe(0);
    expect(fitTimeToUnix(unixToFitTime(1794830400))).toBe(1794830400);
  });
});
