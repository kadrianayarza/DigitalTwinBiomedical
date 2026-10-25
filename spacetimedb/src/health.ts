// Health tracking catalog shared by the module and the client: every metric the Health view can
// show, how a day of samples rolls up, how it maps to Apple Health and Google Health, the
// wearable alert rules, and the demo history each seeded patient starts with.
// Values are stored in the canonical unit listed here; the client converts for display.

export type HealthCategory =
  | 'activity'
  | 'body'
  | 'cycle'
  | 'hearing'
  | 'heart'
  | 'medications'
  | 'mental'
  | 'mobility'
  | 'nutrition'
  | 'respiratory'
  | 'sleep'
  | 'vitals'
  | 'other';

/** How samples inside one day combine: totals, averages, last reading, or min-max spread. */
export type Agg = 'sum' | 'avg' | 'latest' | 'range' | 'count';

export type MetricDef = {
  id: string;
  label: string;
  category: HealthCategory;
  unit: string;
  agg: Agg;
  digits: number;
  /** Patients can add a reading by hand. */
  manual?: boolean;
  min: number;
  max: number;
  /** Optional display unit for US readers: shown = value * factor + offset. */
  display?: { unit: string; factor: number; offset?: number; digits?: number };
  /** Apple Health export record types, with how to read their values. */
  apple?: string[];
  /** Google Health API data type (kebab case) and the field prefix that holds the value. */
  google?: { dataType: string; via: 'dailyRollUp' | 'list'; pick: RegExp };
  about: string;
};

export const CATEGORIES: Array<{ id: HealthCategory; label: string }> = [
  { id: 'activity', label: 'Activity' },
  { id: 'body', label: 'Body Measurements' },
  { id: 'cycle', label: 'Cycle Tracking' },
  { id: 'hearing', label: 'Hearing' },
  { id: 'heart', label: 'Heart' },
  { id: 'medications', label: 'Medications' },
  { id: 'mental', label: 'Mental Wellbeing' },
  { id: 'mobility', label: 'Mobility' },
  { id: 'nutrition', label: 'Nutrition' },
  { id: 'respiratory', label: 'Respiratory' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'vitals', label: 'Vitals' },
  { id: 'other', label: 'Other Data' },
];

const KG_LB = { unit: 'lb', factor: 2.20462, digits: 1 };

