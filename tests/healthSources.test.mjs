import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { appleDate, appleSourceKind, createAppleParser } from '../src/health/appleParse.ts';
import { batches, readAppleExport } from '../src/health/appleImport.ts';
import { METRIC } from '../spacetimedb/src/health.ts';
import { deviceFrom, normalizeList, normalizeRollup, rollupBody, scaleByPath } from '../googleHealthCore.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Apple's local "2026-10-24 08:00:00 -0700" format for a time `ms`. */
function apple(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${sign}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`;
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const at = (dayOffset, hour, minute = 0) => today.getTime() + dayOffset * DAY + hour * HOUR + minute * 60_000;

const rec = (type, source, start, end, value, unit = '') =>
  `<Record type="${type}" sourceName="${source}" sourceVersion="18.0" unit="${unit}" creationDate="${apple(end)}" startDate="${apple(start)}" endDate="${apple(end)}" value="${value}"/>`;

const XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE HealthData [',
  '<!ATTLIST Record type CDATA #REQUIRED unit CDATA #IMPLIED value CDATA #IMPLIED>',
  ']>',
  '<HealthData locale="en_US">',
  ' <ExportDate value="2026-10-24 20:00:00 -0700"/>',
  // Same day counted by both phone and watch: kept per source.
  rec('HKQuantityTypeIdentifierStepCount', 'Isak’s iPhone', at(-1, 9), at(-1, 10), 1200, 'count'),
  rec('HKQuantityTypeIdentifierStepCount', 'Isak’s iPhone', at(-1, 15), at(-1, 16), 800, 'count'),
  rec('HKQuantityTypeIdentifierStepCount', 'Isak’s Apple Watch', at(-1, 9), at(-1, 10), 1500, 'count'),
  rec('HKQuantityTypeIdentifierDistanceWalkingRunning', 'Isak’s Apple Watch', at(-1, 9), at(-1, 10), 1, 'mi'),
  // Heart rate within the last week: hourly low/high.
  rec('HKQuantityTypeIdentifierHeartRate', 'Isak’s Apple Watch', at(-1, 9, 5), at(-1, 9, 5), 72, 'count/min'),
  rec('HKQuantityTypeIdentifierHeartRate', 'Isak’s Apple Watch', at(-1, 9, 40), at(-1, 9, 40), 118, 'count/min'),
  // Body and vitals in imperial or fractional units.
  `<Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Withings" unit="lb" startDate="${apple(at(-1, 7))}" endDate="${apple(at(-1, 7))}" value="200">`,
  '  <MetadataEntry key="HKWasUserEntered" value="0"/>',
  ' </Record>',
  rec('HKQuantityTypeIdentifierOxygenSaturation', 'Isak’s Apple Watch', at(-1, 3), at(-1, 3), 0.96, '%'),
  rec('HKQuantityTypeIdentifierBloodGlucose', 'Dexcom', at(-1, 8), at(-1, 8), 6, 'mmol<180.1558800000541>/L'),
  rec('HKQuantityTypeIdentifierBodyTemperature', 'Health', at(-1, 8), at(-1, 8), 100.4, 'degF'),
  // Sleep that crosses midnight lands on the night it ended.
  rec('HKCategoryTypeIdentifierSleepAnalysis', 'Isak’s Apple Watch', at(-2, 23), at(-1, 1), 'HKCategoryValueSleepAnalysisAsleepCore'),
  rec('HKCategoryTypeIdentifierSleepAnalysis', 'Isak’s Apple Watch', at(-1, 1), at(-1, 2), 'HKCategoryValueSleepAnalysisAsleepDeep'),
  rec('HKCategoryTypeIdentifierSleepAnalysis', 'Isak’s Apple Watch', at(-1, 2), at(-1, 3, 30), 'HKCategoryValueSleepAnalysisAsleepREM'),
  rec('HKCategoryTypeIdentifierSleepAnalysis', 'Isak’s Apple Watch', at(-1, 3, 30), at(-1, 4), 'HKCategoryValueSleepAnalysisAwake'),
  rec('HKCategoryTypeIdentifierSleepAnalysis', 'Isak’s iPhone', at(-2, 22, 30), at(-1, 6), 'HKCategoryValueSleepAnalysisInBed'),
  rec('HKCategoryTypeIdentifierAppleStandHour', 'Isak’s Apple Watch', at(-1, 9), at(-1, 10), 'HKCategoryValueAppleStandHourStood'),
  rec('HKCategoryTypeIdentifierAppleStandHour', 'Isak’s Apple Watch', at(-1, 10), at(-1, 11), 'HKCategoryValueAppleStandHourIdle'),
  rec('HKCategoryTypeIdentifierMenstrualFlow', 'Health', at(-3, 8), at(-3, 8), 'HKCategoryValueMenstrualFlowHeavy'),
  rec('HKCategoryTypeIdentifierMindfulSession', 'Breathe', at(-1, 12), at(-1, 12, 10), 'HKCategoryValueNotApplicable'),
  `<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="0.5" durationUnit="hr" sourceName="Isak’s Apple Watch" startDate="${apple(at(-1, 17))}" endDate="${apple(at(-1, 17, 30))}">`,
  '  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="180" unit="Cal"/>',
  ' </Workout>',
  // Outside the import window and unknown types are skipped.
  rec('HKQuantityTypeIdentifierStepCount', 'Isak’s iPhone', at(-400, 9), at(-400, 10), 9999, 'count'),
  rec('HKQuantityTypeIdentifierSomethingNew', 'Isak’s iPhone', at(-1, 9), at(-1, 10), 3, 'count'),
  '</HealthData>',
].join('\n');

