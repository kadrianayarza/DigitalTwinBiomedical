// Tab layout shared by the patient and nurse views. A patient's tab order, visibility,
// and priorities are stored once and read by both sides, so the nurse sees the same
// emphasis the patient chose.
//
// Pure functions only: the reducers, the UI, and the tests all use this file.

export const TAB_IDS = [
  'check-ins',
  'vitals',
  'medications',
  'health-record',
  'diet',
  'sleep',
  'exercise',
  'twin',
  'history',
  'devices',
  'assessment',
  'mood',
  'schedule',
  'messages',
] as const;
export type TabId = (typeof TAB_IDS)[number];

export const PRIORITIES = ['high', 'normal', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export type TabMeta = {
  id: TabId;
  label: string;
  /** Shown in the organise panel so the choice is understandable. */
  hint: string;
  patient: boolean;
  nurse: boolean;
  /** Tabs the app turns on for a new patient before they choose. */
  defaultOn: boolean;
};

export const TABS: TabMeta[] = [
  {
    id: 'check-ins',
    label: 'Check-ins',
    hint: 'Where the patient taps the twin and records how they feel',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'vitals',
    label: 'Vitals',
    hint: 'Heart rate, blood pressure, breathing, oxygen, temperature',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'medications',
    label: 'Medicines',
    hint: 'What to take, when it is due, and how each dose went',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'health-record',
    label: 'Health record',
    hint: 'Lab results and the standing medical history',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'diet',
    label: 'Diet',
    hint: 'Meals, fluids, and appetite',
    patient: true,
    nurse: true,
    defaultOn: false,
  },
  {
    id: 'sleep',
    label: 'Sleep',
    hint: 'Hours slept and how rested the patient feels',
    patient: true,
    nurse: true,
    defaultOn: false,
  },
  {
    id: 'exercise',
    label: 'Exercise',
    hint: 'A weekly workout plan, sessions you log, and minutes moved',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'twin',
    label: '3D twin',
    hint: 'The 3D body model with the patient’s own scans and taps',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'history',
    label: 'Health history',
    hint: 'Allergies, past conditions, family and social history',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'devices',
    label: 'Devices',
    hint: 'Walkers, hearing aids, oxygen and other equipment on the chart',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'assessment',
    label: 'Nursing assessment',
    hint: 'Head-to-toe system findings the nurse records on the 3D model',
    patient: false,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'mood',
    label: 'Mood and mental health',
    hint: 'Daily mood, PHQ-9 and GAD-7 screenings, and red-flag alerts to the care team',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'schedule',
    label: 'Schedule',
    hint: 'Visits, medicine dose times, and planned workouts, day by day and month by month',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
  {
    id: 'messages',
    label: 'Messages',
    hint: 'A private conversation between the patient, the nurse, and approved family',
    patient: true,
    nurse: true,
    defaultOn: true,
  },
];

const TAB_BY_ID = new Map(TABS.map(t => [t.id, t]));

export const isTabId = (v: unknown): v is TabId =>
  typeof v === 'string' && (TAB_IDS as readonly string[]).includes(v);

export const isPriority = (v: unknown): v is Priority =>
  typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);

export type TabPref = { id: TabId; on: boolean; priority: Priority };

export type Layout = {
  /** One entry per known tab, in the patient's chosen order. */
  tabs: TabPref[];
  /** Free-text goal captured by the quick initial assessment. */
  goal: string;
  /** Set once the patient has been through the initial assessment. */
  assessed: boolean;
};

export function defaultLayout(): Layout {
  return {
    tabs: TABS.map(t => ({ id: t.id, on: t.defaultOn, priority: 'normal' as Priority })),
    goal: '',
    assessed: false,
  };
}

/**
 * Build a usable layout from stored JSON. Unknown tabs are dropped, missing tabs are
 * appended in catalogue order, and duplicates are removed, so a layout written by an
 * older build still loads.
 */
export function parseLayout(raw: string): Layout {
  const fallback = defaultLayout();
  if (!raw.trim()) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null) return fallback;
  const source = parsed as { tabs?: unknown; goal?: unknown; assessed?: unknown };

  const seen = new Set<TabId>();
  const tabs: TabPref[] = [];
  if (Array.isArray(source.tabs)) {
    for (const entry of source.tabs) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as { id?: unknown; on?: unknown; priority?: unknown };
      if (!isTabId(e.id) || seen.has(e.id)) continue;
      seen.add(e.id);
      tabs.push({
        id: e.id,
        on: e.on !== false,
        priority: isPriority(e.priority) ? e.priority : 'normal',
      });
    }
  }
  for (const meta of TABS) {
    if (!seen.has(meta.id)) tabs.push({ id: meta.id, on: meta.defaultOn, priority: 'normal' });
  }

  return {
    tabs,
    goal: typeof source.goal === 'string' ? source.goal.slice(0, 500) : '',
    assessed: source.assessed === true,
  };
}

