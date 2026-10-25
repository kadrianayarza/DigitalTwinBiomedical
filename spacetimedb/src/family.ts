// Family access: who a patient has authorised, which alerts reach them, and the plain
// wording they see. Pure functions only, shared by the module, the UI, and the tests.

export const FAMILY_ALERT_LEVELS = ['major', 'urgent'] as const;
export type FamilyAlertLevel = (typeof FAMILY_ALERT_LEVELS)[number];

export const FAMILY_ALERT_LEVEL_LABEL: Record<FamilyAlertLevel, string> = {
  major: 'Major changes',
  urgent: 'Emergencies only',
};

export const FAMILY_ALERT_LEVEL_HINT: Record<FamilyAlertLevel, string> = {
  major: 'When the care team needs to review something the same day, or it is an emergency',
  urgent: 'Only when the app tells the patient to call 911',
};

export const RELATIONSHIPS = [
  'Spouse or partner',
  'Parent',
  'Child',
  'Sibling',
  'Caregiver',
  'Friend',
  'Other',
] as const;

export const FAMILY_MAX_MEMBERS = 5;
export const FAMILY_CODE_LENGTH = 6;
export const FAMILY_MAX_NAME = 60;

/** No 0/O, 1/I/L: the code is read aloud over the phone. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const isFamilyAlertLevel = (v: unknown): v is FamilyAlertLevel =>
  typeof v === 'string' && (FAMILY_ALERT_LEVELS as readonly string[]).includes(v);

/** Build an invite code from a source of integers in [0, max). */
export function makeInviteCode(randomBelow: (max: number) => number): string {
  let code = '';
  for (let i = 0; i < FAMILY_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomBelow(CODE_ALPHABET.length)]!;
  }
  return code;
}

/** Accept the code however it was typed: lower case, spaces, or the dash it is shown with. */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Display a code in two halves so it is easy to read out: "ABC-234". */
export function formatInviteCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return code.length > 3 ? `${code.slice(0, half)}-${code.slice(half)}` : code;
}

const PRIORITY_ORDER: Record<string, number> = { routine: 0, review_24h: 1, same_day: 2, emergency: 3 };

/** Whether an alert at `priority` should reach a family member who chose `level`. */
export function shouldNotifyFamily(level: string, priority: string): boolean {
  const rank = PRIORITY_ORDER[priority] ?? 0;
  if (level === 'urgent') return rank >= PRIORITY_ORDER.emergency!;
  return rank >= PRIORITY_ORDER.same_day!;
}

/** Plain-language reasons. Deliberately less clinical than the nurse's labels. */
const FAMILY_REASON: Record<string, string> = {
  PE_SIGNS: 'chest pain or trouble breathing',
  LOW_SPO2: 'low oxygen levels',
  DVT_SIGNS: 'signs of a possible blood clot in the leg',
  INFECTION_SIGNS: 'signs of a possible infection',
  PAIN_UNCONTROLLED: 'pain that is not under control',
  TACHYCARDIA: 'a fast heart rate',
  FEVER: 'a fever',
  TACHYPNEA: 'fast breathing',
  HYPOTENSION: 'low blood pressure',
  HYPERTENSION: 'very high blood pressure',
  HYPOGLYCEMIA: 'low blood sugar',
  HYPERGLYCEMIA: 'very high blood sugar',
  MISSED_INSULIN: 'a missed insulin dose',
  CRITICAL_LAB: 'a lab result outside the safe range',
};

function joinReasons(codes: string[]): string {
  const words = [...new Set(codes.map(c => FAMILY_REASON[c]).filter((w): w is string => !!w))];
  if (words.length === 0) return 'a change in their health';
  if (words.length === 1) return words[0]!;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export type FamilyMessage = { title: string; body: string };

/** What a family member reads when an alert opens, is raised, or is resolved. */
export function familyMessage(
  event: 'opened' | 'raised' | 'resolved',
  priority: string,
  reasonCodes: string,
  firstName: string
): FamilyMessage {
  const who = firstName.trim() || 'Your family member';
  const reasons = joinReasons(reasonCodes.split(',').map(c => c.trim()).filter(Boolean));
  if (event === 'resolved') {
    return {
      title: `${who}: the care team has resolved the alert`,
      body: `The nurse reviewed the earlier concern about ${reasons} and closed it. No action is needed from you.`,
    };
  }
  if (priority === 'emergency') {
    return {
      title: `Urgent: ${who} may need emergency care`,
      body: `${who}'s check-in showed ${reasons}. They have been told to call 911 and the nurse has been alerted. If you are with them, make sure they get help now.`,
    };
  }
  return {
    title: event === 'raised' ? `${who} needs a closer look today` : `${who}'s care team is reviewing a change`,
    body: `${who}'s recent check-in showed ${reasons}. The nurse will review it today. You do not need to do anything unless ${who} asks for help.`,
  };
}

// ---------------------------------------------------------------------------
// Family login: lets an authorised member sign back in on another device.
// ---------------------------------------------------------------------------

export const FAMILY_MIN_PASSWORD = 8;
export const FAMILY_MAX_PASSWORD = 128;
export const FAMILY_MAX_EMAIL = 120;
export const FAMILY_MAX_FAILED_LOGINS = 5;
export const FAMILY_LOCK_MICROS = 15n * 60n * 1_000_000n;
/** Stretching slows guessing if the private table ever leaked; reducers have no async crypto. */
export const FAMILY_HASH_ROUNDS = 2000;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= FAMILY_MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Why a password cannot be used, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < FAMILY_MIN_PASSWORD) return `Use at least ${FAMILY_MIN_PASSWORD} characters`;
  if (password.length > FAMILY_MAX_PASSWORD) return 'That password is too long';
  if (password.trim().length === 0) return 'Use letters or numbers, not only spaces';
  return null;
}

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function sha256Bytes(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const bits = len * 8;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(bits / 0x100000000));
  view.setUint32(total - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]!);
  return out;
}

const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

export function sha256Hex(s: string): string {
  return toHex(sha256Bytes(utf8(s)));
}

/** Salted, stretched SHA-256 of a family password. */
export function hashFamilyPassword(password: string, saltHex: string, rounds = FAMILY_HASH_ROUNDS): string {
  const pw = utf8(password);
  let digest = sha256Bytes(utf8(`${saltHex}:${password}`));
  const block = new Uint8Array(32 + pw.length);
  for (let i = 1; i < rounds; i++) {
    block.set(digest);
    block.set(pw, 32);
    digest = sha256Bytes(block);
  }
  return toHex(digest);
}

/** Compare two hex digests without stopping at the first difference. */
export function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bytesToHex(bytes: Uint8Array): string {
  return toHex(bytes);
}
