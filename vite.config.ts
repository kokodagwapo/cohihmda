/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Suppress ECONNREFUSED noise during startup (backend not ready yet)
const silenceProxyErrors = (proxy: any) => {
  proxy.on('error', (err: any, _req: any, res: any) => {
    if (err.code === 'ECONNREFUSED') return;
    console.error('[vite] proxy error:', err.message);
  });
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.VITE_BACKEND_URL || "http://localhost:3002";

  return {
  // Use /coheus/ base path for GitHub Pages deployment
  base: process.env.GITHUB_PAGES === 'true' ? "/coheus/" : "/",
  build: {
    outDir: "dist",
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    watch: {
      ignored: ['**/.cursor/**', '**/server/logs/**', '**/node_modules/**', '**/.git/**'],
    },
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
        configure: silenceProxyErrors,
      },
      '/ws': {
        target: backendUrl,
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
  },
};
});
