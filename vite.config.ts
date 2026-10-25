import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { twinAssetProxy } from './twinAssetProxy';
import { healthAgent } from './agentProxy';

export default defineConfig(({ mode }) => {
  // Server-only secrets: loaded into this process, never exposed to the client bundle.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      twinAssetProxy(),
      healthAgent({ apiKey: env.BITDEER_API_KEY, model: env.BITDEER_MODEL }),
    ],
  };
});
