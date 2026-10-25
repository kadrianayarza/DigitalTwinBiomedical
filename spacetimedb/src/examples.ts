// Example check-ins so every seeded patient has a realistic recent history.
// Points use the twin's coordinates (meters, feet at y=0, facing +z, patient's right at -x).
// Elena's points follow the seated scan, which is SEATED_SCALE of standing height.

export type ExampleCheckIn = {
  minutesAgo: number;
  region: string;
  point: [number, number, number];
  severity: number;
  onset: string;
  provocation: string;
  quality: string;
  radiation: string;
  timing: string;
  swelling?: boolean;
  warmth?: boolean;
  redness?: boolean;
  bodyTempC?: number;
  notes: string;
};

const H = 60;

/**
 * Demo assistive devices per patient: [name, detail, since]. The name is matched against
 * the device library on seed, so 'Wheelchair' links to its entry and unknown equipment
 * falls back to the general assistive-device guidance.
 */
export const DEMO_DEVICES: Record<string, Array<[string, string, string]>> = {
  // Isak is recovering from a concussion and uses no equipment; the empty list is his chart too.
  'Isak Smith': [],
  'Maria Delgado': [],
  'Daniel Cho': [],
  'Priya Nair': [],
  'Kadrian Ayarza': [
    ['Front-wheeled walker', 'Height set by PT on day 1; rubber tips checked weekly', 'Day 1 after surgery'],
    ['Raised toilet seat', 'With armrests, bathroom only', 'Day 1 after surgery'],
  ],
  'Tom Becker': [
    ['Walking boot', 'Offloading boot for the left foot ulcer; dressing changes daily', 'Current'],
  ],
  'Mei Lin Wu': [
    ['Home oxygen', '2 L/min by nasal cannula, concentrator; at least 15 hours a day; backup tank for power cuts', '2019'],
  ],
  'Jesus Allejandro': [
    ['Compression stockings', 'Knee-high, 20-30 mmHg; on in the morning before the ankles swell', '2024'],
    ['Medical alert button', 'Worn at all times; daughter is the first emergency contact', '2023'],
  ],
  'Elena Novak': [
    ['Wheelchair', 'Manual chair with a gel cushion; pressure relief every 30 minutes', '2021'],
    ['Reacher', 'For dressing and picking things up from the floor', '2021'],
  ],
};

export type ExampleMhEntry = {
  kind: 'mood' | 'phq9' | 'gad7';
  /** mood: -3..3; phq9: 0..27; gad7: 0..21. */
  score: number;
  /** PHQ-9 item 9 answer, 0..3; stored 0 for other kinds. */
  item9?: number;
  /** Hours slept that day, for mood entries; 0 when not answered. */
  sleepHours?: number;
  notes?: string;
  hoursAgo: number;
  by?: string;
};

export type ExampleMentalHealth = {
  /** MED_PRESETS keys seeded onto the chart. */
  meds: string[];
  /** [lab slug, value, notes, hoursAgo] */
  labs?: Array<[string, number, string, number]>;
  /** [category, title, detail, whenText] */
  history?: Array<[string, string, string, string]>;
  entries: ExampleMhEntry[];
};

export type ExampleAppointment = {
  title: string;
  /** See APPT_KINDS. */
  kind: string;
  /** Days from today; negative days are past visits, which seed as completed. */
  days: number;
  hour: number;
  minute: number;
  durationMin: number;
  /** See APPT_MODES. */
  mode: string;
  location: string;
  notes?: string;
  /** See APPT_STATUSES. */
  status: string;
};

/**
 * Demo appointments per patient: a believable mix of completed visits behind today
 * and booked ones ahead (tomorrow, later this week, and further out so the monthly
 * grid has something to show). Seeded times use the demo timezone.
 */