function parseInChunks(xml, size) {
  const p = createAppleParser(Date.now() - 90 * DAY);
  for (let i = 0; i < xml.length; i += size) p.feed(xml.slice(i, i + size));
  return { bySource: p.finish(), records: p.records };
}

const find = (bySource, source, metric, label) => (bySource.get(source) ?? []).filter(s => s.metric === metric && (label === undefined || s.label === label));

test('Apple dates keep their UTC offset', () => {
  assert.equal(appleDate('2026-10-24 08:00:00 -0700'), Date.UTC(2026, 9, 24, 15));
  assert.equal(appleDate('2026-10-24 08:00:00 +0530'), Date.UTC(2026, 9, 24, 2, 30));
});

test('Apple export: totals, units, sleep, events and workouts survive any chunking', () => {
  for (const size of [7, 64, 1000, XML.length]) {
    const { bySource, records } = parseInChunks(XML, size);
    assert.equal(records, 21, `chunk ${size}`);
    const phone = find(bySource, 'Isak’s iPhone', 'steps');
    const watch = find(bySource, 'Isak’s Apple Watch', 'steps');
    assert.equal(phone.length, 1);
    assert.equal(phone[0].value, 2000);
    assert.equal(watch[0].value, 1500);
    assert.ok(Math.abs(find(bySource, 'Isak’s Apple Watch', 'distance')[0].value - 1.609344) < 1e-6);

    const hr = find(bySource, 'Isak’s Apple Watch', 'heart_rate');
    assert.deepEqual(hr.map(s => [s.label, s.value]).sort(), [['High', 118], ['Low', 72]]);
    assert.equal(hr[0].end - hr[0].start, HOUR);

    assert.ok(Math.abs(find(bySource, 'Withings', 'weight')[0].value - 90.718474) < 1e-4);
    assert.equal(find(bySource, 'Isak’s Apple Watch', 'blood_oxygen')[0].value, 96);
    assert.ok(Math.abs(find(bySource, 'Dexcom', 'blood_glucose')[0].value - 108.09) < 0.01);
    assert.ok(Math.abs(find(bySource, 'Health', 'body_temperature')[0].value - 38) < 1e-9);

    const sleep = metric => find(bySource, 'Isak’s Apple Watch', metric)[0]?.value;
    assert.equal(sleep('sleep_asleep'), 4.5);
    assert.equal(sleep('sleep_core'), 2);
    assert.equal(sleep('sleep_deep'), 1);
    assert.equal(sleep('sleep_rem'), 1.5);
    assert.equal(sleep('sleep_awake'), 0.5);
    assert.equal(find(bySource, 'Isak’s iPhone', 'sleep_asleep').length, 0, 'in bed is not sleep');

    assert.equal(find(bySource, 'Isak’s Apple Watch', 'stand_hours')[0].value, 1);
    assert.equal(find(bySource, 'Health', 'menstrual_flow')[0].value, 4);
    assert.equal(find(bySource, 'Breathe', 'mindful_minutes')[0].value, 10);
    const workout = find(bySource, 'Isak’s Apple Watch', 'workouts')[0];
    assert.equal(workout.value, 30);
    assert.equal(workout.label, 'Traditional strength training');

    for (const list of bySource.values()) {
      for (const s of list) {
        const m = METRIC[s.metric];
        assert.ok(m && s.value >= m.min && s.value <= m.max, `${s.metric}=${s.value}`);
      }
    }
  }
});

