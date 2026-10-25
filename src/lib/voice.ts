import { EXERCISE_DAYS, VOICE_KIND_LABEL, type VoiceItemKind } from '../../spacetimedb/src/voice.ts';

export {
  PRIORITIES,
  PRIORITY_LABEL,
  TABS,
  TAB_ALIASES,
  TAB_IDS,
  applyGoal,
  defaultLayout,
  isTabId,
  matchNavCommand,
  metaFor,
  moveTab,
  orderedTabs,
  parseLayout,
  serializeLayout,
  setEnabled,
  setPriority,
  visibleTabs,
} from '../../spacetimedb/src/layout.ts';
export type { Layout, Priority, TabId, TabPref } from '../../spacetimedb/src/layout.ts';

export {
  VOICE_KIND_LABEL,
  VOICE_TARGET_FOR,
  confirmQuestion,
  EXERCISE_DAYS,
  EXERCISE_INTENSITIES,
} from '../../spacetimedb/src/voice.ts';
export type { VoiceDetail, VoiceItemKind } from '../../spacetimedb/src/voice.ts';

/** Plain-language name for a proposal, used in the chat transcript. */
export function kindLabel(kind: string): string {
  return VOICE_KIND_LABEL[kind as VoiceItemKind] ?? 'Update';
}

/** Where a confirmed proposal will land, phrased for the confirmation prompt. */
export function targetPhrase(target: string): string {
  switch (target) {
    case 'check-ins':
      return 'Check-ins on your twin';
    case 'vitals':
      return 'Vitals';
    case 'medications':
      return 'Medicines';
    case 'labs':
      return 'Chart · Lab results';
    case 'history':
      return 'Chart · Health history';
    case 'diet':
      return 'Diet';
    case 'sleep':
      return 'Sleep';
    case 'exercise':
      return 'Exercise';
    default:
      return target;
  }
}

/** One readable line describing what a confirmed proposal will store. */
export function describeDetail(kind: string, detail: Record<string, unknown>): string {
  const s = (k: string) => (typeof detail[k] === 'string' ? (detail[k] as string) : '');
  const n = (k: string) => (typeof detail[k] === 'number' ? (detail[k] as number) : undefined);
  const b = (k: string) => detail[k] === true;

  switch (kind) {
    case 'symptom': {
      const parts: string[] = [];
      if (s('region')) parts.push(s('region').replace(/_/g, ' '));
      const severity = n('severity');
      if (severity !== undefined) parts.push(`${severity}/10`);
      if (s('quality')) parts.push(s('quality'));
      for (const [key, label] of [
        ['swelling', 'swelling'],
        ['warmth', 'warmth'],
        ['redness', 'redness'],
        ['chestPain', 'chest pain'],
        ['shortnessOfBreath', 'shortness of breath'],
      ] as const) {
        if (b(key)) parts.push(label);
      }
      const temp = n('bodyTempC');
      if (temp !== undefined && temp > 0) parts.push(`${temp}°C`);
      if (s('notes')) parts.push(s('notes'));
      return parts.join(' · ') || 'Symptom recorded';
    }
    case 'vitals': {
      const parts: string[] = [];
      const sys = n('systolic');
      const dia = n('diastolic');
      if (sys !== undefined && dia !== undefined) parts.push(`BP ${sys}/${dia}`);
      const hr = n('hr');
      if (hr !== undefined) parts.push(`HR ${hr} bpm`);
      const rr = n('respRate');
      if (rr !== undefined) parts.push(`resp ${rr}`);
      const spo2 = n('spo2');
      if (spo2 !== undefined) parts.push(`SpO2 ${spo2}%`);
      const temp = n('tempC');
      if (temp !== undefined) parts.push(`temp ${temp}°C`);
      const glucose = n('glucoseMgDl');
      if (glucose !== undefined) parts.push(`glucose ${glucose} mg/dL`);
      return parts.join(' · ') || 'Vitals recorded';
    }
    case 'dose':
      return `${s('status') === 'skipped' ? 'Skipped' : 'Taken'} ${s('medicationName')}${
        n('glucoseMgDl') !== undefined ? ` · glucose ${n('glucoseMgDl')} mg/dL` : ''
      }`;
    case 'lab':
      return `${s('name')} ${n('value') ?? ''} ${s('unit')}`.trim();
    case 'history':
      return [s('category'), s('title'), s('detail'), s('whenText')].filter(Boolean).join(' · ');
    case 'diet':
      return [s('summary'), s('amount'), s('whenText')].filter(Boolean).join(' · ');
    case 'sleep': {
      const hours = n('hours');
      return [s('summary'), hours !== undefined ? `${hours} h` : '', s('whenText')].filter(Boolean).join(' · ');
    }
    case 'exercise': {
      const minutes = n('minutes');
      const day = n('day');
      return [
        s('activity'),
        minutes !== undefined && minutes > 0 ? `${minutes} min` : '',
        s('intensity'),
        s('status') === 'planned' && day !== undefined && day >= 0 ? EXERCISE_DAYS[day] : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    default:
      return '';
  }
}