export const EXAMPLE_APPOINTMENTS: Record<string, ExampleAppointment[]> = {
  'Kadrian Ayarza': [
    { title: 'Follow-up with Dr. Reyes', kind: 'follow_up', days: 2, hour: 10, minute: 30, durationMin: 30, mode: 'in_person', location: 'Riverside Orthopedics, Suite 210', notes: 'X-ray before the visit; bring the surgery folder', status: 'booked' },
    { title: 'Physical therapy', kind: 'therapy', days: -1, hour: 14, minute: 0, durationMin: 45, mode: 'in_person', location: 'Riverside Rehab, gym 2', notes: 'Week 2: quad sets and step-ups', status: 'done' },
    { title: 'Post-op day 7 check', kind: 'check_up', days: -4, hour: 9, minute: 0, durationMin: 30, mode: 'video', location: 'Video visit link', notes: 'Wound looked clean on camera', status: 'done' },
  ],
  'Isak Smith': [
    { title: 'Concussion follow-up', kind: 'follow_up', days: 5, hour: 13, minute: 0, durationMin: 30, mode: 'in_person', location: 'Riverside Neurology', notes: 'Bring the symptom diary', status: 'booked' },
    { title: 'Return-to-learn check', kind: 'consult', days: -6, hour: 11, minute: 0, durationMin: 15, mode: 'phone', location: 'Nurse line', status: 'done' },
  ],
  'Jesus Allejandro': [
    { title: 'Nurse weight-check call', kind: 'check_up', days: 1, hour: 9, minute: 30, durationMin: 15, mode: 'phone', location: 'Nurse line', notes: 'Daily weights from the scale app', status: 'booked' },
    { title: 'Cardiology review', kind: 'consult', days: 3, hour: 15, minute: 0, durationMin: 45, mode: 'video', location: 'Video visit link', notes: 'Weight trend and diuretic dose', status: 'booked' },
  ],
  'Tom Becker': [
    { title: 'Wound clinic', kind: 'follow_up', days: 2, hour: 11, minute: 0, durationMin: 30, mode: 'in_person', location: 'Riverside Wound Clinic', notes: 'Bring the glucose log', status: 'booked' },
    { title: 'Diabetes educator', kind: 'consult', days: 9, hour: 10, minute: 0, durationMin: 45, mode: 'in_person', location: 'Riverside Diabetes Center', status: 'booked' },
    { title: 'Podiatry wound care', kind: 'follow_up', days: -5, hour: 9, minute: 30, durationMin: 30, mode: 'in_person', location: 'Riverside Wound Clinic', status: 'done' },
  ],
  'Mei Lin Wu': [
    { title: 'Pulmonology review', kind: 'consult', days: 7, hour: 14, minute: 30, durationMin: 30, mode: 'video', location: 'Video visit link', notes: 'Spirometry results from last month', status: 'booked' },
    { title: 'Inhaler technique refresher', kind: 'therapy', days: -1, hour: 16, minute: 0, durationMin: 15, mode: 'video', location: 'Video visit link', status: 'done' },
  ],
  'Elena Novak': [
    { title: 'Pool therapy', kind: 'therapy', days: 1, hour: 13, minute: 0, durationMin: 45, mode: 'in_person', location: 'Riverside Aquatic Center', notes: 'Accessible pool entry', status: 'booked' },
    { title: 'Urology review', kind: 'consult', days: 10, hour: 11, minute: 30, durationMin: 30, mode: 'in_person', location: 'Riverside Urology', status: 'booked' },
    { title: 'Wheelchair clinic', kind: 'consult', days: -6, hour: 10, minute: 0, durationMin: 60, mode: 'in_person', location: 'VA Mobility Clinic', notes: 'Cushion pressure mapping', status: 'done' },
  ],
  'Maria Delgado': [
    { title: 'Lithium level draw', kind: 'lab', days: 1, hour: 8, minute: 30, durationMin: 15, mode: 'in_person', location: 'Riverside Lab, ground floor', notes: 'Twelve hours after the evening dose', status: 'booked' },
    { title: 'Psychiatry video visit', kind: 'consult', days: 6, hour: 11, minute: 0, durationMin: 45, mode: 'video', location: 'Video visit link', notes: 'Bring the mood chart', status: 'booked' },
    { title: 'CBT session', kind: 'therapy', days: -2, hour: 15, minute: 0, durationMin: 50, mode: 'video', location: 'Video visit link', status: 'done' },
  ],
  'Daniel Cho': [
    { title: 'Nurse safety check-in', kind: 'check_up', days: 1, hour: 9, minute: 0, durationMin: 15, mode: 'phone', location: 'Nurse line', notes: 'Follow-up on yesterday’s screening', status: 'booked' },
    { title: 'CBT session', kind: 'therapy', days: 7, hour: 13, minute: 0, durationMin: 50, mode: 'video', location: 'Video visit link', status: 'booked' },
    { title: 'Psychiatry med review', kind: 'consult', days: 4, hour: 15, minute: 0, durationMin: 30, mode: 'video', location: 'Video visit link', notes: 'Sertraline dose after four weeks', status: 'booked' },
    { title: 'CBT session', kind: 'therapy', days: -7, hour: 13, minute: 0, durationMin: 50, mode: 'video', location: 'Video visit link', status: 'done' },
  ],
  'Priya Nair': [
    { title: 'CBT session', kind: 'therapy', days: 3, hour: 17, minute: 0, durationMin: 50, mode: 'video', location: 'Video visit link', notes: 'Worry-window practice', status: 'booked' },
    { title: 'Annual physical', kind: 'check_up', days: 14, hour: 10, minute: 0, durationMin: 30, mode: 'in_person', location: 'Riverside Family Medicine', status: 'booked' },
    { title: 'CBT session', kind: 'therapy', days: -4, hour: 17, minute: 0, durationMin: 50, mode: 'video', location: 'Video visit link', status: 'done' },
  ],
};

