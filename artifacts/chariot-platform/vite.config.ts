import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  const rawPort = process.env.PORT ?? (command === 'build' ? '20642' : undefined);

  if (!rawPort) {
    throw new Error(
      'PORT environment variable is required but was not provided.',
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = process.env.BASE_PATH ?? (command === 'build' ? '/' : undefined);

  // In local dev the browser app calls `/api/...` as same-origin relative
  // URLs, so the dev server must forward them to the Express API. Without
  // this, Vite's SPA fallback answers every API request with index.html and
  // the app treats that HTML string as data (e.g. a "logged in" user).
  const apiUrl =
    process.env.API_URL ??
    (process.env.API_PORT ? `http://localhost:${process.env.API_PORT}` : undefined);

  if (command === 'serve' && !apiUrl) {
    console.warn(
      '[vite] API_URL / API_PORT not set: /api requests will not be proxied to the API server.',
    );
  }

  if (!basePath) {
    throw new Error(
      'BASE_PATH environment variable is required but was not provided.',
    );
  }

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
      proxy: apiUrl
        ? {
            '/api': {
              target: apiUrl,
              changeOrigin: false,
            },
          }
        : undefined,
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
