import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  GOOGLE_HEALTH_BASE,
  GOOGLE_METRICS,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  authUrl,
  deviceFrom,
  normalizeList,
  normalizeRollup,
  rollupBody,
  type GoogleSample,
} from './googleHealthCore';

/**
 * /api/health/google/*: connects a patient's Fitbit or Pixel Watch through the Google Health API.
 * The OAuth client secret and the patient's tokens stay in this server process
 * (GOOGLE_HEALTH_CLIENT_ID / GOOGLE_HEALTH_CLIENT_SECRET in .env.local, never VITE_ variables);
 * the browser only holds an opaque HttpOnly cookie and receives normalized readings to save.
 *
 * Dev/preview only, with tokens kept in memory: a production deployment needs a server route
 * and an encrypted token store.
 */
type Tokens = { access: string; refresh?: string; expires: number };

const PREFIX = '/api/health/google/';
const STATE_TTL = 10 * 60_000;
const MAX_DAYS = 30;

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function cookies(req: IncomingMessage) {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const cookieName = (patient: string) => `gh_${patient.replace(/\D/g, '')}`;
const safeReturn = (path: string | null) => (path && path.startsWith('/') && !path.startsWith('//') ? path : '/');

export function googleHealth(opts: { clientId?: string; clientSecret?: string; redirectUri?: string }): Plugin {
  const clientId = opts.clientId?.trim();
  const clientSecret = opts.clientSecret?.trim();
  const configured = !!(clientId && clientSecret);
  const states = new Map<string, { patient: string; returnTo: string; redirectUri: string; at: number }>();
  const links = new Map<string, Tokens>();

  const redirectFor = (req: IncomingMessage) => {
    if (opts.redirectUri?.trim()) return opts.redirectUri.trim();
    const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0];
    return `${proto}://${req.headers.host}${PREFIX}callback`;
  };

  async function token(body: Record<string, string>) {
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId!, client_secret: clientSecret!, ...body }),
    });
    const data = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!r.ok || !data.access_token) throw new Error(data.error ?? `token HTTP ${r.status}`);
    return data;
  }

  async function accessFor(link: string) {
    const t = links.get(link);
    if (!t) return null;
    if (Date.now() < t.expires - 60_000) return t.access;
    if (!t.refresh) return null;
    const data = await token({ grant_type: 'refresh_token', refresh_token: t.refresh });
    t.access = data.access_token!;
    t.expires = Date.now() + (data.expires_in ?? 3600) * 1000;
    return t.access;
  }

  async function sync(access: string, days: number) {
    const auth = { authorization: `Bearer ${access}` };
    const since = Date.now() - days * 86_400_000;
    const samples: GoogleSample[] = [];
    const errors: string[] = [];
    let device = { name: 'Fitbit', kind: 'fitbit' };
    try {
      const r = await fetch(`${GOOGLE_HEALTH_BASE}/pairedDevices`, { headers: auth });
      if (r.ok) device = deviceFrom(await r.json());
    } catch {
      // device name is cosmetic
    }
    const body = JSON.stringify(rollupBody(days));
    await Promise.all(
      GOOGLE_METRICS.map(async m => {
        const g = m.google!;
        const url = `${GOOGLE_HEALTH_BASE}/dataTypes/${g.dataType}/dataPoints`;
        try {
          const r =
            g.via === 'dailyRollUp'
              ? await fetch(`${url}:dailyRollUp`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body })
              : await fetch(`${url}?pageSize=500`, { headers: auth });
          if (r.status === 403 || r.status === 404) return; // scope not granted or no data of this type
          if (!r.ok) {
            errors.push(`${m.label}: HTTP ${r.status}`);
            return;
          }
          const data = await r.json();
          samples.push(...(g.via === 'dailyRollUp' ? normalizeRollup(m, data) : normalizeList(m, data, since)));
        } catch (e) {
          errors.push(`${m.label}: ${String(e)}`);
        }
      })
    );
    return { device, samples, errors };
  }

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith(PREFIX)) return next();
    const route = url.pathname.slice(PREFIX.length);
    const patient = url.searchParams.get('patient') ?? '';

    void (async () => {
      if (route === 'status') {
        const link = cookies(req)[cookieName(patient)];
        return json(res, 200, { configured, connected: !!(link && links.has(link)) });
      }
      if (!configured) return json(res, 503, { error: 'Google Health is not set up on this server.' });

      if (route === 'start') {
        if (!/^\d+$/.test(patient)) return json(res, 400, { error: 'Missing patient.' });
        for (const [k, s] of states) if (Date.now() - s.at > STATE_TTL) states.delete(k);
        const state = randomBytes(18).toString('base64url');
        const redirectUri = redirectFor(req);
        states.set(state, { patient, returnTo: safeReturn(url.searchParams.get('return')), redirectUri, at: Date.now() });
        res.statusCode = 302;
        res.setHeader('location', authUrl({ clientId: clientId!, redirectUri, state }));
        return res.end();
      }

      if (route === 'callback') {
        const s = states.get(url.searchParams.get('state') ?? '');
        if (!s || Date.now() - s.at > STATE_TTL) return json(res, 400, { error: 'This sign-in link expired. Try connecting again.' });
        states.delete(url.searchParams.get('state')!);
        const back = new URL(s.returnTo, 'http://local');
        const code = url.searchParams.get('code');
        if (!code) back.searchParams.set('health', 'google-denied');
        else {
          try {
            const data = await token({ grant_type: 'authorization_code', code, redirect_uri: s.redirectUri });
            const link = randomBytes(24).toString('base64url');
            links.set(link, { access: data.access_token!, refresh: data.refresh_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 });
            res.setHeader('set-cookie', `${cookieName(s.patient)}=${link}; HttpOnly; SameSite=Lax; Path=${PREFIX.slice(0, -1)}; Max-Age=2592000`);
            back.searchParams.set('health', 'google-connected');
          } catch (e) {
            console.error('[google-health] token exchange failed:', String(e));
            back.searchParams.set('health', 'google-failed');
          }
        }
        res.statusCode = 302;
        res.setHeader('location', back.pathname + back.search);
        return res.end();
      }

      const link = cookies(req)[cookieName(patient)];
      if (route === 'sync') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
        const days = Math.min(MAX_DAYS, Math.max(1, Number(url.searchParams.get('days')) || MAX_DAYS));
        let access: string | null = null;
        try {
          access = link ? await accessFor(link) : null;
        } catch (e) {
          console.error('[google-health] refresh failed:', String(e));
        }
        if (!access) return json(res, 401, { error: 'Not connected. Connect Google Health again.' });
        return json(res, 200, await sync(access, days));
      }

      if (route === 'disconnect') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
        const t = link ? links.get(link) : undefined;
        if (link) links.delete(link);
        if (t) void fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(t.refresh ?? t.access)}`, { method: 'POST' }).catch(() => {});
        res.setHeader('set-cookie', `${cookieName(patient)}=; HttpOnly; SameSite=Lax; Path=${PREFIX.slice(0, -1)}; Max-Age=0`);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Unknown route.' });
    })().catch(e => {
      console.error('[google-health]', e);
      if (!res.headersSent) json(res, 500, { error: 'Google Health request failed.' });
    });
  };

  return {
    name: 'google-health',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