export function serializeLayout(layout: Layout): string {
  return JSON.stringify({
    tabs: layout.tabs.map(t => ({ id: t.id, on: t.on, priority: t.priority })),
    goal: layout.goal.slice(0, 500),
    assessed: layout.assessed,
  });
}

/** Move one tab to a new position, keeping every other tab in order. */
export function moveTab(tabs: TabPref[], id: TabId, delta: number): TabPref[] {
  const index = tabs.findIndex(t => t.id === id);
  if (index < 0) return tabs;
  const target = index + delta;
  if (target < 0 || target >= tabs.length) return tabs;
  const next = [...tabs];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** Set one tab's priority, leaving the order alone. */
export function setPriority(tabs: TabPref[], id: TabId, priority: Priority): TabPref[] {
  return tabs.map(t => (t.id === id ? { ...t, priority } : t));
}

export function setEnabled(tabs: TabPref[], id: TabId, on: boolean): TabPref[] {
  return tabs.map(t => (t.id === id ? { ...t, on } : t));
}

/**
 * Display order: high priority first, then the patient's own order. The patient's
 * arrangement is the tie-break, so it is never lost.
 */
export function orderedTabs(tabs: TabPref[]): TabPref[] {
  return tabs
    .map((tab, index) => ({ tab, index }))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.tab.priority] - PRIORITY_RANK[b.tab.priority] || a.index - b.index
    )
    .map(({ tab }) => tab);
}

export function metaFor(id: TabId): TabMeta {
  return TAB_BY_ID.get(id) ?? TABS[0]!;
}

/** Visible tabs for one audience, in display order. */
export function visibleTabs(tabs: TabPref[], audience: 'patient' | 'nurse'): TabId[] {
  return orderedTabs(tabs)
    .filter(t => t.on && metaFor(t.id)[audience])
    .map(t => t.id);
}

/**
 * Turn the free-text answer from the initial assessment into a starting layout: the
 * topics the patient named are switched on and marked high priority.
 */
export function applyGoal(layout: Layout, goal: string): Layout {
  const text = goal.toLowerCase();
  const wanted = new Set<TabId>();
  const rules: Array<[RegExp, TabId]> = [
    [/\b(diet|dieting|eat|eating|food|meal|meals|nutrition|appetite|fluid|fluids|water|drink|drinking|weight)\b/, 'diet'],
    [/\b(sleep|sleeping|insomnia|rest|rested|nap|tired|fatigue)\b/, 'sleep'],
    [/\b(exercis\w*|workout|gym|fitness|fitter|stronger|train\w*|run|running|jog\w*|lift\w*|weights?|cycling|cycl\w*|swim\w*|yoga|danc\w*|hik\w*|move more|steps|walk\w*)\b/, 'exercise'],
    [/\b(learn|understand|curious|educat\w*|how my body works)\b/, 'twin'],
    [/\b(condition|symptom|symptoms|recover\w*|heal\w*|surgery|post-?op)\b/, 'check-ins'],
    [/\b(heart|blood pressure|bp|pulse|oxygen|temperature|fever|vital|vitals)\b/, 'vitals'],
    [/\b(medic|medicine|medication|pill|insulin|dose|doses|prescription)\b/, 'medications'],
    [/\b(pain|sore|swelling|swollen|ache|symptom|symptoms|check-?in)\b/, 'check-ins'],
    [/\b(lab|labs|blood test|result|results|record|chart|history)\b/, 'health-record'],
    [/\b(scan|scans|photo|3d|twin|model|body)\b/, 'twin'],
    [/\b(allerg|condition|diagnos|family history|surgery)\b/, 'history'],
    [/\b(walker|cane|crutch\w*|wheelchair|oxygen|cpap|hearing aids?|dentures|glasses|stocking\w*|equipment|devices?)\b/, 'devices'],
    [/\b(mood|moods|mental health|mental|anxiety|anxious|depress\w*|bipolar|panic|panic attacks?|stress(ed)?|worry|worrying|hopeless|calm|wellbeing|well-being|feeling low|feeling down|mind)\b/, 'mood'],
    [/\b(appointment\w*|schedule|calendar|visit|visits|clinic|appointment|follow-?up|check-?up|see the doctor)\b/, 'schedule'],
    [/\b(message|messages|messaging|chat|communicat\w*|stay in touch|talk to (my|the) (nurse|care team|family))\b/, 'messages'],
  ];
  for (const [re, id] of rules) {
    if (re.test(text)) wanted.add(id);
  }
  if (wanted.size === 0) return { ...layout, goal, assessed: true };

  // Named topics go to the front in the order the catalogue defines, all high priority.
  const promoted = TABS.map(t => t.id).filter(id => wanted.has(id));
  const rest = layout.tabs.filter(t => !wanted.has(t.id));
  const head = promoted.map(id => {
    const existing = layout.tabs.find(t => t.id === id);
    return { id, on: true, priority: 'high' as Priority, ...(existing ? {} : {}) };
  });
  return { tabs: [...head, ...rest], goal, assessed: true };
}

