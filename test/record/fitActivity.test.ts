import FitParser from 'fit-file-parser';
import { describe, expect, it } from 'vitest';
import { decodeFit, Mesg, messagesOf } from '../../src/core/fit';
import { encodeFitActivity, RideRecorder, summarise } from '../../src/core/record';

/** A 10-minute ride: 5 min at 150 W, 2 min at 300 W, 3 min at 120 W, with laps at the changes. */
function makeRide() {
  const start = Date.UTC(2026, 10, 16, 18, 30, 0) / 1000;
  const rec = new RideRecorder(start);
  const powerAt = (t: number) => (t < 300 ? 150 : t < 420 ? 300 : 120);
  rec.update(0, { power: powerAt(0), cadence: 88, heartRate: 110, gameSpeed: 50 });
  for (let t = 1; t <= 600; t++) {
    if (t === 300 || t === 420) rec.lap(t);
    rec.update(t, { power: powerAt(t), cadence: t < 420 ? 88 : 80, heartRate: Math.round(110 + t / 12), gameSpeed: 50 });
  }
  return { ride: rec.ride(), start };
}

describe('FIT activity export', () => {
  const { ride, start } = makeRide();
  const bytes = encodeFitActivity(ride, { ftp: 250, maxHr: 185 });

  it('writes a structurally valid file: header, CRC and message order', () => {
    const f = decodeFit(bytes);
    expect(f.crcOk).toBe(true);
    expect(f.headerSize).toBe(14);
    const order = f.messages.map((m) => m.num);
    expect(order[0]).toBe(Mesg.fileId);
    expect(order[order.length - 1]).toBe(Mesg.activity);
    expect(order[order.length - 2]).toBe(Mesg.session);
    expect(messagesOf(f, Mesg.record)).toHaveLength(600);
    expect(messagesOf(f, Mesg.lap)).toHaveLength(3);
    expect(messagesOf(f, Mesg.event)).toHaveLength(2);
    expect(messagesOf(f, Mesg.deviceInfo)).toHaveLength(1);
    expect(messagesOf(f, Mesg.fileId)[0].fields[0]).toBe(4); // type = activity
  });

  it('decodes cleanly with an independent FIT decoder', async () => {
    const parser = new FitParser({ force: false, speedUnit: 'm/s', lengthUnit: 'm', elapsedRecordField: true, mode: 'list' });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const fit = await parser.parseAsync(buf);
    const summary = summarise(ride.samples, 250, 185);

    expect(fit.file_ids![0].type).toBe('activity');
    expect(fit.records).toHaveLength(600);
    const first = fit.records![0];
    expect(new Date(first.timestamp as unknown as string).getTime() / 1000).toBe(start + 1);
    expect(first.power).toBe(150);
    expect(first.cadence).toBe(88);
    expect(first.heart_rate).toBe(110);
    const r350 = fit.records![349];
    expect(r350.power).toBe(300);
    expect(r350.speed).toBeCloseTo(ride.samples[349].bikeSpeed, 2);
    expect(r350.distance).toBeCloseTo(ride.samples[349].distance, 1);

    expect(fit.laps).toHaveLength(3);
    expect(fit.laps!.map((l) => l.total_timer_time)).toEqual([300, 120, 180]);
    expect(fit.laps!.map((l) => l.avg_power)).toEqual([150, 300, 120]);
    const lapDistance = fit.laps!.reduce((a, l) => a + (l.total_distance as number), 0);
    expect(lapDistance).toBeCloseTo(summary.distance, 0);

    const session = fit.sessions![0];
    expect(session.sport).toBe('cycling');
    expect(session.total_timer_time).toBe(600);
    expect(session.total_elapsed_time).toBe(600);
    expect(session.avg_power).toBe(Math.round(summary.avgPower));
    expect(session.max_power).toBe(300);
    expect(session.normalized_power).toBe(Math.round(summary.normalisedPower));
    expect(session.total_work).toBe(Math.round(summary.kilojoules * 1000));
    expect(session.total_distance).toBeCloseTo(summary.distance, 1);
    expect(session.avg_heart_rate).toBe(Math.round(summary.avgHeartRate!));
    expect(session.max_heart_rate).toBe(160);
    expect(session.num_laps).toBe(3);
    expect(session.threshold_power).toBe(250);
    expect(new Date(session.start_time as unknown as string).getTime() / 1000).toBe(start);

    expect(fit.activity?.num_sessions).toBe(1);
    expect(fit.activity?.total_timer_time).toBe(600);
  });

  it('hand-computed totals: kJ and average power for the fixture ride', () => {
    const s = summarise(ride.samples, 250, 185);
    // 300 s * 150 W + 120 s * 300 W + 180 s * 120 W = 102,600 J
    expect(s.kilojoules).toBeCloseTo(102.6, 6);
    expect(s.avgPower).toBeCloseTo(171, 6);
  });

  it('omits heart rate cleanly when no strap was connected', async () => {
    const rec = new RideRecorder(start);
    rec.update(0, { power: 200 });
    for (let t = 1; t <= 60; t++) rec.update(t, { power: 200 });
    const out = encodeFitActivity(rec.ride(), { ftp: 250 });
    const parser = new FitParser({ force: false, mode: 'list' });
    const fit = await parser.parseAsync(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);
    expect(fit.records).toHaveLength(60);
    expect(fit.records![10].heart_rate).toBeUndefined();
    expect(fit.sessions![0].avg_heart_rate).toBeUndefined();
  });

  it('refuses to export an empty ride', () => {
    expect(() => encodeFitActivity({ startTime: 0, samples: [], laps: [] }, { ftp: 250 })).toThrow();
  });
});