/**
 * Demo mental-health patients and their screening history. Maria shows a bipolar
 * climb into an activation red flag; Daniel screens positive on PHQ-9 item 9 and
 * fires the crisis path (family and nurse are notified, crisis lines are pushed);
 * Priya stays in the moderate band so the trend view has a quiet comparison.
 */
export const DEMO_MENTAL_HEALTH: Record<string, ExampleMentalHealth> = {
  'Maria Delgado': {
    meds: ['lithium'],
    labs: [
      ['lithium-level', 0.9, 'Twice-daily dosing; drawn 12 hours after the evening dose', 20],
      ['creatinine', 0.8, 'Stable kidney function on lithium', 20],
    ],
    history: [
      ['medical', 'Bipolar I disorder', 'Diagnosed 2019; one hospitalization for mania in 2021; stable on lithium since', '2019'],
      ['social', 'Graphic designer', 'Lives with her partner; runs four mornings a week; no alcohol', ''],
    ],
    entries: [
      { kind: 'mood', score: -1, sleepHours: 7.5, notes: 'Low week after the argument with my sister', hoursAgo: 7 * 24 },
      { kind: 'phq9', score: 12, item9: 0, notes: 'Follow-up from the low side of the cycle', hoursAgo: 6 * 24 },
      { kind: 'mood', score: -1, sleepHours: 7, hoursAgo: 6 * 24 },
      { kind: 'mood', score: 0, sleepHours: 7, notes: 'Back to even', hoursAgo: 5 * 24 },
      { kind: 'mood', score: 1, sleepHours: 6.5, notes: 'More energy than usual, plans feel bigger', hoursAgo: 4 * 24 },
      { kind: 'mood', score: 2, sleepHours: 5, notes: 'Started a big new project, mind racing a little', hoursAgo: 3 * 24 },
      { kind: 'mood', score: 2, sleepHours: 4.5, notes: 'Only slept a few hours but feel wide awake', hoursAgo: 2 * 24 },
      { kind: 'mood', score: 3, sleepHours: 4, notes: 'Ideas coming fast; up late shopping online; my partner is worried', hoursAgo: 26 },
    ],
  },
  'Daniel Cho': {
    meds: ['sertraline'],
    labs: [],
    history: [
      ['medical', 'Major depressive disorder', 'Diagnosed 2023; generalized anxiety alongside; weekly CBT', '2023'],
      ['social', 'Graduate student', 'Lives alone; stopped going to class two weeks ago', ''],
    ],
    entries: [
      { kind: 'phq9', score: 16, item9: 0, notes: 'Dose increased; hard to get out of bed most days', hoursAgo: 6 * 24 },
      { kind: 'gad7', score: 14, item9: 0, notes: 'Panic before class; heart racing for no clear reason', hoursAgo: 3 * 24 },
      { kind: 'phq9', score: 21, item9: 2, notes: 'Struggling a lot the last few days; hard to see a way forward', hoursAgo: 1 },
    ],
  },
  'Priya Nair': {
    meds: ['sertraline'],
    labs: [],
    history: [
      ['medical', 'Generalized anxiety disorder', 'Diagnosed 2021; CBT tools help; caffeine way down', '2021'],
      ['social', 'Nurse educator', 'Two children; walks daily; no smoking', ''],
    ],
    entries: [
      { kind: 'gad7', score: 13, item9: 0, notes: 'Worse before a work presentation', hoursAgo: 5 * 24 },
      { kind: 'mood', score: 0, sleepHours: 7, notes: 'Even day; breathing exercises help', hoursAgo: 3 * 24 },
      { kind: 'gad7', score: 12, item9: 0, notes: 'Presentation went fine; already worrying about the next one', hoursAgo: 22 },
      { kind: 'mood', score: 0, sleepHours: 6.5, hoursAgo: 8 },
    ],
  },
};

