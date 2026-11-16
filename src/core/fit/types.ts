/** FIT base types (the byte written in a field definition). */
export const BaseType = {
  enum: 0x00,
  sint8: 0x01,
  uint8: 0x02,
  sint16: 0x83,
  uint16: 0x84,
  sint32: 0x85,
  uint32: 0x86,
  string: 0x07,
  float32: 0x88,
  float64: 0x89,
  uint8z: 0x0a,
  uint16z: 0x8b,
  uint32z: 0x8c,
  byte: 0x0d,
  sint64: 0x8e,
  uint64: 0x8f,
  uint64z: 0x90,
} as const;

export type BaseTypeId = (typeof BaseType)[keyof typeof BaseType];

/** Size in bytes of one element of each base type. */
export function baseTypeSize(t: number): number {
  switch (t & 0x1f) {
    case 0x00: case 0x01: case 0x02: case 0x07: case 0x0a: case 0x0d: return 1;
    case 0x03: case 0x04: case 0x0b: return 2;
    case 0x05: case 0x06: case 0x08: case 0x0c: return 4;
    case 0x09: case 0x0e: case 0x0f: case 0x10: return 8;
    default: return 1;
  }
}

/** Global message numbers used by the engine. */
export const Mesg = {
  fileId: 0,
  session: 18,
  lap: 19,
  record: 20,
  event: 21,
  deviceInfo: 23,
  workout: 26,
  workoutStep: 27,
  activity: 34,
  fileCreator: 49,
} as const;

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
export const FIT_EPOCH_OFFSET = 631065600;

export function unixToFitTime(unixSeconds: number): number {
  return Math.round(unixSeconds) - FIT_EPOCH_OFFSET;
}
export function fitTimeToUnix(fitSeconds: number): number {
  return fitSeconds + FIT_EPOCH_OFFSET;
}

export type FitValue = number | string | number[] | undefined;

export interface FitMessage {
  /** Global message number. */
  num: number;
  /** Field number to decoded raw value (no scale or offset applied). Invalid values are omitted. */
  fields: Record<number, FitValue>;
}

export interface FitFile {
  protocolVersion: number;
  profileVersion: number;
  dataSize: number;
  headerSize: number;
  crcOk: boolean;
  messages: FitMessage[];
}
