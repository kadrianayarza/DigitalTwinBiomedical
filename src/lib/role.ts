export type Role = 'patient' | 'nurse' | 'family';

export function currentRole(): Role | null {
  const r = new URLSearchParams(window.location.search).get('role');
  return r === 'patient' || r === 'nurse' || r === 'family' ? r : null;
}

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://127.0.0.1:3100';
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'twincare';

/** Each role gets its own identity so a patient tab and a nurse tab can run side by side. */
export function tokenKey(role: Role | null) {
  return `${HOST}/${DB_NAME}/${role ?? 'guest'}/auth_token`;
}

/** Drop this browser's identity for a role; the next visit starts as a stranger. */
export function forgetIdentity(role: Role) {
  localStorage.removeItem(tokenKey(role));
}

export function onLoginPage(): boolean {
  return new URLSearchParams(window.location.search).get('view') === 'login';
}

export function goToLogin() {
  goToRole(null, { view: 'login' });
}

export function goToRole(role: Role | null, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  window.location.href = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
}
