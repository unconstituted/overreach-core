import { BaseType, FitWriter, Mesg, unixToFitTime } from '../fit';
import type { Ride, RideSample } from './recorder';
import { summarise } from './summary';

export interface ActivityOptions {
  ftp: number;
  maxHr?: number;
  /** Product name shown by some platforms. */
  productName?: string;
  /** Software version, e.g. 0.10 is written as 10. */
  softwareVersion?: number;
  /** Serial number written to file_id; any stable non-zero value. */
  serial?: number;
  /** FIT sub_sport. 58 = virtual activity (Strava shows "Virtual Ride"); 6 = indoor cycling. */
  subSport?: number;
  /** Local time offset from UTC in seconds, for the activity's local timestamp. */
  utcOffsetSeconds?: number;
}

const MANUFACTURER_DEVELOPMENT = 255;
const SPORT_CYCLING = 2;

const u8 = BaseType.uint8;
const u16 = BaseType.uint16;
const u32 = BaseType.uint32;
const en = BaseType.enum;

/**
 * Encode a recorded ride as a FIT activity file: file_id, file_creator,
 * device_info, timer start, one record per second, a lap per marker, timer
 * stop, session and activity, in the order Garmin's own devices write them.
 */
export function encodeFitActivity(ride: Ride, opts: ActivityOptions): Uint8Array {
  const { samples } = ride;
  if (samples.length === 0) throw new Error('Cannot export an empty ride');
  const start = unixToFitTime(ride.startTime);
  const end = start + samples[samples.length - 1].t;
  const w = new FitWriter();

  w.define(0, Mesg.fileId, [
    { num: 0, type: en }, { num: 1, type: u16 }, { num: 2, type: u16 },
    { num: 3, type: BaseType.uint32z }, { num: 4, type: u32 },
  ]);
  w.write(0, [4, MANUFACTURER_DEVELOPMENT, 1, opts.serial ?? 0x4f565243, start]);

  w.define(1, Mesg.fileCreator, [{ num: 0, type: u16 }]);
  w.write(1, [opts.softwareVersion ?? 10]);

  w.define(2, Mesg.deviceInfo, [
    { num: 253, type: u32 }, { num: 0, type: u8 }, { num: 2, type: u16 }, { num: 4, type: u16 },
    { num: 5, type: u16 }, { num: 27, type: BaseType.string, size: 20 },
  ]);
  w.write(2, [start, 0, MANUFACTURER_DEVELOPMENT, 1, opts.softwareVersion ?? 10, opts.productName ?? 'Overreach Core']);

  w.define(3, Mesg.event, [{ num: 253, type: u32 }, { num: 0, type: en }, { num: 1, type: en }, { num: 4, type: u8 }]);
  w.write(3, [start, 0, 0, 0]); // timer start

  w.define(4, Mesg.record, [
    { num: 253, type: u32 }, { num: 5, type: u32 }, { num: 6, type: u16 }, { num: 7, type: u16 },
    { num: 3, type: u8 }, { num: 4, type: u8 },
  ]);
  w.define(5, Mesg.lap, [
    { num: 254, type: u16 }, { num: 253, type: u32 }, { num: 0, type: en }, { num: 1, type: en },
    { num: 2, type: u32 }, { num: 7, type: u32 }, { num: 8, type: u32 }, { num: 9, type: u32 },
    { num: 11, type: u16 }, { num: 13, type: u16 }, { num: 14, type: u16 }, { num: 15, type: u8 },
    { num: 16, type: u8 }, { num: 17, type: u8 }, { num: 18, type: u8 }, { num: 19, type: u16 },
    { num: 20, type: u16 }, { num: 24, type: en }, { num: 25, type: en }, { num: 39, type: en },
    { num: 41, type: u32 },
  ]);

  // Lap boundaries: 0, each marker inside the ride, then the end.
  const lastT = samples[samples.length - 1].t;
  const bounds = [0, ...ride.laps.map((l) => l.t).filter((t) => t > 0 && t < lastT), lastT];
  const subSport = opts.subSport ?? 58;
  let lapIndex = 0;
  let lapStartSample = 0;
  let lapStartDistance = 0;

  const writeLap = (endSampleExclusive: number, isLast: boolean): void => {
    const slice: RideSample[] = samples.slice(lapStartSample, endSampleExclusive);
    if (slice.length === 0) return;
    const s = summarise(slice, opts.ftp, opts.maxHr);
    const lapDistance = slice[slice.length - 1].distance - lapStartDistance;
    const t0 = start + bounds[lapIndex];
    const t1 = start + slice[slice.length - 1].t;
    w.write(5, [
      lapIndex, t1, 9, 1, t0, slice.length * 1000, slice.length * 1000, lapDistance * 100,
      s.calories, (lapDistance / slice.length) * 1000, s.maxSpeed * 1000, s.avgHeartRate, s.maxHeartRate,
      s.avgCadence, s.maxCadence, s.avgPower, s.maxPower, isLast ? 7 : 0, SPORT_CYCLING, subSport,
      s.kilojoules * 1000,
    ]);
    lapStartDistance = slice[slice.length - 1].distance;
    lapStartSample = endSampleExclusive;
    lapIndex++;
  };

  samples.forEach((s, i) => {
    w.write(4, [
      start + s.t, s.distance * 100, Math.min(65534, s.bikeSpeed * 1000), Math.min(65534, Math.max(0, s.power)),
      s.heartRate !== undefined && s.heartRate > 0 ? Math.min(254, s.heartRate) : undefined,
      s.cadence !== undefined ? Math.min(254, s.cadence) : undefined,
    ]);
    if (s.t === bounds[lapIndex + 1] && s.t !== lastT) writeLap(i + 1, false);
  });

  w.write(3, [end, 0, 4, 0]); // timer stop all
  writeLap(samples.length, true);

  const total = summarise(samples, opts.ftp, opts.maxHr);
  w.define(6, Mesg.session, [
    { num: 254, type: u16 }, { num: 253, type: u32 }, { num: 0, type: en }, { num: 1, type: en },
    { num: 2, type: u32 }, { num: 5, type: en }, { num: 6, type: en }, { num: 7, type: u32 },
    { num: 8, type: u32 }, { num: 9, type: u32 }, { num: 11, type: u16 }, { num: 14, type: u16 },
    { num: 15, type: u16 }, { num: 16, type: u8 }, { num: 17, type: u8 }, { num: 18, type: u8 },
    { num: 19, type: u8 }, { num: 20, type: u16 }, { num: 21, type: u16 }, { num: 25, type: u16 },
    { num: 26, type: u16 }, { num: 28, type: en }, { num: 34, type: u16 }, { num: 35, type: u16 },
    { num: 36, type: u16 }, { num: 45, type: u16 }, { num: 48, type: u32 },
  ]);
  w.write(6, [
    0, end, 8, 1, start, SPORT_CYCLING, subSport, total.duration * 1000, total.duration * 1000,
    total.distance * 100, total.calories, total.avgSpeed * 1000, total.maxSpeed * 1000,
    total.avgHeartRate, total.maxHeartRate, total.avgCadence, total.maxCadence, total.avgPower,
    total.maxPower, 0, lapIndex, 0, total.normalisedPower, total.trainingStress * 10,
    total.intensityFactor * 1000, opts.ftp, total.kilojoules * 1000,
  ]);

  w.define(7, Mesg.activity, [
    { num: 253, type: u32 }, { num: 0, type: u32 }, { num: 1, type: u16 }, { num: 2, type: en },
    { num: 3, type: en }, { num: 4, type: en }, { num: 5, type: u32 },
  ]);
  w.write(7, [end, total.duration * 1000, 1, 0, 26, 1, end + (opts.utcOffsetSeconds ?? 0)]);

  return w.finish();
}
