import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { twinAssetProxy } from './twinAssetProxy';
import { healthAgent } from './agentProxy';
import { googleHealth } from './googleHealthProxy';
import { voiceAgent } from './voiceProxy';

export default defineConfig(({ mode }) => {
  // Server-only secrets: loaded into this process, never exposed to the client bundle.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      twinAssetProxy(),
      healthAgent({ apiKey: env.BITDEER_API_KEY, model: env.BITDEER_MODEL }),
      voiceAgent({ apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_VOICE_MODEL, voice: env.OPENROUTER_VOICE }),
      googleHealth({
        clientId: env.GOOGLE_HEALTH_CLIENT_ID,
        clientSecret: env.GOOGLE_HEALTH_CLIENT_SECRET,
        redirectUri: env.GOOGLE_HEALTH_REDIRECT_URI,
      }),
    ],
  };
});
