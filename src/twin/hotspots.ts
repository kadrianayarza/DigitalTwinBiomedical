import type { VitalSign } from '../module_bindings/types';
import type { HotspotId } from './bodyModel';

export type HotspotTone = 'info' | 'watch' | 'alarm';

export type TwinHotspot = {
  id: HotspotId;
  kicker: string;
  body: string;
  meta?: string;
  tone: HotspotTone;
};

type Input = {
  vitals: readonly VitalSign[];
  audience: 'patient' | 'nurse';
};

/** Landmark callouts. Thresholds mirror the server rules in spacetimedb/src/clinical.ts. */
export function buildHotspots({ vitals, audience }: Input): TwinHotspot[] {
  const recent = vitals.slice(-5);
  const avg = (f: (v: VitalSign) => number) =>
    recent.length ? recent.reduce((s, v) => s + f(v), 0) / recent.length : undefined;

  const hr = avg(v => v.hr);
  const systolic = avg(v => v.systolic);
  const diastolic = avg(v => v.diastolic);
  const respRate = avg(v => v.respRate);
  const spo2 = avg(v => v.spo2);
  const tempC = avg(v => v.tempC);

  const tempTone: HotspotTone =
    tempC === undefined ? 'info' : tempC >= 38 ? 'alarm' : tempC >= 37.5 ? 'watch' : 'info';
  const cardioTone: HotspotTone =
    (spo2 ?? 100) < 92
      ? 'alarm'
      : (hr ?? 0) > 100 || (respRate ?? 0) > 24 || (systolic ?? 120) < 90 || (systolic ?? 120) >= 180
        ? 'watch'
        : 'info';

  if (audience === 'patient') {
    return [
      {
        id: 'incision',
        kicker: 'Incision',
        body: 'Some warmth, bruising and swelling are normal for a few weeks. Tap here if redness spreads, it drains, or you feel feverish.',
        meta:
          tempC === undefined
            ? undefined
            : tempTone === 'info'
              ? 'Pod: your temperature is normal.'
              : 'Pod: your temperature is up. Your care team can see this too.',
        tone: tempTone,
      },
      {
        id: 'bend',
        kicker: 'Knee bend',
        body: 'Bending a little more each day helps your new knee heal. Follow the exercise plan from your surgeon.',
        tone: 'info',
      },
      {
        id: 'calf',
        kicker: 'Calf',
        body: 'New calf pain, swelling or warmth can be a sign of a blood clot. Tap your calf to tell your nurse right away.',
        tone: 'info',
      },
      {
        id: 'chest',
        kicker: 'Breathing',
        body: 'Chest pain or sudden trouble breathing is an emergency. Call 911.',
        tone: 'alarm',
      },
    ];
  }

  const none = 'No pod data yet.';
  return [
    {
      id: 'incision',
      kicker: 'Temperature',
      body: tempC === undefined ? none : `${tempC.toFixed(1)} °C (5-sample mean)`,
      meta: 'Rule: ≥ 38.0 °C → same-day review',
      tone: tempTone,
    },
    {
      id: 'calf',
      kicker: 'Clot watch',
      body:
        hr === undefined
          ? none
          : `HR ${Math.round(hr)} bpm · RR ${Math.round(respRate!)}/min · SpO₂ ${Math.round(spo2!)}%`,
      meta: 'Rule: calf pain with swelling or warmth → same-day',
      tone: cardioTone === 'alarm' ? 'alarm' : 'info',
    },
    {
      id: 'chest',
      kicker: 'Cardiorespiratory',
      body:
        hr === undefined
          ? none
          : `HR ${Math.round(hr)} · BP ${Math.round(systolic!)}/${Math.round(diastolic!)} · RR ${Math.round(respRate!)} · SpO₂ ${Math.round(spo2!)}%`,
      meta: 'Rules: SpO₂ < 92 → emergency · HR > 100, RR > 24, SBP < 90 or ≥ 180 → same-day',
      tone: cardioTone,
    },
  ];
}
