const TASKS_URL = 'https://api.meshy.ai/openapi/v1/image-to-3d';

type HttpResponse = { status: number; text(): string };
export type MeshyFetch = (url: string, options: {
  method?: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}) => HttpResponse;

export class MeshyError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'MeshyError';
    this.retryable = retryable;
  }
}

function readResponse(response: HttpResponse): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) {
    switch (response.status) {
      case 401:
      case 403:
        throw new MeshyError('The 3D service rejected the server API key. Ask the app administrator to check it.');
      case 402:
        throw new MeshyError('The 3D service account needs more credits.');
      case 429:
        throw new MeshyError('The 3D service is busy. Please try again shortly.', true);
      default:
        throw new MeshyError(
          response.status >= 500 ? 'The 3D service is temporarily unavailable.' : `The 3D service could not process the request (HTTP ${response.status}).`,
          response.status >= 500
        );
    }
  }
  try {
    const body: unknown = JSON.parse(response.text());
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Never expose response bodies: they can contain the uploaded photo or account details.
  }
  throw new MeshyError('The 3D service returned an invalid response.');
}

function headers(key: string) {
  if (!key.trim()) throw new MeshyError('Photo twins are not configured on this server (API key missing).');
  return { authorization: `Bearer ${key.trim()}`, 'content-type': 'application/json' };
}

export function submitMeshyTask(fetch: MeshyFetch, key: string, photo: string, model = 'latest'): string {
  const body = readResponse(fetch(TASKS_URL, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({
      image_url: photo,
      ai_model: model,
      should_remesh: true,
      target_polycount: 30_000,
      should_texture: true,
      enable_pbr: true,
      pose_mode: 'a-pose',
      target_formats: ['glb'],
    }),
  }));
  if (typeof body.result !== 'string' || !body.result.trim() || body.result === '.' || body.result === '..') {
    throw new MeshyError('The 3D service did not return a task ID.');
  }
  return `${TASKS_URL}/${encodeURIComponent(body.result)}`;
}

export type MeshyTask =
  | { status: 'generating'; detail: string }
  | { status: 'ready'; detail: string; twinUrl: string };

/**
 * Validate and normalize a provider-supplied asset URL without `new URL()`
 * (unavailable in some host runtimes). Returns the URL only if it is a direct
 * https link to Meshy's asset host with no embedded credentials.
 */
function safeMeshyAssetUrl(raw: string): string | null {
  // Encode anything a URL must not carry raw: control characters, spaces,
  // non-ASCII, and characters illegal in URLs even after encodeURI.
  const s = raw
    .replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
    .replace(/[^\x21-\x7E]/g, c => encodeURIComponent(c))
    .replace(/["<>\\{}|^`]/g, c => encodeURIComponent(c));
  if (/[\s]/.test(s)) return null;
  if (!/^https:\/\//i.test(s)) return null;
  const host = /^https:\/\/([^/?#]+)/i.exec(s)?.[1]?.toLowerCase() ?? '';
  if (host !== 'assets.meshy.ai') return null;
  return s;
}

export function pollMeshyTask(fetch: MeshyFetch, key: string, statusUrl: string): MeshyTask {
  const prefix = `${TASKS_URL}/`;
  const id = statusUrl.slice(prefix.length);
  // Credentials must never follow a provider-supplied URL to another host or endpoint.
  if (!statusUrl.startsWith(prefix) || !id || /[/?#]/.test(id) || id === '.' || id === '..') {
    throw new MeshyError('This is not a valid twin task. Please generate a new twin.');
  }
  const body = readResponse(fetch(statusUrl, { method: 'GET', headers: headers(key) }));
  switch (body.status) {
    case 'PENDING':
      return { status: 'generating', detail: 'Your photo is in the queue.' };
    case 'IN_PROGRESS': {
      const progress = typeof body.progress === 'number' && Number.isFinite(body.progress)
        ? ` (${Math.round(Math.min(100, Math.max(0, body.progress)))}%)`
        : '';
      return { status: 'generating', detail: `Building your 3D twin${progress}.` };
    }
    case 'SUCCEEDED': {
      const models = body.model_urls as { glb?: unknown } | undefined;
      console.log(
        '[meshy] task finished; top-level fields:',
        Object.keys(body).join(','),
        '| model_urls keys:',
        models && typeof models === 'object' ? Object.keys(models).join(',') : String(models)
      );
      // Depending on the API version the GLB sits in model_urls.glb or model_url.
      const candidates = [models?.glb, body.model_url];
      for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        // NOTE: no `new URL()` here — it is unavailable in some host runtimes
        // (every parse throws), so validate the asset URL structurally.
        const safe = safeMeshyAssetUrl(candidate);
        if (safe) return { status: 'ready', detail: 'Personal twin ready', twinUrl: safe };
      }
      const first = typeof models?.glb === 'string' ? models.glb : String(body.model_url);
      console.log(
        '[meshy] no usable GLB; chars 0-120:',
        first.slice(0, 120).replace(/\s+/g, ' '),
        '| chars 120-320:',
        first.slice(120, 320).replace(/\s+/g, ' ')
      );
      throw new MeshyError('The 3D service finished without a valid model. Please try another photo.');
    }
    case 'FAILED':
      throw new MeshyError('Could not build a twin from this photo. Try a clear, full-body photo.');
    case 'CANCELED':
      throw new MeshyError('The twin task was canceled. Please try again.');
    default:
      throw new MeshyError('The 3D service returned an unknown task status.');
  }
}
