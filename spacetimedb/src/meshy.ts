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
        throw new MeshyError('Meshy rejected the server API key. Ask the app administrator to check MESHY_API_KEY.');
      case 402:
        throw new MeshyError('The Meshy account needs more API credits.');
      case 429:
        throw new MeshyError('Meshy is busy. Please try again shortly.', true);
      default:
        throw new MeshyError(
          response.status >= 500 ? 'Meshy is temporarily unavailable.' : `Meshy could not process the request (HTTP ${response.status}).`,
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
  throw new MeshyError('Meshy returned an invalid response.');
}

function headers(key: string) {
  if (!key.trim()) throw new MeshyError('Photo twins are not configured on this server (MESHY_API_KEY missing).');
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
    throw new MeshyError('Meshy did not return a task ID.');
  }
  return `${TASKS_URL}/${encodeURIComponent(body.result)}`;
}

export type MeshyTask =
  | { status: 'generating'; detail: string }
  | { status: 'ready'; detail: string; twinUrl: string };

export function pollMeshyTask(fetch: MeshyFetch, key: string, statusUrl: string): MeshyTask {
  const prefix = `${TASKS_URL}/`;
  const id = statusUrl.slice(prefix.length);
  // Credentials must never follow a provider-supplied URL to another host or endpoint.
  if (!statusUrl.startsWith(prefix) || !id || /[/?#]/.test(id) || id === '.' || id === '..') {
    throw new MeshyError('This is not a valid Meshy task. Please generate a new twin.');
  }
  const body = readResponse(fetch(statusUrl, { method: 'GET', headers: headers(key) }));
  switch (body.status) {
    case 'PENDING':
      return { status: 'generating', detail: 'Your photo is in the Meshy queue.' };
    case 'IN_PROGRESS': {
      const progress = typeof body.progress === 'number' && Number.isFinite(body.progress)
        ? ` (${Math.round(Math.min(100, Math.max(0, body.progress)))}%)`
        : '';
      return { status: 'generating', detail: `Meshy is building your 3D twin${progress}.` };
    }
    case 'SUCCEEDED': {
      const models = body.model_urls as { glb?: unknown } | undefined;
      if (typeof models?.glb === 'string') {
        try {
          const url = new URL(models.glb);
          if (url.protocol === 'https:' && !url.username && !url.password) {
            return { status: 'ready', detail: 'Personal twin ready', twinUrl: url.href };
          }
        } catch {
          // A successful task still needs a loadable model.
        }
      }
      throw new MeshyError('Meshy finished without a valid GLB model. Please try another photo.');
    }
    case 'FAILED':
      throw new MeshyError('Meshy could not build this photo. Try a clear, full-body photo.');
    case 'CANCELED':
      throw new MeshyError('Meshy canceled this task. Please try again.');
    default:
      throw new MeshyError('Meshy returned an unknown task status.');
  }
}