export const METRICS: MetricDef[] = [
  // Activity
  { id: 'steps', label: 'Steps', category: 'activity', unit: 'steps', agg: 'sum', digits: 0, manual: true, min: 0, max: 100000,
    apple: ['HKQuantityTypeIdentifierStepCount'], google: { dataType: 'steps', via: 'dailyRollUp', pick: /^count/i },
    about: 'Steps counted by your phone or watch. Walking a little more each day is one of the best signs of recovery.' },
  { id: 'distance', label: 'Walking + Running Distance', category: 'activity', unit: 'km', agg: 'sum', digits: 2, min: 0, max: 200,
    display: { unit: 'mi', factor: 0.621371, digits: 2 },
    apple: ['HKQuantityTypeIdentifierDistanceWalkingRunning'], google: { dataType: 'distance', via: 'dailyRollUp', pick: /(millimeters|meters).*sum|sum/i },
    about: 'Distance covered on foot, estimated from steps and stride.' },
  { id: 'wheelchair_pushes', label: 'Pushes', category: 'activity', unit: 'pushes', agg: 'sum', digits: 0, manual: true, min: 0, max: 50000,
    apple: ['HKQuantityTypeIdentifierPushCount'],
    about: 'Wheelchair pushes counted by Apple Watch in wheelchair mode, in place of steps.' },
  { id: 'wheelchair_distance', label: 'Wheelchair Distance', category: 'activity', unit: 'km', agg: 'sum', digits: 2, min: 0, max: 200,
    display: { unit: 'mi', factor: 0.621371, digits: 2 }, apple: ['HKQuantityTypeIdentifierDistanceWheelchair'],
    about: 'Distance covered by wheelchair.' },
  { id: 'active_energy', label: 'Active Energy', category: 'activity', unit: 'kcal', agg: 'sum', digits: 0, min: 0, max: 10000,
    apple: ['HKQuantityTypeIdentifierActiveEnergyBurned'], google: { dataType: 'active-energy-burned', via: 'dailyRollUp', pick: /kilocalories|calories|sum/i },
    about: 'Energy burned through movement, above what your body uses at rest. This fills the Move ring.' },
  { id: 'resting_energy', label: 'Resting Energy', category: 'activity', unit: 'kcal', agg: 'sum', digits: 0, min: 0, max: 6000,
    apple: ['HKQuantityTypeIdentifierBasalEnergyBurned'], about: 'Energy your body uses at rest to breathe, circulate blood and keep warm.' },
  { id: 'exercise_minutes', label: 'Exercise Minutes', category: 'activity', unit: 'min', agg: 'sum', digits: 0, manual: true, min: 0, max: 1440,
    apple: ['HKQuantityTypeIdentifierAppleExerciseTime'], google: { dataType: 'active-minutes', via: 'dailyRollUp', pick: /minutes|sum/i },
    about: 'Minutes of brisk activity or more. This fills the Exercise ring.' },
  { id: 'stand_hours', label: 'Stand Hours', category: 'activity', unit: 'hr', agg: 'sum', digits: 0, min: 0, max: 24,
    apple: ['HKCategoryTypeIdentifierAppleStandHour'],
    about: 'Hours in which you stood and moved for at least a minute (roll hours in wheelchair mode). This fills the Stand ring.' },
  { id: 'flights_climbed', label: 'Flights Climbed', category: 'activity', unit: 'floors', agg: 'sum', digits: 0, min: 0, max: 500,
    apple: ['HKQuantityTypeIdentifierFlightsClimbed'], google: { dataType: 'floors', via: 'dailyRollUp', pick: /count|sum/i },
    about: 'Flights of stairs climbed, about 3 m (10 ft) of elevation each.' },
  { id: 'workouts', label: 'Workouts', category: 'activity', unit: 'min', agg: 'sum', digits: 0, manual: true, min: 0, max: 1440,
    about: 'Recorded workouts and therapy sessions, by duration.' },

  // Heart
  { id: 'heart_rate', label: 'Heart Rate', category: 'heart', unit: 'bpm', agg: 'range', digits: 0, manual: true, min: 25, max: 250,
    apple: ['HKQuantityTypeIdentifierHeartRate'],
    about: 'Beats per minute measured through the day by your watch. The daily view shows the range from lowest to highest.' },
  { id: 'resting_heart_rate', label: 'Resting Heart Rate', category: 'heart', unit: 'bpm', agg: 'avg', digits: 0, min: 25, max: 200,
    apple: ['HKQuantityTypeIdentifierRestingHeartRate'], google: { dataType: 'daily-resting-heart-rate', via: 'list', pick: /beatsPerMinute|bpm/i },
    about: 'Your average heart rate while still. A rise of 10 bpm or more over your usual can be an early sign of infection, dehydration or heart strain.' },
  { id: 'walking_heart_rate', label: 'Walking Heart Rate Average', category: 'heart', unit: 'bpm', agg: 'avg', digits: 0, min: 25, max: 220,
    apple: ['HKQuantityTypeIdentifierWalkingHeartRateAverage'], about: 'Average heart rate while walking during the day.' },
  { id: 'hrv', label: 'Heart Rate Variability', category: 'heart', unit: 'ms', agg: 'avg', digits: 0, min: 1, max: 300,
    apple: ['HKQuantityTypeIdentifierHeartRateVariabilitySDNN'], google: { dataType: 'daily-heart-rate-variability', via: 'list', pick: /milliseconds|rmssd|sdnn/i },
    about: 'Variation in time between heartbeats. Higher is generally a sign of recovery; it drops with stress, illness and poor sleep.' },
  { id: 'vo2_max', label: 'Cardio Fitness', category: 'heart', unit: 'mL/kg/min', agg: 'latest', digits: 1, min: 5, max: 90,
    apple: ['HKQuantityTypeIdentifierVO2Max'], google: { dataType: 'daily-vo2-max', via: 'list', pick: /vo2|millilit/i },
    about: 'Estimated VO₂ max: how well your heart and lungs deliver oxygen during exercise.' },
  { id: 'cardio_recovery', label: 'Cardio Recovery', category: 'heart', unit: 'bpm', agg: 'latest', digits: 0, min: 0, max: 120,
    apple: ['HKQuantityTypeIdentifierHeartRateRecoveryOneMinute'], about: 'How far your heart rate falls in the first minute after exercise.' },
  { id: 'irregular_rhythm', label: 'Irregular Rhythm Notifications', category: 'heart', unit: 'events', agg: 'count', digits: 0, min: 0, max: 1,
    apple: ['HKCategoryTypeIdentifierIrregularHeartRhythmEvent'],
    google: { dataType: 'irregular-rhythm-notification', via: 'list', pick: /./ },
    about: 'Your watch checks your rhythm in the background and notifies you if it sees signs of atrial fibrillation (AFib).' },
  { id: 'afib_burden', label: 'AFib History', category: 'heart', unit: '%', agg: 'latest', digits: 0, min: 0, max: 100,
    apple: ['HKQuantityTypeIdentifierAtrialFibrillationBurden'], about: 'Estimated share of the week spent in AFib, for people diagnosed with it.' },
  { id: 'ecg', label: 'Electrocardiograms (ECG)', category: 'heart', unit: 'recordings', agg: 'count', digits: 0, min: 0, max: 1,
    about: 'Single-lead ECG recordings taken on the watch, with their classification.' },

  // Respiratory
  { id: 'respiratory_rate', label: 'Respiratory Rate', category: 'respiratory', unit: 'breaths/min', agg: 'avg', digits: 1, manual: true, min: 4, max: 60,
    apple: ['HKQuantityTypeIdentifierRespiratoryRate'], google: { dataType: 'daily-respiratory-rate', via: 'list', pick: /breathsPerMinute|rate/i },
    about: 'Breaths per minute, measured by your watch while you sleep.' },
  { id: 'blood_oxygen', label: 'Blood Oxygen', category: 'respiratory', unit: '%', agg: 'avg', digits: 0, manual: true, min: 50, max: 100,
    apple: ['HKQuantityTypeIdentifierOxygenSaturation'], google: { dataType: 'daily-oxygen-saturation', via: 'list', pick: /percentage|percent|avg/i },
    about: 'Oxygen saturation (SpO₂). Most people sit at 95–100%. Readings under 90% should be reported to your care team.' },
  { id: 'breathing_disturbances', label: 'Breathing Disturbances', category: 'respiratory', unit: '/hr', agg: 'avg', digits: 1, min: 0, max: 100,
    apple: ['HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances'],
    about: 'Brief interruptions in normal breathing during sleep, per hour. Elevated levels can be a sign of sleep apnea.' },

  // Sleep
  { id: 'sleep_asleep', label: 'Time Asleep', category: 'sleep', unit: 'hr', agg: 'sum', digits: 1, manual: true, min: 0, max: 24,
    google: { dataType: 'sleep', via: 'list', pick: /minutesAsleep/i },
    about: 'Total sleep across all stages for the night.' },
  { id: 'sleep_deep', label: 'Deep Sleep', category: 'sleep', unit: 'hr', agg: 'sum', digits: 1, min: 0, max: 24, about: 'Slow-wave sleep, when the body does most of its physical repair.' },
  { id: 'sleep_core', label: 'Core Sleep', category: 'sleep', unit: 'hr', agg: 'sum', digits: 1, min: 0, max: 24, about: 'Light sleep, the bulk of most nights.' },
  { id: 'sleep_rem', label: 'REM Sleep', category: 'sleep', unit: 'hr', agg: 'sum', digits: 1, min: 0, max: 24, about: 'Dreaming sleep, linked with memory and mood.' },
  { id: 'sleep_awake', label: 'Awake', category: 'sleep', unit: 'hr', agg: 'sum', digits: 1, min: 0, max: 24, about: 'Time awake after first falling asleep.' },

  // Vitals
  { id: 'bp_systolic', label: 'Blood Pressure', category: 'vitals', unit: 'mmHg', agg: 'avg', digits: 0, manual: true, min: 50, max: 260,
    apple: ['HKQuantityTypeIdentifierBloodPressureSystolic'],
    about: 'Systolic (top) and diastolic (bottom) pressure from a connected cuff or entered by hand.' },
  { id: 'bp_diastolic', label: 'Diastolic Pressure', category: 'vitals', unit: 'mmHg', agg: 'avg', digits: 0, manual: true, min: 30, max: 160,
    apple: ['HKQuantityTypeIdentifierBloodPressureDiastolic'], about: 'The bottom number of a blood pressure reading.' },
  { id: 'body_temperature', label: 'Body Temperature', category: 'vitals', unit: '°C', agg: 'latest', digits: 1, manual: true, min: 30, max: 44,
    display: { unit: '°F', factor: 1.8, offset: 32, digits: 1 },
    apple: ['HKQuantityTypeIdentifierBodyTemperature'], google: { dataType: 'core-body-temperature', via: 'dailyRollUp', pick: /celsius|avg/i },
    about: 'Body temperature from a thermometer. 100.4 °F (38 °C) or higher is a fever.' },
  { id: 'wrist_temperature', label: 'Wrist Temperature', category: 'vitals', unit: '°C', agg: 'avg', digits: 2, min: 25, max: 42,
    display: { unit: '°F', factor: 1.8, offset: 32, digits: 1 },
    apple: ['HKQuantityTypeIdentifierAppleSleepingWristTemperature'],
    about: 'Overnight wrist temperature from the watch. Shifts from your baseline can accompany illness or the menstrual cycle.' },
  { id: 'blood_glucose', label: 'Blood Glucose', category: 'vitals', unit: 'mg/dL', agg: 'avg', digits: 0, manual: true, min: 20, max: 600,
    apple: ['HKQuantityTypeIdentifierBloodGlucose'], google: { dataType: 'blood-glucose', via: 'dailyRollUp', pick: /milligrams|mg|avg/i },
    about: 'Glucose from a meter or continuous glucose monitor. Typical targets are 80–130 mg/dL before meals and under 180 after.' },

  // Body
  { id: 'weight', label: 'Weight', category: 'body', unit: 'kg', agg: 'latest', digits: 1, manual: true, min: 20, max: 350, display: KG_LB,
    apple: ['HKQuantityTypeIdentifierBodyMass'], google: { dataType: 'weight', via: 'dailyRollUp', pick: /(grams|kilograms).*avg|avg|grams/i },
    about: 'Body weight. For heart failure, a gain of 2 lb (0.9 kg) in a day or 5 lb (2.3 kg) in a week can mean fluid is building up.' },
  { id: 'bmi', label: 'Body Mass Index', category: 'body', unit: 'BMI', agg: 'latest', digits: 1, min: 8, max: 80,
    apple: ['HKQuantityTypeIdentifierBodyMassIndex'], about: 'Weight relative to height.' },
  { id: 'body_fat', label: 'Body Fat Percentage', category: 'body', unit: '%', agg: 'latest', digits: 1, manual: true, min: 2, max: 75,
    apple: ['HKQuantityTypeIdentifierBodyFatPercentage'], google: { dataType: 'body-fat', via: 'dailyRollUp', pick: /percent|avg/i },
    about: 'Estimated share of body weight that is fat, from a smart scale.' },
  { id: 'lean_body_mass', label: 'Lean Body Mass', category: 'body', unit: 'kg', agg: 'latest', digits: 1, min: 10, max: 200, display: KG_LB,
    apple: ['HKQuantityTypeIdentifierLeanBodyMass'], about: 'Body weight minus fat.' },
  { id: 'height', label: 'Height', category: 'body', unit: 'cm', agg: 'latest', digits: 0, manual: true, min: 50, max: 250,
    display: { unit: 'in', factor: 0.393701, digits: 0 }, apple: ['HKQuantityTypeIdentifierHeight'], about: 'Standing height.' },
  { id: 'waist', label: 'Waist Circumference', category: 'body', unit: 'cm', agg: 'latest', digits: 0, manual: true, min: 30, max: 250,
    display: { unit: 'in', factor: 0.393701, digits: 1 }, apple: ['HKQuantityTypeIdentifierWaistCircumference'], about: 'Measured around the navel.' },

  // Mobility
  { id: 'walking_speed', label: 'Walking Speed', category: 'mobility', unit: 'km/h', agg: 'avg', digits: 1, min: 0, max: 15,
    display: { unit: 'mph', factor: 0.621371, digits: 1 }, apple: ['HKQuantityTypeIdentifierWalkingSpeed'],
    about: 'Average speed on flat ground, measured by your iPhone in a pocket. One of the strongest signs of overall mobility.' },
  { id: 'step_length', label: 'Walking Step Length', category: 'mobility', unit: 'cm', agg: 'avg', digits: 0, min: 10, max: 150,
    display: { unit: 'in', factor: 0.393701, digits: 0 }, apple: ['HKQuantityTypeIdentifierWalkingStepLength'], about: 'Distance from one foot to the other per step.' },
  { id: 'double_support', label: 'Double Support Time', category: 'mobility', unit: '%', agg: 'avg', digits: 1, min: 0, max: 100,
    apple: ['HKQuantityTypeIdentifierWalkingDoubleSupportPercentage'],
    about: 'Share of each step with both feet on the ground. It rises when balance or confidence is low.' },
  { id: 'walking_asymmetry', label: 'Walking Asymmetry', category: 'mobility', unit: '%', agg: 'avg', digits: 0, min: 0, max: 100,
    apple: ['HKQuantityTypeIdentifierWalkingAsymmetryPercentage'],
    about: 'Share of steps where one leg moves faster than the other. After joint surgery, this should fall week by week.' },
  { id: 'walking_steadiness', label: 'Walking Steadiness', category: 'mobility', unit: '%', agg: 'latest', digits: 0, min: 0, max: 100,
    apple: ['HKQuantityTypeIdentifierAppleWalkingSteadiness'], about: 'Estimated stability while walking; low steadiness means a higher risk of falling.' },
  { id: 'six_minute_walk', label: 'Six-Minute Walk', category: 'mobility', unit: 'm', agg: 'latest', digits: 0, manual: true, min: 0, max: 1200,
    display: { unit: 'ft', factor: 3.28084, digits: 0 }, apple: ['HKQuantityTypeIdentifierSixMinuteWalkTestDistance'],
    about: 'Estimated distance you could walk on flat ground in six minutes, a standard test of heart and lung fitness.' },

  // Nutrition
  { id: 'water', label: 'Water', category: 'nutrition', unit: 'mL', agg: 'sum', digits: 0, manual: true, min: 0, max: 10000,
    display: { unit: 'fl oz', factor: 0.033814, digits: 0 },
    apple: ['HKQuantityTypeIdentifierDietaryWater'], google: { dataType: 'hydration-log', via: 'dailyRollUp', pick: /milliliters|liters|sum/i },
    about: 'Fluids logged through the day. Some heart and kidney plans limit total fluid, often to about 2 L (68 fl oz).' },
  { id: 'dietary_energy', label: 'Dietary Energy', category: 'nutrition', unit: 'kcal', agg: 'sum', digits: 0, manual: true, min: 0, max: 15000,
    apple: ['HKQuantityTypeIdentifierDietaryEnergyConsumed'], google: { dataType: 'nutrition-log', via: 'dailyRollUp', pick: /energy|kilocalories|calories/i },
    about: 'Calories eaten and drunk.' },
  { id: 'protein', label: 'Protein', category: 'nutrition', unit: 'g', agg: 'sum', digits: 0, manual: true, min: 0, max: 1000,
    apple: ['HKQuantityTypeIdentifierDietaryProtein'], about: 'Protein supports wound healing and muscle recovery.' },
  { id: 'carbohydrates', label: 'Carbohydrates', category: 'nutrition', unit: 'g', agg: 'sum', digits: 0, manual: true, min: 0, max: 2000,
    apple: ['HKQuantityTypeIdentifierDietaryCarbohydrates'], about: 'Carbohydrates have the biggest effect on blood glucose.' },
  { id: 'sodium', label: 'Sodium', category: 'nutrition', unit: 'mg', agg: 'sum', digits: 0, manual: true, min: 0, max: 20000,
    apple: ['HKQuantityTypeIdentifierDietarySodium'], about: 'Salt. Heart failure plans usually aim for under 2,000 mg a day.' },
  { id: 'caffeine', label: 'Caffeine', category: 'nutrition', unit: 'mg', agg: 'sum', digits: 0, manual: true, min: 0, max: 2000,
    apple: ['HKQuantityTypeIdentifierDietaryCaffeine'], about: 'Caffeine from coffee, tea and other drinks.' },

  // Mental wellbeing
  { id: 'mood', label: 'State of Mind', category: 'mental', unit: 'mood', agg: 'avg', digits: 1, manual: true, min: -3, max: 3,
    about: 'How you feel right now or about your day, from very unpleasant (−3) to very pleasant (+3).' },
  { id: 'mindful_minutes', label: 'Mindful Minutes', category: 'mental', unit: 'min', agg: 'sum', digits: 0, manual: true, min: 0, max: 1440,
    apple: ['HKCategoryTypeIdentifierMindfulSession'], about: 'Time spent on breathing, meditation or reflection.' },

  // Hearing
  { id: 'environmental_audio', label: 'Environmental Sound Levels', category: 'hearing', unit: 'dB', agg: 'avg', digits: 0, min: 0, max: 140,
    apple: ['HKQuantityTypeIdentifierEnvironmentalAudioExposure'], about: 'Average loudness around you. Long exposure above 80 dB can damage hearing.' },
  { id: 'headphone_audio', label: 'Headphone Audio Levels', category: 'hearing', unit: 'dB', agg: 'avg', digits: 0, min: 0, max: 140,
    apple: ['HKQuantityTypeIdentifierHeadphoneAudioExposure'], about: 'Average headphone volume. After a concussion, quieter is usually better.' },

  // Cycle tracking
  { id: 'menstrual_flow', label: 'Period', category: 'cycle', unit: 'flow', agg: 'latest', digits: 0, manual: true, min: 0, max: 4,
    apple: ['HKCategoryTypeIdentifierMenstrualFlow'], about: 'Logged period days and flow, used to predict your next cycle.' },

  // Medications
  { id: 'medication', label: 'Medications', category: 'medications', unit: 'doses', agg: 'count', digits: 0, manual: true, min: 0, max: 1,
    about: 'Doses logged as taken or skipped.' },

  // Other
  { id: 'time_in_daylight', label: 'Time in Daylight', category: 'other', unit: 'min', agg: 'sum', digits: 0, min: 0, max: 1440,
    apple: ['HKQuantityTypeIdentifierTimeInDaylight'], about: 'Minutes spent outdoors in daylight.' },
  { id: 'handwashing', label: 'Handwashing', category: 'other', unit: 'times', agg: 'count', digits: 0, min: 0, max: 1,
    apple: ['HKCategoryTypeIdentifierHandwashingEvent'], about: 'Handwashing events detected by your watch. Clean hands protect a healing wound.' },
  { id: 'toothbrushing', label: 'Toothbrushing', category: 'other', unit: 'times', agg: 'count', digits: 0, min: 0, max: 1,
    apple: ['HKCategoryTypeIdentifierToothbrushingEvent'], about: 'Toothbrushing sessions from a connected brush.' },
  { id: 'uv_exposure', label: 'UV Index', category: 'other', unit: 'UV', agg: 'avg', digits: 0, min: 0, max: 20,
    apple: ['HKQuantityTypeIdentifierUVExposure'], about: 'UV index you were exposed to.' },
];

