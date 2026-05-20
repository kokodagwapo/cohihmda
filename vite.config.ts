/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// When the API is down, return JSON so browser `fetch().then(r => r.json())` does not fail on an empty body.
const silenceProxyErrors = (proxy: any) => {
  proxy.on('error', (err: any, _req: any, res: any) => {
    if (err.code === 'ECONNREFUSED') {
      if (res && typeof res.writeHead === 'function' && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'bad_gateway',
            message:
              'API server not reachable. Is the backend running on http://localhost:3001? (Vite proxies /api there.)',
          }),
        );
      }
      return;
    }
    console.error('[vite] proxy error:', err.message);
  });
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Use /coheus/ base path for GitHub Pages deployment
  base: process.env.GITHUB_PAGES === 'true' ? "/coheus/" : "/",
  build: {
    outDir: "dist",
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    strictPort: true,
    allowedHosts: true,
    watch: {
      ignored: ['**/.cursor/**', '**/server/logs/**', '**/node_modules/**', '**/.git/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        configure: silenceProxyErrors,
      },
      '/ws': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
        configure: silenceProxyErrors,
      },
    },
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['server/**', 'node_modules/**', 'dist/**'],
  },
}));