export type ExampleAssessment = {
  system: string;
  status: string;
  findings: string;
  /** Twin region the nurse tapped, '' when assessed from the list. */
  region?: string;
  hoursAgo: number;
};

/**
 * Demo head-to-toe assessments. Kadrian has a complete pass (day 5 after knee
 * replacement, one abnormal finding on the operated limb); Elena's is mid-round,
 * so the panel shows both covered and not-yet-assessed systems.
 */
export const DEMO_ASSESSMENTS: Record<string, ExampleAssessment[]> = {
  'Kadrian Ayarza': [
    { system: 'neuro', status: 'normal', findings: 'Alert and oriented, speech clear, pupils equal and reactive, moves all limbs', hoursAgo: 3 },
    { system: 'heent', status: 'normal', findings: 'Pupils equal and reactive, membranes moist, airway clear', hoursAgo: 3 },
    { system: 'respiratory', status: 'normal', findings: 'Breath sounds clear and equal, no distress, rate within range', hoursAgo: 3 },
    { system: 'cardiovascular', status: 'normal', findings: 'Regular rhythm, pulses 2+, no new edema, refill brisk', hoursAgo: 3 },
    { system: 'gi', status: 'normal', findings: 'Bowel sounds present, abdomen soft, eating and drinking', hoursAgo: 3 },
    { system: 'gu', status: 'normal', findings: 'Voiding without complaint', hoursAgo: 3 },
    {
      system: 'msk',
      status: 'abnormal',
      findings: 'Right knee warm and mildly swollen, flexion to 90 degrees, incision clean and dry; full strength elsewhere',
      region: 'knee_r_anterior',
      hoursAgo: 3,
    },
    { system: 'skin', status: 'normal', findings: 'Incision clean; no pressure spots; skin warm and dry', hoursAgo: 3 },
    { system: 'psych', status: 'normal', findings: 'In good spirits, partner helping at home', hoursAgo: 3 },
  ],
  'Elena Novak': [
    {
      system: 'neuro',
      status: 'abnormal',
      findings: 'T6 sensory level, consistent with her baseline; no new deficits',
      hoursAgo: 1,
    },
    {
      system: 'skin',
      status: 'abnormal',
      findings: '2 cm non-blanching erythema over the sacrum, skin intact; pressure relief every 30 minutes',
      region: 'hip_posterior',
      hoursAgo: 1,
    },
    { system: 'gu', status: 'normal', findings: 'Bladder program on schedule, urine clear', hoursAgo: 1 },
    { system: 'msk', status: 'normal', findings: 'Full upper-body strength; transfers independently with a slide board', hoursAgo: 1 },
  ],
};

