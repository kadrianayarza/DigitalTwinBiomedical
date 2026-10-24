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
        const query = new globalThis.URL(req.url ?? '', 'http://localhost').searchParams;
        const target = query.get('url');
        const ok =
          target &&
          /^https:\/\//i.test(target) &&
          ALLOWED_HOSTS.has(new globalThis.URL(target).host) &&
          !/[\s<>]/.test(target);
        if (!ok) {
          res.statusCode = 400;
          res.end('Blocked');
          return;
        }
        https
          .get(
            target,
            { headers: { 'accept-encoding': 'identity' } },
            upstream => {
            res.statusCode = upstream.statusCode ?? 502;
            const headers = { ...upstream.headers };
            delete headers['content-encoding'];
            delete headers['content-length'];
            delete headers['transfer-encoding'];
            res.setHeader('content-type', headers['content-type'] ?? 'model/gltf-binary');
            res.setHeader('access-control-allow-origin', '*');
            upstream.pipe(res);
          })
          .on('error', () => {
            res.statusCode = 502;
            res.end('Upstream error');
          });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), twinAssetProxy()],
});
