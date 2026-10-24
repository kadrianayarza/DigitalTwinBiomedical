import type { VitalSample } from '../module_bindings/types';
import { CALF_BASELINE_C, INCISION_BASELINE_C } from '../components/PodVitals';
import { hotspotAnchors, type HotspotId } from './bodyModel';

export type HotspotTone = 'info' | 'watch' | 'alarm';

export type TwinHotspot = {
  id: HotspotId;
  point: [number, number, number];
  kicker: string;
  body: string;
  meta?: string;
  tone: HotspotTone;
};

type Input = {
  side: 'left' | 'right';
  vitals: readonly VitalSample[];
  audience: 'patient' | 'nurse';
};

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;

/** Landmark callouts. Thresholds mirror the server rules in spacetimedb/src/clinical.ts. */
export function buildHotspots({ side, vitals, audience }: Input): TwinHotspot[] {
  const anchors = hotspotAnchors(side === 'left' ? 'l' : 'r');
  const last = vitals[vitals.length - 1];
  const recent = vitals.slice(-5);
  const avg = (f: (v: VitalSample) => number) =>
    recent.length ? recent.reduce((s, v) => s + f(v), 0) / recent.length : undefined;

  const incisionDelta = last ? (avg(v => v.incisionTempC) ?? 0) - INCISION_BASELINE_C : undefined;
  const calfDelta = last ? (avg(v => v.calfTempC) ?? 0) - CALF_BASELINE_C : undefined;
  const flexWindow = vitals.slice(-60);
  const bestBend = flexWindow.length ? Math.max(...flexWindow.map(v => v.kneeFlexDeg)) : undefined;
  const hr = avg(v => v.hr);
  const spo2 = avg(v => v.spo2);

  const incisionTone: HotspotTone =
    incisionDelta === undefined ? 'info' : incisionDelta >= 1.5 ? 'alarm' : incisionDelta >= 0.8 ? 'watch' : 'info';
  const calfTone: HotspotTone =
    calfDelta === undefined ? 'info' : calfDelta >= 1.0 ? 'alarm' : calfDelta >= 0.5 ? 'watch' : 'info';
  const bendTone: HotspotTone = bestBend !== undefined && flexWindow.length >= 40 && bestBend < 60 ? 'watch' : 'info';
  const cardioTone: HotspotTone =
    (spo2 ?? 100) < 92 ? 'alarm' : (hr ?? 0) > 100 ? 'watch' : 'info';

  if (audience === 'patient') {
    return [
      {
        id: 'incision',
        point: anchors.incision,
        kicker: 'Incision',
        body: 'Some warmth, bruising and swelling are normal for a few weeks. Tap here if redness spreads, it drains, or you feel feverish.',
        meta:
          incisionDelta === undefined
            ? undefined
            : incisionTone === 'info'
              ? 'Pod: skin temperature is close to your usual.'
              : 'Pod: warmer than your usual. Your care team can see this too.',
        tone: incisionTone,
      },
      {
        id: 'bend',
        point: anchors.bend,
        kicker: 'Knee bend',
        body: 'Bending a little more each day helps your new knee heal. Follow the exercise plan from your surgeon.',
        meta: bestBend === undefined ? undefined : `Pod: best bend lately ${Math.round(bestBend)}°.`,
        tone: 'info',
      },
      {
        id: 'calf',
        point: anchors.calf,
        kicker: 'Calf',
        body: 'New calf pain, swelling or warmth can be a sign of a blood clot. Tap your calf to tell your nurse right away.',
        tone: calfTone === 'info' ? 'info' : 'watch',
      },
      {
        id: 'chest',
        point: anchors.chest,
        kicker: 'Breathing',
        body: 'Chest pain or sudden trouble breathing is an emergency. Call 911.',
        tone: 'alarm',
      },
    ];
  }

  return [
    {
      id: 'incision',
      point: anchors.incision,
      kicker: 'Incision temp',
      body: last ? `${last.incisionTempC.toFixed(1)} °C · ${signed(incisionDelta!)} °C vs baseline (5-sample mean)` : 'No pod data yet.',
      meta: 'Rule: +1.5 °C → same-day review',
      tone: incisionTone,
    },
    {
      id: 'bend',
      point: anchors.bend,
      kicker: 'Knee flexion',
      body: bestBend === undefined ? 'No pod data yet.' : `Max ${Math.round(bestBend)}° over last ${flexWindow.length} samples`,
      meta: 'Rule: < 60° after 40 samples → 24 h review',
      tone: bendTone,
    },
    {
      id: 'calf',
      point: anchors.calf,
      kicker: 'Calf temp',
      body: last ? `${last.calfTempC.toFixed(1)} °C · ${signed(calfDelta!)} °C vs baseline (5-sample mean)` : 'No pod data yet.',
      meta: 'Rule: +1.0 °C → 24 h review; with symptoms → DVT same-day',
      tone: calfTone,
    },
    {
      id: 'chest',
      point: anchors.chest,
      kicker: 'Cardiorespiratory',
      body: last ? `HR ${Math.round(hr!)} bpm · SpO₂ ${Math.round(spo2!)}% (5-sample mean)` : 'No pod data yet.',
      meta: 'Rules: SpO₂ < 92 → emergency · HR > 100 → same-day',
      tone: cardioTone,
    },
  ];
}