export const EXAMPLE_CHECK_INS: Record<string, ExampleCheckIn[]> = {
  'Kadrian Ayarza': [
    {
      minutesAgo: 50,
      region: 'knee_r_anterior',
      point: [-0.095, 0.5, 0.068],
      severity: 5,
      onset: 'Earlier today',
      provocation: 'Bending knee, Walking',
      quality: 'aching',
      radiation: 'Stays here',
      timing: 'Only when moving',
      swelling: true,
      notes: 'Sore after physical therapy. Iced for 20 min and took my pain pill. Got to about 90 degrees of bend.',
    },
    {
      minutesAgo: 14 * H,
      region: 'calf_r_posterior',
      point: [-0.095, 0.31, -0.06],
      severity: 3,
      onset: 'Yesterday',
      provocation: 'Walking',
      quality: 'cramping',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Feels like a muscle cramp and goes away when I stretch. No swelling that I can see.',
    },
    {
      minutesAgo: 27 * H,
      region: 'knee_r_medial',
      point: [-0.034, 0.48, 0.01],
      severity: 4,
      onset: '2+ days ago',
      provocation: 'At night, Standing up',
      quality: 'tight',
      radiation: 'Spreads down',
      timing: 'Comes and goes',
      swelling: true,
      notes: 'Stiff when I first get up. Incision looks clean and dry, no drainage.',
    },
  ],
  'Isak Smith': [
    {
      minutesAgo: 95,
      region: 'head_anterior',
      point: [0, 1.66, 0.1],
      severity: 4,
      onset: 'Earlier today',
      provocation: 'Standing up',
      quality: 'aching',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Headache came back after about an hour of screen time. Bright light still bothers me. No vomiting.',
    },
    {
      minutesAgo: 20 * H,
      region: 'neck_posterior',
      point: [0, 1.49, -0.05],
      severity: 3,
      onset: 'Yesterday',
      provocation: 'At rest',
      quality: 'tight',
      radiation: 'Spreads up',
      timing: 'Constant',
      notes: 'Neck tightness that goes up into the back of my head. Slept about 9 hours.',
    },
    {
      minutesAgo: 3 * 24 * H,
      region: 'head_anterior',
      point: [0.03, 1.65, 0.1],
      severity: 6,
      onset: '2+ days ago',
      provocation: 'Walking',
      quality: 'throbbing',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Felt foggy and a little dizzy after a short walk outside. Better after lying down in a dark room.',
    },
  ],
  'Jesus Allejandro': [
    {
      minutesAgo: 40,
      region: 'foot_r_anterior',
      point: [-0.095, 0.06, 0.09],
      severity: 2,
      onset: '2+ days ago',
      provocation: 'Standing up',
      quality: 'tight',
      radiation: 'Spreads up',
      timing: 'Constant',
      swelling: true,
      notes: 'Both ankles more swollen, shoes feel tight. Up 3 lb since Tuesday on my home scale.',
    },
    {
      minutesAgo: 9 * H,
      region: 'abdomen',
      point: [0, 1.06, 0.1],
      severity: 3,
      onset: 'Yesterday',
      provocation: 'At rest',
      quality: 'tight',
      radiation: 'Stays here',
      timing: 'Constant',
      notes: 'Belly feels full and bloated, eating less. Needed two pillows to sleep last night instead of one.',
    },
    {
      minutesAgo: 30 * H,
      region: 'calf_l_anterior',
      point: [0.095, 0.16, 0.05],
      severity: 2,
      onset: '2+ days ago',
      provocation: 'Walking',
      quality: 'aching',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      swelling: true,
      notes: 'Sock marks stay on my lower legs. Took my water pill this morning.',
    },
  ],
  'Tom Becker': [
    {
      minutesAgo: 70,
      region: 'foot_l_anterior',
      point: [0.095, 0.06, 0.11],
      severity: 2,
      onset: '2+ days ago',
      provocation: 'Walking',
      quality: 'aching',
      radiation: 'Stays here',
      timing: 'Only when moving',
      bodyTempC: 37.2,
      notes: 'Changed the dressing on the ball of my foot. Small amount of clear drainage, no smell. Wearing the offloading boot.',
    },
    {
      minutesAgo: 16 * H,
      region: 'calf_l_anterior',
      point: [0.095, 0.24, 0.05],
      severity: 3,
      onset: '2+ days ago',
      provocation: 'At night',
      quality: 'burning',
      radiation: 'Spreads down',
      timing: 'Comes and goes',
      notes: 'Usual burning and tingling in my shins and feet at night. Blood sugar 162 before dinner.',
    },
    {
      minutesAgo: 36 * H,
      region: 'foot_l_anterior',
      point: [0.1, 0.06, 0.1],
      severity: 1,
      onset: '2+ days ago',
      provocation: 'Touching it',
      quality: 'sharp',
      radiation: 'Stays here',
      timing: 'Only when moving',
      redness: true,
      notes: 'Wound edges look pink. A little redness right around it, about the same size as at the clinic.',
    },
  ],
  'Mei Lin Wu': [
    {
      minutesAgo: 30,
      region: 'chest',
      point: [0, 1.3, 0.11],
      severity: 4,
      onset: 'Earlier today',
      provocation: 'Walking',
      quality: 'tight',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Chest tight in the morning with a cough bringing up clear-white phlegm. Used my rescue inhaler once and it helped.',
    },
    {
      minutesAgo: 11 * H,
      region: 'back',
      point: [0, 1.25, -0.11],
      severity: 3,
      onset: 'Yesterday',
      provocation: 'At night',
      quality: 'aching',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Upper back sore from coughing. Using a heating pad.',
    },
    {
      minutesAgo: 2 * 24 * H,
      region: 'chest',
      point: [-0.04, 1.32, 0.11],
      severity: 2,
      onset: '2+ days ago',
      provocation: 'Walking',
      quality: 'tight',
      radiation: 'Stays here',
      timing: 'Only when moving',
      notes: 'A bit more winded than usual on the stairs, fine at rest. Did my breathing exercises.',
    },
  ],
  'Elena Novak': [
    {
      minutesAgo: 45,
      region: 'hip_posterior',
      point: [0, 0.66, -0.12],
      severity: 0,
      onset: 'Earlier today',
      provocation: '',
      quality: '',
      radiation: 'Stays here',
      timing: 'Constant',
      redness: true,
      notes: 'Caregiver saw a red spot over my tailbone that took about 30 min to fade after a pressure relief. Skin not broken. I can\'t feel it.',
    },
    {
      minutesAgo: 8 * H,
      region: 'shoulder_r_anterior',
      point: [-0.17, 0.95, 0.03],
      severity: 5,
      onset: '2+ days ago',
      provocation: 'Touching it',
      quality: 'aching',
      radiation: 'Spreads down',
      timing: 'Only when moving',
      notes: 'Right shoulder hurts after transfers and pushing up the ramp at work.',
    },
    {
      minutesAgo: 26 * H,
      region: 'thigh_l_anterior',
      point: [0.08, 0.53, 0.2],
      severity: 3,
      onset: 'Yesterday',
      provocation: 'At night',
      quality: 'cramping',
      radiation: 'Spreads down',
      timing: 'Comes and goes',
      notes: 'More leg spasms than usual last night, woke me up twice. Bladder routine on schedule.',
    },
  ],
  'Maria Delgado': [
    {
      minutesAgo: 6 * H,
      region: 'head_anterior',
      point: [0, 1.66, 0.1],
      severity: 3,
      onset: 'Yesterday',
      provocation: 'At rest',
      quality: 'pressing',
      radiation: 'Stays here',
      timing: 'Constant',
      bodyTempC: 36.9,
      notes: 'Head feels full and my thoughts will not slow down. Started the calm-down playlist my counselor gave me.',
    },
    {
      minutesAgo: 22 * H,
      region: 'shoulder_r_anterior',
      point: [-0.17, 0.95, 0.03],
      severity: 2,
      onset: '2+ days ago',
      provocation: 'At rest',
      quality: 'tight',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Shoulders up around my ears again; stretching helps a little.',
    },
    {
      minutesAgo: 3 * 24 * H,
      region: 'neck_posterior',
      point: [0, 1.49, -0.05],
      severity: 2,
      onset: '2+ days ago',
      provocation: 'At rest',
      quality: 'tight',
      radiation: 'Spreads up',
      timing: 'Comes and goes',
      notes: 'Neck tension building over the week; same as before my last high.',
    },
  ],
  'Daniel Cho': [
    {
      minutesAgo: 2 * H,
      region: 'head_anterior',
      point: [0.02, 1.64, 0.1],
      severity: 3,
      onset: '2+ days ago',
      provocation: '',
      quality: 'dull',
      radiation: 'Stays here',
      timing: 'Constant',
      bodyTempC: 36.6,
      notes: 'Heavy, foggy feeling most of the day. Sleeping a lot but still drained.',
    },
    {
      minutesAgo: 30 * H,
      region: 'chest',
      point: [0, 1.28, 0.1],
      severity: 3,
      onset: 'Yesterday',
      provocation: 'At rest',
      quality: 'tight',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Chest goes tight and heart races before class. Passed after about ten minutes of the breathing exercise.',
    },
    {
      minutesAgo: 5 * 24 * H,
      region: 'abdomen',
      point: [0, 1.02, 0.1],
      severity: 2,
      onset: '2+ days ago',
      provocation: 'Eating',
      quality: 'queasy',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Appetite is small; nausea after the dose increase. Toast and ginger tea help.',
    },
  ],
  'Priya Nair': [
    {
      minutesAgo: 4 * H,
      region: 'neck_posterior',
      point: [0, 1.49, -0.05],
      severity: 2,
      onset: 'Earlier today',
      provocation: 'At rest',
      quality: 'tight',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Neck tension during a busy morning. Twenty minutes of the walk helped.',
    },
    {
      minutesAgo: 18 * H,
      region: 'head_anterior',
      point: [-0.03, 1.63, 0.09],
      severity: 2,
      onset: 'Yesterday',
      provocation: 'At rest',
      quality: 'dull',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Worry headache after too much caffeine before the team meeting. Switched to water.',
    },
    {
      minutesAgo: 2 * 24 * H,
      region: 'shoulder_l_anterior',
      point: [0.17, 0.95, 0.03],
      severity: 1,
      onset: '2+ days ago',
      provocation: 'At rest',
      quality: 'tight',
      radiation: 'Stays here',
      timing: 'Comes and goes',
      notes: 'Slight shoulder tension; better after the stretching video.',
    },
  ],
};
