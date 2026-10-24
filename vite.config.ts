import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { twinAssetProxy } from './twinAssetProxy';

export default defineConfig({
  plugins: [react(), twinAssetProxy()],
});