export const METRIC: Record<string, MetricDef> = Object.fromEntries(METRICS.map(m => [m.id, m]));

export const FLOW_LABEL = ['None', 'Spotting', 'Light', 'Medium', 'Heavy'];
export const MOOD_LABEL: Record<number, string> = {
  [-3]: 'Very unpleasant',
  [-2]: 'Unpleasant',
  [-1]: 'Slightly unpleasant',
  0: 'Neutral',
  1: 'Slightly pleasant',
  2: 'Pleasant',
  3: 'Very pleasant',
};

/** Connected sources a patient can add. `demo` kinds simulate a paired device for the demo. */
export const DEVICE_KINDS: Record<string, { name: string; source: string; metrics: string[] }> = {
  apple_watch: {
    name: 'Apple Watch',
    source: 'apple_health',
    metrics: ['steps', 'distance', 'active_energy', 'resting_energy', 'exercise_minutes', 'stand_hours', 'flights_climbed', 'heart_rate',
      'resting_heart_rate', 'walking_heart_rate', 'hrv', 'vo2_max', 'respiratory_rate', 'blood_oxygen', 'breathing_disturbances',
      'sleep_asleep', 'sleep_deep', 'sleep_core', 'sleep_rem', 'sleep_awake', 'wrist_temperature', 'walking_speed', 'step_length',
      'double_support', 'walking_asymmetry', 'walking_steadiness', 'six_minute_walk', 'environmental_audio', 'headphone_audio',
      'time_in_daylight', 'handwashing'],
  },
  fitbit: {
    name: 'Fitbit',
    source: 'google_health',
    metrics: ['steps', 'distance', 'active_energy', 'exercise_minutes', 'flights_climbed', 'heart_rate', 'resting_heart_rate', 'hrv',
      'vo2_max', 'respiratory_rate', 'blood_oxygen', 'sleep_asleep', 'sleep_deep', 'sleep_core', 'sleep_rem', 'sleep_awake'],
  },
  pixel_watch: {
    name: 'Pixel Watch',
    source: 'google_health',
    metrics: ['steps', 'distance', 'active_energy', 'exercise_minutes', 'flights_climbed', 'heart_rate', 'resting_heart_rate', 'hrv',
      'vo2_max', 'respiratory_rate', 'blood_oxygen', 'sleep_asleep', 'sleep_deep', 'sleep_core', 'sleep_rem', 'sleep_awake'],
  },
  iphone: {
    name: 'iPhone',
    source: 'apple_health',
    metrics: ['steps', 'distance', 'flights_climbed', 'walking_speed', 'step_length', 'double_support', 'walking_asymmetry',
      'walking_steadiness', 'six_minute_walk', 'headphone_audio'],
  },
  smart_scale: { name: 'Smart scale', source: 'apple_health', metrics: ['weight', 'bmi', 'body_fat', 'lean_body_mass'] },
  bp_cuff: { name: 'Blood pressure cuff', source: 'apple_health', metrics: ['bp_systolic', 'bp_diastolic', 'heart_rate'] },
  glucose_monitor: { name: 'Glucose monitor', source: 'apple_health', metrics: ['blood_glucose'] },
};