test('Apple export zip is read in the browser path and batched per source', async () => {
  const zip = zipSync({
    'apple_health_export/export_cda.xml': strToU8('<ClinicalDocument/>'),
    'apple_health_export/export.xml': strToU8(XML),
  });
  const file = new File([zip], 'export.zip', { type: 'application/zip' });
  let last = 0;
  const { bySource, records } = await readAppleExport(file, 90, p => (last = p.fraction));
  assert.equal(records, 21);
  assert.equal(last, 1);
  const jobs = batches(bySource, 3);
  assert.ok(jobs.every(j => j.samples.length <= 3));
  assert.equal(jobs.find(j => j.source === 'Isak’s Apple Watch').kind, 'apple_watch');
  assert.equal(jobs.find(j => j.source === 'Withings').kind, 'smart_scale');
  assert.equal(jobs.find(j => j.source === 'Dexcom').kind, 'glucose_monitor');
  assert.equal(appleSourceKind('Isak’s iPhone'), 'iphone');
});

test('a zip without export.xml is rejected with a helpful message', async () => {
  const file = new File([zipSync({ 'notes.txt': strToU8('hi') })], 'other.zip');
  await assert.rejects(readAppleExport(file, 90, () => {}), /No export\.xml found/);
});

test('Google Health rollups and lists normalize to catalog readings', () => {
  const steps = normalizeRollup(METRIC.steps, {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 10, day: 23 }, time: {} }, steps: { countSum: '8421' } },
      { civilStartTime: { date: { year: 2026, month: 10, day: 24 }, time: {} }, steps: { countSum: '0' } },
    ],
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].value, 8421);
  assert.equal(steps[0].start, new Date(2026, 9, 23).getTime());

  const distance = normalizeRollup(METRIC.distance, {
    rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 10, day: 23 } }, distance: { millimetersSum: 5_200_000 } }],
  });
  assert.equal(distance[0].value, 5.2);

  const weight = normalizeRollup(METRIC.weight, {
    rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 10, day: 23 } }, weight: { weightGramsAvg: 81_500 } }],
  });
  assert.equal(weight[0].value, 81.5);

  const since = Date.UTC(2026, 9, 1);
  const sleep = normalizeList(METRIC.sleep_asleep, {
    dataPoints: [
      {
        sleep: {
          interval: { startTime: '2026-10-23T06:10:00Z', endTime: '2026-10-23T13:40:00Z' },
          summary: { minutesAsleep: '402', stagesSummary: [{ type: 'DEEP', minutes: 70 }, { type: 'LIGHT', minutes: 240 }, { type: 'REM', minutes: 92 }, { type: 'AWAKE', minutes: 48 }] },
        },
      },
      { sleep: { interval: { startTime: '2026-09-01T06:00:00Z' }, summary: { minutesAsleep: 400 } } },
    ],
  }, since);
  const got = Object.fromEntries(sleep.map(s => [s.metric, Math.round(s.value * 60)]));
  assert.deepEqual(got, { sleep_asleep: 402, sleep_deep: 70, sleep_core: 240, sleep_rem: 92, sleep_awake: 48 });

  const rhr = normalizeList(METRIC.resting_heart_rate, {
    dataPoints: [{ dailyRestingHeartRate: { date: { year: 2026, month: 10, day: 22 }, beatsPerMinute: 61 } }],
  }, since);
  assert.equal(rhr[0].value, 61);

  assert.equal(scaleByPath(METRIC.blood_oxygen, 'percentageAvg', 0.95), 95);
  assert.equal(scaleByPath(METRIC.body_temperature, 'fahrenheit', 98.6).toFixed(1), '37.0');
});

test('Google Health device names and rollup window', () => {
  assert.deepEqual(deviceFrom({ pairedDevices: [{ deviceVersion: 'Charge 6' }] }), { name: 'Fitbit Charge 6', kind: 'fitbit' });
  assert.deepEqual(deviceFrom({ pairedDevices: [{ deviceVersion: 'Pixel Watch 3' }] }), { name: 'Pixel Watch 3', kind: 'pixel_watch' });
  assert.deepEqual(deviceFrom({}), { name: 'Fitbit', kind: 'fitbit' });
  const body = rollupBody(7, new Date(2026, 9, 24, 15));
  assert.deepEqual(body.range.start.date, { year: 2026, month: 10, day: 18 });
  assert.deepEqual(body.range.end.date, { year: 2026, month: 10, day: 25 });
  assert.equal(body.windowSizeDays, 1);
});