/**
 * Spoken and typed aliases for each tab, so "take me to the health tab" can be
 * resolved to a navigation target. Aliases are lowercase; the longest match wins,
 * so "mental health" beats "health".
 */
export const TAB_ALIASES: Record<TabId, string[]> = {
  'check-ins': ['check ins', 'check-ins', 'check in', 'check-in', 'symptoms', 'symptom check'],
  vitals: ['vital signs', 'vitals', 'vital', 'heart rate', 'blood pressure'],
  medications: ['medications', 'medication', 'medicines', 'medicine', 'meds', 'med', 'pills'],
  'health-record': ['health record', 'medical record', 'lab results', 'record', 'labs', 'lab', 'results', 'chart', 'health'],
  diet: ['diet', 'food', 'meals', 'meal', 'nutrition', 'eating'],
  sleep: ['sleep', 'rest'],
  exercise: ['exercise', 'workouts', 'workout', 'fitness', 'training'],
  twin: ['3d twin', '3d model', 'body model', 'twin', 'model', '3d'],
  history: ['health history', 'medical history', 'past conditions', 'history'],
  devices: ['devices', 'device', 'equipment'],
  assessment: ['nursing assessment', 'nurse assessment', 'assessment'],
  mood: ['mental health', 'mood', 'moods', 'feelings', 'anxiety', 'depression', 'mind'],
  schedule: ['appointments', 'appointment', 'schedule', 'calendar', 'visits', 'visit', 'agenda', 'day plan', 'bookings'],
  messages: ['messages', 'message', 'chat', 'conversation'],
};

/**
 * Verb phrases that make a sentence a navigation command rather than a question.
 * Deliberately specific: "my results show high glucose" must not trigger, while
 * "show me my results" must.
 */
const NAV_VERBS =
  /\b(?:take me (?:back )?to|bring me to|bring up|go to|goto|open(?: up| the| my| your)|show me|pull up|navigate to|jump to|switch to|head to|let me see)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Read a chat or voice message as a navigation command: "take me to the health
 * tab", "show me my appointments". Returns the tab to open, or null when the
 * message is an ordinary question for the agent.
 */
export function matchNavCommand(text: string): TabId | null {
  const norm = text.toLowerCase();
  if (!NAV_VERBS.test(norm)) return null;
  let bestId: TabId | null = null;
  let bestLength = -1;
  let bestOrder = Number.MAX_SAFE_INTEGER;
  for (let order = 0; order < TABS.length; order++) {
    const meta = TABS[order]!;
    for (const alias of TAB_ALIASES[meta.id]) {
      if (!new RegExp(`\\b${escapeRe(alias)}\\b`, 'i').test(norm)) continue;
      if (alias.length > bestLength || (alias.length === bestLength && order < bestOrder)) {
        bestId = meta.id;
        bestLength = alias.length;
        bestOrder = order;
      }
    }
  }
  return bestId;
}
