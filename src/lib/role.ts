export type Role = 'patient' | 'nurse';

export function currentRole(): Role | null {
  const r = new URLSearchParams(window.location.search).get('role');
  return r === 'patient' || r === 'nurse' ? r : null;
}

export function goToRole(role: Role | null, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  window.location.href = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
}
