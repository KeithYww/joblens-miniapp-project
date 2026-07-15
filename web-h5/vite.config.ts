import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const buildSha = (
  process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.GITHUB_SHA
  || process.env.BUILD_SHA
  || 'development'
).trim();

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'joblens-build-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: buildSha, built_at: new Date().toISOString() }),
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
