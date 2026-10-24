import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

/**
 * Same-origin proxy for provider-hosted twin assets (Meshy's CDN sends no CORS
 * headers, so the browser cannot load them directly). Allowlisted to the asset
 * host so it can't be abused as an open proxy.
 *
 * Each scan is downloaded once, slimmed (1024 px WebP textures, meshopt
 * geometry: ~13 MB down to ~1 MB) and cached on disk, keyed by the asset path
 * so a re-signed URL for the same scan is still a cache hit.
 *
 * Dev/preview only: a production deployment needs the same proxy as an edge function.
 */
const ALLOWED_HOSTS = new Set(['assets.meshy.ai']);
const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;
const TEXTURE_PX = 1024;
const CACHE_VERSION = 'v1';

const inflight = new Map<string, Promise<Buffer>>();

function allowedTarget(reqUrl: string | undefined): URL | null {
  try {
    const raw = new URL(reqUrl ?? '', 'http://localhost').searchParams.get('url');
    if (!raw || /[\s<>]/.test(raw)) return null;
    const target = new URL(raw);
    return target.protocol === 'https:' && ALLOWED_HOSTS.has(target.host) ? target : null;
  } catch {
    return null;
  }
}

function download(url: URL): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'accept-encoding': 'identity' } }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Upstream HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_DOWNLOAD_BYTES) req.destroy(new Error('Asset too large'));
        else chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(60_000, () => req.destroy(new Error('Upstream timeout')));
    req.on('error', reject);
  });
}

async function slim(glb: Buffer): Promise<Buffer> {
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.readBinary(new Uint8Array(glb));
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_PX, TEXTURE_PX] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' })
  );
  return Buffer.from(await io.writeBinary(doc));
}

async function loadAsset(cacheDir: string, target: URL): Promise<Buffer> {
  const key = createHash('sha256').update(`${CACHE_VERSION}:${target.host}${target.pathname}`).digest('hex');
  const file = path.join(cacheDir, `${key}.glb`);
  const cached = await fs.readFile(file).catch(() => null);
  if (cached) return cached;

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const original = await download(target);
      const out = await slim(original).catch(err => {
        console.warn('[twin-proxy] could not optimize scan, serving original:', (err as Error).message);
        return original;
      });
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(file, out);
      return out;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

function middleware(cacheDir: string): Connect.NextHandleFunction {
  return (req, res) => {
    const target = allowedTarget(req.url);
    if (!target) {
      res.statusCode = 400;
      res.end('Blocked');
      return;
    }
    loadAsset(cacheDir, target).then(
      body => {
        if (res.destroyed || res.writableEnded) return;
        res.statusCode = 200;
        res.setHeader('content-type', 'model/gltf-binary');
        res.setHeader('content-length', body.length);
        res.setHeader('cache-control', 'private, max-age=86400');
        res.end(body);
      },
      () => {
        if (res.destroyed || res.headersSent) return;
        res.statusCode = 502;
        res.end('Upstream error');
      }
    );
  };
}

export function twinAssetProxy(): Plugin {
  return {
    name: 'twin-asset-proxy',
    configureServer(server) {
      server.middlewares.use('/twin-proxy', middleware(path.join(server.config.cacheDir, 'twin-assets')));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/twin-proxy', middleware(path.join(server.config.cacheDir, 'twin-assets')));
    },
  };
}
