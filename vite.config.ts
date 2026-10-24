import { defineConfig, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'node:https';

/**
 * Same-origin proxy for provider-hosted twin assets (Meshy's CDN sends no CORS
 * headers, so the browser cannot load them directly). Allowlisted to the asset
 * host so it can't be abused as an open proxy.
 *
 * Dev-only: a production deployment needs the same proxy as an edge function.
 */
function twinAssetProxy() {
  const ALLOWED_HOSTS = new Set(['assets.meshy.ai']);
  return {
    name: 'twin-asset-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/twin-proxy', (req, res) => {
        const fail = (status: number, message: string) => {
          if (res.writableEnded) return;
          if (res.headersSent) {
            res.destroy();
            return;
          }
          res.statusCode = status;
          res.end(message);
        };

        let target: string | null = null;
        try {
          const candidate = new globalThis.URL(req.url ?? '', 'http://localhost').searchParams.get('url');
          if (
            candidate &&
            !/[\s<>]/.test(candidate) &&
            new globalThis.URL(candidate).protocol === 'https:' &&
            ALLOWED_HOSTS.has(new globalThis.URL(candidate).host)
          ) {
            target = candidate;
          }
        } catch {
          target = null;
        }
        if (!target) {
          fail(400, 'Blocked');
          return;
        }

        // Unhandled 'error' events on either stream would take down the whole dev server.
        const upstreamReq = https.get(target, { headers: { 'accept-encoding': 'identity' } }, upstream => {
          upstream.on('error', () => fail(502, 'Upstream error'));
          if (res.writableEnded || res.destroyed) {
            upstream.destroy();
            return;
          }
          res.statusCode = upstream.statusCode ?? 502;
          res.setHeader('content-type', upstream.headers['content-type'] ?? 'model/gltf-binary');
          res.setHeader('access-control-allow-origin', '*');
          upstream.pipe(res);
        });
        upstreamReq.setTimeout(60_000, () => upstreamReq.destroy(new Error('timeout')));
        upstreamReq.on('error', () => fail(502, 'Upstream error'));
        res.on('error', () => upstreamReq.destroy());
        res.on('close', () => {
          if (!res.writableFinished) upstreamReq.destroy();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), twinAssetProxy()],
});