// ---------------------------------------------------------------------------
// Wearable alert rules
// ---------------------------------------------------------------------------

export type HealthPoint = { metric: string; value: number; label: string; at: number /* micros */ };
export type HealthRuleHit = { code: string; priority: string };

const HOUR = 3_600_000_000;
const DAY = 24 * HOUR;

/** Rules over one patient's wearable and logged health data (any order). `now` in micros. */
export function healthRules(points: HealthPoint[], now: number): HealthRuleHit[] {
  const hits: HealthRuleHit[] = [];
  const series = (m: string) => points.filter(p => p.metric === m).sort((a, b) => a.at - b.at);

  const weight = series('weight');
  const lastW = weight[weight.length - 1];
  if (lastW && now - lastW.at < 2 * DAY) {
    const dayBefore = weight.filter(p => lastW.at - p.at >= 18 * HOUR && lastW.at - p.at <= 36 * HOUR);
    const weekBefore = weight.filter(p => p !== lastW && lastW.at - p.at <= 7 * DAY);
    const gainDay = dayBefore.length ? lastW.value - dayBefore[dayBefore.length - 1].value : 0;
    const gainWeek = weekBefore.length ? lastW.value - Math.min(...weekBefore.map(p => p.value)) : 0;
    if (gainDay >= 0.9 || gainWeek >= 2.3) hits.push({ code: 'WEIGHT_GAIN', priority: 'same_day' });
  }

  const rhr = series('resting_heart_rate');
  const lastR = rhr[rhr.length - 1];
  if (lastR && now - lastR.at < 2 * DAY) {
    const base = rhr.filter(p => lastR.at - p.at > 12 * HOUR && lastR.at - p.at <= 8 * DAY);
    if (base.length >= 4) {
      const mean = base.reduce((s, p) => s + p.value, 0) / base.length;
      if (lastR.value - mean >= 10) hits.push({ code: 'RESTING_HR_RISE', priority: 'review_24h' });
    }
  }

  const spo2 = series('blood_oxygen');
  const lastS = spo2[spo2.length - 1];
  if (lastS && now - lastS.at < DAY && lastS.value < 90) hits.push({ code: 'WEARABLE_LOW_SPO2', priority: 'same_day' });

  if (series('irregular_rhythm').some(p => now - p.at < DAY)) hits.push({ code: 'IRREGULAR_RHYTHM', priority: 'review_24h' });

  const glucose = series('blood_glucose');
  const lastG = glucose[glucose.length - 1];
  if (lastG && now - lastG.at < DAY && (lastG.value < 70 || lastG.value > 300)) {
    hits.push({ code: 'GLUCOSE_OUT_OF_RANGE', priority: 'same_day' });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Demo history for the seeded patients
// ---------------------------------------------------------------------------

export type DemoSample = { metric: string; value: number; label: string; minutesAgo: number; device: string; source: string };
export type DemoMedication = { name: string; dose: string; schedule: string };
export type DemoDevice = { kind: string; name: string };

export type DemoProfile = { devices: DemoDevice[]; medications: DemoMedication[]; history: (rand: () => number) => DemoSample[] };

export const DEMO_DAYS = 28;

/** Linear ramp: `a` on `from` days ago to `b` on `to` days ago, flat outside. */
function ramp(day: number, from: number, to: number, a: number, b: number) {
  if (day >= from) return a;
  if (day <= to) return b;
  return a + ((from - day) / (from - to)) * (b - a);
}

type Gen = (day: number) => number | null;

/** Daily samples at wake time (sleep) or late afternoon (everything else), `day` days ago. */
function daily(
  out: DemoSample[],
  device: DemoDevice,
  rand: () => number,
  spec: Record<string, [Gen, number]>
) {
  const source = DEVICE_KINDS[device.kind]?.source ?? 'demo';
  for (let day = DEMO_DAYS - 1; day >= 0; day--) {
    for (const [metric, [gen, jitter]] of Object.entries(spec)) {
      const base = gen(day);
      if (base === null) continue;
      const m = METRIC[metric];
      let value = base * (1 + (rand() * 2 - 1) * jitter);
      // Today's running totals are partial.
      if (day === 0 && m.agg === 'sum' && m.category !== 'sleep') value *= 0.55;
      value = Math.max(m.min, Math.min(m.max, value));
      const wake = m.category === 'sleep' || metric === 'respiratory_rate' || metric === 'wrist_temperature' || metric === 'breathing_disturbances';
      const minutesAgo = day * 1440 + (wake ? 300 : day === 0 ? 20 : 120);
      out.push({ metric, value: round(value, m.digits + 1), label: '', minutesAgo, device: device.name, source });
    }
  }
}

function sleepNights(out: DemoSample[], device: DemoDevice, rand: () => number, hours: Gen, awake: Gen) {
  const source = DEVICE_KINDS[device.kind]?.source ?? 'demo';
  for (let day = DEMO_DAYS - 1; day >= 0; day--) {
    const h = hours(day);
    if (h === null) continue;
    const total = h * (1 + (rand() * 2 - 1) * 0.08);
    const deep = total * (0.13 + rand() * 0.05);
    const rem = total * (0.2 + rand() * 0.05);
    const core = total - deep - rem;
    const minutesAgo = day * 1440 + 300;
    const push = (metric: string, v: number) =>
      out.push({ metric, value: round(v, 2), label: '', minutesAgo, device: device.name, source });
    push('sleep_asleep', total);
    push('sleep_deep', deep);
    push('sleep_core', core);
    push('sleep_rem', rem);
    push('sleep_awake', (awake(day) ?? 0.4) * (0.8 + rand() * 0.4));
  }
}

/** Hourly heart rate for the last two days, following a day/night curve. */
function heartRateHours(out: DemoSample[], device: DemoDevice, rand: () => number, resting: number, peak: number) {
  const source = DEVICE_KINDS[device.kind]?.source ?? 'demo';
  for (let h = 47; h >= 0; h--) {
    const hourOfDay = (24 + 17 - h) % 24; // samples are anchored to late afternoon "now"
    const awake = hourOfDay >= 7 && hourOfDay <= 22;
    const activity = awake ? Math.max(0, Math.sin(((hourOfDay - 7) / 15) * Math.PI)) : 0;
    const v = resting + (awake ? 8 : -3) + activity * (peak - resting) * (0.4 + rand() * 0.6);
    out.push({ metric: 'heart_rate', value: Math.round(v), label: '', minutesAgo: h * 60 + 10, device: device.name, source });
  }
}

function doses(out: DemoSample[], meds: DemoMedication[], missed: Array<[string, number]>, device: string) {
  for (let day = 6; day >= 0; day--) {
    for (const med of meds) {
      const times = med.schedule === 'Twice daily' ? [20 * 60, 8 * 60] : med.schedule === 'Three times daily' ? [22 * 60, 14 * 60, 6 * 60] : med.schedule === 'Once daily' ? [10 * 60] : [];
      for (const t of times) {
        const minutesAgo = day * 1440 + t;
        if (day === 0 && t < 120) continue;
        const skipped = missed.some(([name, d]) => name === med.name && d === day);
        out.push({ metric: 'medication', value: skipped ? 0 : 1, label: med.name, minutesAgo, device, source: 'manual' });
      }
    }
  }
}

function events(out: DemoSample[], metric: string, list: Array<[number, number, string?]>, device: string, source: string) {
  for (const [minutesAgo, value, label] of list) out.push({ metric, value, label: label ?? '', minutesAgo, device, source });
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const flat = (v: number): Gen => () => v;

const KADRIAN_MEDS: DemoMedication[] = [
  { name: 'Acetaminophen 1,000 mg', dose: '2 tablets', schedule: 'Three times daily' },
  { name: 'Aspirin 81 mg', dose: '1 tablet (clot prevention)', schedule: 'Twice daily' },
  { name: 'Oxycodone 5 mg', dose: '1 tablet', schedule: 'As needed' },
];
const ISAK_MEDS: DemoMedication[] = [{ name: 'Acetaminophen 500 mg', dose: '2 tablets', schedule: 'As needed' }];
const JESUS_MEDS: DemoMedication[] = [
  { name: 'Furosemide 40 mg', dose: '1 tablet in the morning', schedule: 'Once daily' },
  { name: 'Carvedilol 12.5 mg', dose: '1 tablet with food', schedule: 'Twice daily' },
  { name: 'Sacubitril/valsartan 49/51 mg', dose: '1 tablet', schedule: 'Twice daily' },
  { name: 'Spironolactone 25 mg', dose: '1 tablet', schedule: 'Once daily' },
];
const TOM_MEDS: DemoMedication[] = [
  { name: 'Metformin 1,000 mg', dose: '1 tablet with meals', schedule: 'Twice daily' },
  { name: 'Insulin glargine', dose: '24 units at bedtime', schedule: 'Once daily' },
  { name: 'Cephalexin 500 mg', dose: '1 capsule (wound infection)', schedule: 'Three times daily' },
];
const MEI_MEDS: DemoMedication[] = [
  { name: 'Tiotropium inhaler', dose: '2 puffs', schedule: 'Once daily' },
  { name: 'Budesonide/formoterol inhaler', dose: '2 puffs', schedule: 'Twice daily' },
  { name: 'Albuterol inhaler', dose: '2 puffs for breathlessness', schedule: 'As needed' },
];
const ELENA_MEDS: DemoMedication[] = [
  { name: 'Baclofen 10 mg', dose: '1 tablet for spasticity', schedule: 'Three times daily' },
  { name: 'Oxybutynin 5 mg', dose: '1 tablet', schedule: 'Twice daily' },
];
const MARIA_MEDS: DemoMedication[] = [
  { name: 'Lithium 300 mg', dose: '2 tablets', schedule: 'Twice daily' },
];
const DANIEL_MEDS: DemoMedication[] = [
  { name: 'Sertraline 50 mg', dose: '1 tablet', schedule: 'Once daily' },
];
const PRIYA_MEDS: DemoMedication[] = [
  { name: 'Sertraline 50 mg', dose: '1 tablet', schedule: 'Once daily' },
];

const TYPICAL: Record<string, [Gen, number]> = {
  steps: [flat(6500), 0.15],
  distance: [flat(4.6), 0.15],
  active_energy: [flat(350), 0.12],
  resting_energy: [flat(1600), 0.03],
  exercise_minutes: [flat(24), 0.3],
  stand_hours: [flat(10), 0.1],
  flights_climbed: [flat(6), 0.3],
  resting_heart_rate: [flat(66), 0.03],
  walking_heart_rate: [flat(100), 0.03],
  hrv: [flat(45), 0.1],
  vo2_max: [d => (d % 4 === 0 ? 38 : null), 0.01],
  respiratory_rate: [flat(15), 0.04],
  blood_oxygen: [flat(97), 0.008],
  breathing_disturbances: [flat(5), 0.15],
  wrist_temperature: [flat(35.9), 0.003],
  walking_speed: [flat(4.5), 0.05],
  step_length: [flat(68), 0.04],
  double_support: [flat(28), 0.03],
  walking_asymmetry: [flat(3), 0.2],
  walking_steadiness: [d => (d % 7 === 0 ? 90 : null), 0.02],
  six_minute_walk: [d => (d % 7 === 0 ? 470 : null), 0.02],
  environmental_audio: [flat(65), 0.06],
  headphone_audio: [flat(70), 0.06],
  time_in_daylight: [flat(45), 0.3],
  handwashing: [flat(5), 0.3],
  weight: [d => (d % 3 === 0 ? 75 : null), 0.004],
  bmi: [d => (d % 3 === 0 ? 24.8 : null), 0.004],
  body_fat: [d => (d % 3 === 0 ? 24 : null), 0.01],
  lean_body_mass: [d => (d % 3 === 0 ? 57 : null), 0.004],
  bp_systolic: [flat(122), 0.04],
  bp_diastolic: [flat(78), 0.04],
  blood_glucose: [flat(105), 0.1],
};

/** Four weeks of typical readings for a demo device paired live, limited to what it measures. */
export function pairedDeviceHistory(kind: string, name: string, rand: () => number): DemoSample[] {
  const k = DEVICE_KINDS[kind];
  if (!k) return [];
  const out: DemoSample[] = [];
  const device = { kind, name };
  const spec = Object.fromEntries(Object.entries(TYPICAL).filter(([m]) => k.metrics.includes(m)));
  daily(out, device, rand, spec);
  if (k.metrics.includes('sleep_asleep')) sleepNights(out, device, rand, flat(7.2), flat(0.5));
  if (k.metrics.includes('heart_rate') && kind !== 'bp_cuff') heartRateHours(out, device, rand, 66, 110);
  return out;
}

/** Compact day-by-day digest of the clinically useful home data, for the triage draft and agents. */
export function healthDigest(points: HealthPoint[], now: number, days = 7) {
  const keys = ['weight', 'resting_heart_rate', 'blood_oxygen', 'respiratory_rate', 'steps', 'wheelchair_pushes', 'sleep_asleep',
    'blood_glucose', 'bp_systolic', 'bp_diastolic', 'hrv', 'walking_asymmetry', 'water', 'sodium'];
  const out: Record<string, Array<number | null>> = {};
  for (const key of keys) {
    const m = METRIC[key];
    const byDay: Array<number | null> = [];
    let any = false;
    for (let d = days - 1; d >= 0; d--) {
      const xs = points
        .filter(p => p.metric === key && now - p.at >= d * DAY && now - p.at < (d + 1) * DAY)
        .sort((a, b) => a.at - b.at)
        .map(p => p.value);
      if (xs.length === 0) {
        byDay.push(null);
        continue;
      }
      any = true;
      const v = m.agg === 'sum' ? xs.reduce((s, x) => s + x, 0) : m.agg === 'latest' ? xs[xs.length - 1] : xs.reduce((s, x) => s + x, 0) / xs.length;
      byDay.push(round(v, m.digits));
    }
    if (any) out[`${key}_${m.unit.replace(/[^a-z%]/gi, '') || 'value'}`] = byDay;
  }
  const doses = points.filter(p => p.metric === 'medication' && now - p.at < days * DAY);
  const missed = doses.filter(p => p.value === 0).map(p => p.label);
  return {
    note: `Daily values for the last ${days} days, oldest first; null means no reading`,
    daily: out,
    medication_doses_logged: doses.length,
    medication_doses_missed: missed,
    irregular_rhythm_notifications: points.filter(p => p.metric === 'irregular_rhythm' && now - p.at < 30 * DAY).length,
  };
}

export const DEMO_HEALTH: Record<string, DemoProfile> = {
  // Right knee replacement 5 days ago: activity collapses at surgery and climbs back; gait asymmetric.
  'Kadrian Ayarza': {
    devices: [{ kind: 'apple_watch', name: 'Apple Watch Series 10' }],
    medications: KADRIAN_MEDS,
    history: rand => {
      const out: DemoSample[] = [];
      const w = { kind: 'apple_watch', name: 'Apple Watch Series 10' };
      const post = (pre: number, at5: number, now: number): Gen => d => (d > 5 ? pre : ramp(d, 5, 0, at5, now));
      daily(out, w, rand, {
        steps: [post(9200, 450, 3100), 0.12],
        distance: [post(6.8, 0.3, 2.0), 0.12],
        active_energy: [post(560, 90, 240), 0.1],
        resting_energy: [flat(1750), 0.03],
        exercise_minutes: [post(42, 0, 14), 0.25],
        stand_hours: [post(12, 3, 8), 0.1],
        flights_climbed: [post(9, 0, 1), 0.3],
        resting_heart_rate: [post(56, 70, 63), 0.03],
        walking_heart_rate: [post(92, 112, 104), 0.03],
        hrv: [post(78, 38, 52), 0.08],
        vo2_max: [d => (d % 3 === 0 && d > 5 ? 48.5 : null), 0.01],
        respiratory_rate: [post(14, 16.5, 15), 0.04],
        blood_oxygen: [flat(97.5), 0.01],
        wrist_temperature: [post(35.9, 36.6, 36.1), 0.003],
        walking_speed: [post(5.1, 1.6, 2.9), 0.05],
        step_length: [post(74, 38, 52), 0.04],
        double_support: [post(27, 41, 35), 0.03],
        walking_asymmetry: [post(2, 31, 17), 0.1],
        walking_steadiness: [d => (d % 7 === 0 ? (d > 5 ? 92 : 48) : null), 0.02],
        weight: [d => (d % 4 === 0 ? 71.8 : null), 0.004],
        environmental_audio: [flat(66), 0.06],
        headphone_audio: [flat(71), 0.06],
        time_in_daylight: [post(85, 5, 30), 0.3],
        handwashing: [flat(6), 0.3],
      });
      sleepNights(out, w, rand, d => (d > 5 ? 7.7 : ramp(d, 5, 0, 5.1, 6.6)), d => (d > 5 ? 0.3 : 1.1));
      heartRateHours(out, w, rand, 63, 108);
      doses(out, KADRIAN_MEDS.slice(0, 2), [['Aspirin 81 mg', 3]], 'Logged by patient');
      events(out, 'medication', [[600, 1, 'Oxycodone 5 mg'], [2100, 1, 'Oxycodone 5 mg'], [3500, 1, 'Oxycodone 5 mg']], 'Logged by patient', 'manual');
      events(out, 'workouts', [[180, 20, 'Physical therapy'], [1620, 18, 'Physical therapy'], [3060, 15, 'Physical therapy']], w.name, 'apple_health');
      events(out, 'mood', [[200, 1, 'Hopeful'], [1700, -1, 'Frustrated'], [4300, -2, 'Uncomfortable']], 'Logged by patient', 'manual');
      return out;
    },
  },

  // Concussion 12 days ago: fragmented sleep and low HRV improving; quieter audio; less screen-time light.
  'Isak Smith': {
    devices: [{ kind: 'fitbit', name: 'Fitbit Charge 6' }],
    medications: ISAK_MEDS,
    history: rand => {
      const out: DemoSample[] = [];
      const f = { kind: 'fitbit', name: 'Fitbit Charge 6' };
      const post = (pre: number, at12: number, now: number): Gen => d => (d > 12 ? pre : ramp(d, 12, 0, at12, now));
      daily(out, f, rand, {
        steps: [post(8800, 2100, 6400), 0.15],
        distance: [post(6.4, 1.5, 4.6), 0.15],
        active_energy: [post(480, 120, 360), 0.12],
        exercise_minutes: [post(38, 0, 20), 0.3],
        flights_climbed: [post(8, 2, 6), 0.3],
        resting_heart_rate: [post(58, 66, 60), 0.03],
        hrv: [post(72, 34, 55), 0.1],
        vo2_max: [d => (d % 4 === 0 ? 51 : null), 0.01],
        respiratory_rate: [flat(14), 0.04],
        blood_oxygen: [flat(97), 0.01],
        headphone_audio: [post(78, 58, 64), 0.05],
        environmental_audio: [flat(62), 0.06],
        time_in_daylight: [post(70, 15, 55), 0.3],
        caffeine: [post(180, 40, 90), 0.2],
        mindful_minutes: [d => (d <= 12 && d % 2 === 0 ? 10 : null), 0.2],
      });
      sleepNights(out, f, rand, d => (d > 12 ? 7.5 : ramp(d, 12, 0, 5.4, 6.9)), d => (d > 12 ? 0.3 : ramp(d, 12, 0, 1.4, 0.6)));
      heartRateHours(out, f, rand, 60, 112);
      events(out, 'medication', [[400, 1, 'Acetaminophen 500 mg'], [2900, 1, 'Acetaminophen 500 mg'], [5800, 1, 'Acetaminophen 500 mg'], [8700, 1, 'Acetaminophen 500 mg']], 'Logged by patient', 'manual');
      events(out, 'mood', [[300, 1, 'Calm'], [1800, 0, 'Tired'], [4600, -1, 'Foggy'], [10000, -2, 'Irritable']], 'Logged by patient', 'manual');
      return out;
    },
  },

  // Heart failure: weight creeping up over four days with a missed diuretic; resting HR and breathing rising.
  'Jesus Allejandro': {
    devices: [
      { kind: 'apple_watch', name: 'Apple Watch SE' },
      { kind: 'smart_scale', name: 'Withings Body+ scale' },
      { kind: 'bp_cuff', name: 'Omron BP cuff' },
    ],
    medications: JESUS_MEDS,
    history: rand => {
      const out: DemoSample[] = [];
      const w = { kind: 'apple_watch', name: 'Apple Watch SE' };
      const scale = { kind: 'smart_scale', name: 'Withings Body+ scale' };
      const cuff = { kind: 'bp_cuff', name: 'Omron BP cuff' };
      const slide = (base: number, now: number): Gen => d => (d > 4 ? base : ramp(d, 4, 0, base, now));
      daily(out, w, rand, {
        steps: [slide(3600, 2100), 0.12],
        distance: [slide(2.5, 1.4), 0.12],
        active_energy: [slide(210, 120), 0.1],
        resting_energy: [flat(1820), 0.03],
        exercise_minutes: [slide(18, 6), 0.3],
        stand_hours: [slide(9, 6), 0.1],
        resting_heart_rate: [slide(70, 79), 0.02],
        walking_heart_rate: [slide(98, 108), 0.03],
        hrv: [slide(32, 24), 0.08],
        respiratory_rate: [slide(16, 19.5), 0.03],
        blood_oxygen: [slide(95.5, 93.5), 0.006],
        breathing_disturbances: [slide(9, 16), 0.1],
        walking_speed: [slide(3.6, 3.0), 0.04],
        six_minute_walk: [d => (d % 7 === 0 ? (d > 4 ? 380 : 315) : null), 0.02],
        water: [slide(1700, 2200), 0.08],
        sodium: [slide(1900, 2900), 0.12],
        dietary_energy: [flat(2100), 0.1],
      });
      daily(out, scale, rand, {
        weight: [d => (d > 4 ? 92.0 : [94.1, 93.6, 92.9, 92.3, 92.0][d]), 0.0004],
        body_fat: [flat(31), 0.01],
        bmi: [d => (d > 4 ? 30.0 : [30.7, 30.6, 30.3, 30.1, 30.0][d]), 0.002],
      });
      daily(out, cuff, rand, {
        bp_systolic: [slide(126, 139), 0.03],
        bp_diastolic: [slide(77, 85), 0.03],
      });
      sleepNights(out, w, rand, d => (d > 4 ? 6.8 : ramp(d, 4, 0, 6.6, 5.6)), d => (d > 4 ? 0.6 : 1.2));
      heartRateHours(out, w, rand, 78, 104);
      doses(out, JESUS_MEDS, [['Furosemide 40 mg', 2], ['Furosemide 40 mg', 3], ['Spironolactone 25 mg', 2]], 'Logged by patient');
      events(out, 'irregular_rhythm', [[9 * 1440 + 200, 1]], w.name, 'apple_health');
      events(out, 'ecg', [[9 * 1440 + 180, 1, 'Sinus rhythm'], [9 * 1440 + 150, 1, 'Atrial fibrillation']], w.name, 'apple_health');
      events(out, 'mood', [[260, -1, 'Worried'], [3000, 0, 'Tired']], 'Logged by patient', 'manual');
      return out;
    },
  },

  // Diabetic foot wound: off-loading keeps steps low; glucose running high while the wound is infected.
  'Tom Becker': {
    devices: [
      { kind: 'pixel_watch', name: 'Pixel Watch 3' },
      { kind: 'glucose_monitor', name: 'Dexcom G7' },
    ],
    medications: TOM_MEDS,
    history: rand => {
      const out: DemoSample[] = [];
      const p = { kind: 'pixel_watch', name: 'Pixel Watch 3' };
      const cgm = { kind: 'glucose_monitor', name: 'Dexcom G7' };
      const post = (pre: number, now: number): Gen => d => (d > 2 ? pre : now);
      daily(out, p, rand, {
        steps: [post(7400, 1500), 0.12],
        distance: [post(5.3, 1.0), 0.12],
        active_energy: [post(420, 110), 0.12],
        exercise_minutes: [post(30, 4), 0.3],
        flights_climbed: [post(6, 1), 0.3],
        resting_heart_rate: [post(68, 74), 0.03],
        hrv: [post(44, 36), 0.08],
        respiratory_rate: [flat(15), 0.04],
        blood_oxygen: [flat(97), 0.008],
        weight: [d => (d % 3 === 0 ? 88.4 : null), 0.003],
        carbohydrates: [flat(210), 0.15],
        dietary_energy: [flat(2350), 0.1],
        protein: [flat(95), 0.15],
        water: [flat(2300), 0.1],
      });
      for (let d = 13; d >= 0; d--) {
        for (const [minute, base] of [[7 * 60, 142], [13 * 60, 188], [19 * 60, 205], [23 * 60, 168]] as const) {
          if (d === 0 && minute > 17 * 60) continue;
          const infection = d <= 3 ? 25 : 0;
          const v = base + infection + (rand() * 2 - 1) * 22;
          out.push({ metric: 'blood_glucose', value: Math.round(v), label: minute === 7 * 60 ? 'Fasting' : '', minutesAgo: d * 1440 + (17 * 60 - minute), device: cgm.name, source: 'apple_health' });
        }
      }
      sleepNights(out, p, rand, flat(6.9), flat(0.7));
      heartRateHours(out, p, rand, 74, 98);
      doses(out, TOM_MEDS, [['Metformin 1,000 mg', 1]], 'Logged by patient');
      events(out, 'mood', [[500, 0, 'Bored'], [3300, 1, 'Relieved']], 'Logged by patient', 'manual');
      return out;
    },
  },

  // COPD: SpO2 low-normal, breathing rate high-normal, rescue inhaler use creeping up.
  'Mei Lin Wu': {
    devices: [{ kind: 'pixel_watch', name: 'Pixel Watch 3' }],
    medications: MEI_MEDS,
    history: rand => {
      const out: DemoSample[] = [];
      const p = { kind: 'pixel_watch', name: 'Pixel Watch 3' };
      daily(out, p, rand, {
        steps: [d => ramp(d, 8, 0, 5600, 4300), 0.12],
        distance: [d => ramp(d, 8, 0, 3.9, 3.0), 0.12],
        active_energy: [flat(260), 0.12],
        exercise_minutes: [flat(16), 0.3],
        flights_climbed: [flat(3), 0.4],
        resting_heart_rate: [d => ramp(d, 8, 0, 74, 78), 0.03],
        hrv: [flat(40), 0.08],
        vo2_max: [d => (d % 5 === 0 ? 29.5 : null), 0.01],
        respiratory_rate: [d => ramp(d, 8, 0, 18, 20.5), 0.03],
        blood_oxygen: [d => ramp(d, 8, 0, 94.5, 93.2), 0.006],
        six_minute_walk: [d => (d % 7 === 1 ? ramp(d, 8, 0, 430, 395) : null), 0.02],
        weight: [d => (d % 5 === 0 ? 51.2 : null), 0.004],
        environmental_audio: [flat(60), 0.06],
        time_in_daylight: [flat(40), 0.3],
      });
      sleepNights(out, p, rand, flat(7.1), flat(0.8));
      heartRateHours(out, p, rand, 78, 112);
      doses(out, MEI_MEDS.slice(0, 2), [['Budesonide/formoterol inhaler', 4]], 'Logged by patient');
      events(out, 'medication', [[150, 1, 'Albuterol inhaler'], [560, 1, 'Albuterol inhaler'], [1500, 1, 'Albuterol inhaler'], [1900, 1, 'Albuterol inhaler'], [4400, 1, 'Albuterol inhaler']], 'Logged by patient', 'manual');
      for (let d = 16; d >= 12; d--) {
        events(out, 'menstrual_flow', [[d * 1440 + 600, d === 16 || d === 12 ? 2 : 3]], 'Logged by patient', 'manual');
      }
      events(out, 'mood', [[420, 1, 'Content'], [2700, -1, 'Anxious']], 'Logged by patient', 'manual');
      return out;
    },
  },

  // Spinal cord injury, wheelchair user: pushes instead of steps; occasional blood pressure spikes.
  'Elena Novak': {
    devices: [
      { kind: 'apple_watch', name: 'Apple Watch Series 10 (wheelchair mode)' },
      { kind: 'bp_cuff', name: 'Omron BP cuff' },
    ],
    medications: ELENA_MEDS,
    history: rand => {
      const out: DemoSample[] = [];
      const w = { kind: 'apple_watch', name: 'Apple Watch Series 10 (wheelchair mode)' };
      const cuff = { kind: 'bp_cuff', name: 'Omron BP cuff' };
      daily(out, w, rand, {
        wheelchair_pushes: [d => ramp(d, 27, 0, 1800, 3100), 0.12],
        wheelchair_distance: [d => ramp(d, 27, 0, 2.6, 4.5), 0.12],
        active_energy: [d => ramp(d, 27, 0, 170, 260), 0.1],
        resting_energy: [flat(1350), 0.03],
        exercise_minutes: [d => ramp(d, 27, 0, 12, 28), 0.3],
        stand_hours: [flat(10), 0.1],
        resting_heart_rate: [flat(64), 0.03],
        hrv: [flat(48), 0.1],
        respiratory_rate: [flat(14.5), 0.04],
        blood_oxygen: [flat(97), 0.008],
        wrist_temperature: [flat(35.7), 0.004],
        weight: [d => (d % 6 === 0 ? 58.3 : null), 0.004],
        water: [flat(2400), 0.1],
        time_in_daylight: [flat(55), 0.3],
        mindful_minutes: [d => (d % 3 === 0 ? 15 : null), 0.2],
      });
      daily(out, cuff, rand, {
        bp_systolic: [d => (d === 3 ? 168 : 108), 0.04],
        bp_diastolic: [d => (d === 3 ? 96 : 68), 0.04],
      });
      sleepNights(out, w, rand, flat(7.4), flat(0.5));
      heartRateHours(out, w, rand, 64, 96);
      doses(out, ELENA_MEDS, [['Oxybutynin 5 mg', 5]], 'Logged by patient');
      events(out, 'workouts', [[200, 30, 'Wheelchair pace'], [3100, 45, 'Adaptive strength'], [5900, 30, 'Wheelchair pace']], w.name, 'apple_health');
      for (let d = 22; d >= 18; d--) {
        events(out, 'menstrual_flow', [[d * 1440 + 500, d === 22 ? 2 : d === 18 ? 1 : 3]], 'Logged by patient', 'manual');
      }
      events(out, 'mood', [[300, 2, 'Proud'], [2000, 1, 'Calm'], [4400, 1, 'Grateful']], 'Logged by patient', 'manual');
      return out;
    },
  },

  // Bipolar I maintenance: sleep collapses and activity climbs over the last week as mood rises.
  'Maria Delgado': {
    devices: [{ kind: 'apple_watch', name: 'Apple Watch Series 10' }],
    medications: MARIA_MEDS,
    history: rand => {
      const out: DemoSample[] = [];
      const w = { kind: 'apple_watch', name: 'Apple Watch Series 10' };
      // Sleep falls from 7.5 h to about 4 h as the week goes on; steps and daylight climb.
      const climb = (base: number, now: number): Gen => d => (d > 7 ? base : ramp(d, 7, 0, base, now));
      daily(out, w, rand, {
        steps: [climb(8600, 13400), 0.12],
        distance: [climb(6.1, 9.4), 0.12],
        active_energy: [climb(430, 640), 0.1],
        exercise_minutes: [climb(34, 52), 0.25],
        stand_hours: [climb(11, 16), 0.1],
        flights_climbed: [climb(8, 14), 0.3],
        resting_heart_rate: [flat(58), 0.03],
        walking_heart_rate: [flat(96), 0.03],
        hrv: [climb(64, 52), 0.08],
        respiratory_rate: [flat(14), 0.04],
        blood_oxygen: [flat(97.5), 0.008],
        time_in_daylight: [climb(70, 105), 0.3],
        environmental_audio: [flat(64), 0.06],
        weight: [d => (d % 4 === 0 ? 63.4 : null), 0.004],
      });
      sleepNights(out, w, rand, d => (d > 7 ? 7.5 : ramp(d, 7, 0, 7.1, 4.1)), d => (d > 7 ? 0.4 : 0.7));
      heartRateHours(out, w, rand, 58, 102);
      doses(out, MARIA_MEDS, [], 'Logged by patient');
      events(out, 'workouts', [[260, 48, 'Morning run'], [1700, 42, 'Morning run'], [4200, 55, 'Late-night run']], w.name, 'apple_health');
      events(out, 'mood', [[240, 3, 'Energized'], [2900, 2, 'Racing'], [5900, 0, 'Even'], [9800, -1, 'Low']], 'Logged by patient', 'manual');
      return out;
    },
  },

  // Depression with hypersomnia: long sleep that does not refresh, very low activity and daylight.
  'Daniel Cho': {
    devices: [{ kind: 'fitbit', name: 'Fitbit Charge 6' }],
    medications: DANIEL_MEDS,
    history: rand => {
      const out: DemoSample[] = [];
      const f = { kind: 'fitbit', name: 'Fitbit Charge 6' };
      daily(out, f, rand, {
        steps: [d => ramp(d, 28, 0, 6100, 1300), 0.15],
        distance: [d => ramp(d, 28, 0, 4.3, 0.9), 0.15],
        active_energy: [d => ramp(d, 28, 0, 330, 90), 0.12],
        exercise_minutes: [d => ramp(d, 28, 0, 24, 3), 0.3],
        flights_climbed: [flat(2), 0.4],
        resting_heart_rate: [flat(62), 0.03],
        hrv: [d => ramp(d, 28, 0, 58, 41), 0.1],
        respiratory_rate: [flat(14.5), 0.04],
        blood_oxygen: [flat(97), 0.008],
        time_in_daylight: [d => ramp(d, 28, 0, 58, 12), 0.3],
        environmental_audio: [flat(58), 0.06],
        headphone_audio: [d => ramp(d, 28, 0, 48, 72), 0.06],
        weight: [d => (d % 5 === 0 ? 70.9 : null), 0.004],
      });
      sleepNights(out, f, rand, d => ramp(d, 28, 0, 7.4, 9.6), d => ramp(d, 28, 0, 0.5, 1.3));
      heartRateHours(out, f, rand, 62, 88);
      doses(out, DANIEL_MEDS, [['Sertraline 50 mg', 2]], 'Logged by patient');
      events(out, 'mood', [[300, -2, 'Heavy'], [2200, -2, 'Flat'], [5200, -1, 'Tired'], [9000, 0, 'Okay']], 'Logged by patient', 'manual');
      return out;
    },
  },

  // Generalized anxiety: steady moderate values with breathing practice and caffeine tapering off.
  'Priya Nair': {
    devices: [{ kind: 'apple_watch', name: 'Apple Watch SE' }],
    medications: PRIYA_MEDS,
    history: rand => {
      const out: DemoSample[] = [];
      const w = { kind: 'apple_watch', name: 'Apple Watch SE' };
      daily(out, w, rand, {
        steps: [flat(7300), 0.12],
        distance: [flat(5.2), 0.12],
        active_energy: [flat(330), 0.1],
        exercise_minutes: [flat(30), 0.3],
        stand_hours: [flat(12), 0.1],
        flights_climbed: [flat(6), 0.3],
        resting_heart_rate: [flat(66), 0.03],
        walking_heart_rate: [flat(100), 0.03],
        hrv: [d => ramp(d, 10, 0, 54, 47), 0.08],
        respiratory_rate: [flat(15), 0.04],
        blood_oxygen: [flat(97), 0.008],
        time_in_daylight: [flat(60), 0.3],
        environmental_audio: [flat(62), 0.06],
        caffeine: [d => ramp(d, 21, 0, 210, 80), 0.2],
        mindful_minutes: [d => (d % 2 === 0 ? 12 : null), 0.2],
        weight: [d => (d % 6 === 0 ? 61.7 : null), 0.004],
      });
      sleepNights(out, w, rand, d => (d % 7 === 3 ? 5.8 : 7.0), flat(0.8));
      heartRateHours(out, w, rand, 66, 108);
      doses(out, PRIYA_MEDS, [], 'Logged by patient');
      events(out, 'workouts', [[380, 35, 'Evening walk'], [2900, 35, 'Evening walk'], [6100, 35, 'Evening walk']], w.name, 'apple_health');
      events(out, 'mood', [[320, 0, 'Steady'], [2400, -1, 'Wound up'], [5600, 1, 'Better']], 'Logged by patient', 'manual');
      return out;
    },
  },
};
