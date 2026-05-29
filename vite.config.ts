/// <reference types="vitest" />
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Suppress ECONNREFUSED noise during startup (backend not ready yet)
const silenceProxyErrors: NonNullable<ProxyOptions["configure"]> = (proxy) => {
  proxy.on("error", (err: NodeJS.ErrnoException, _req: IncomingMessage, _res: ServerResponse) => {
    if (err.code === "ECONNREFUSED") return;
    console.error("[vite] proxy error:", err.message);
  });
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Use /coheus/ base path for GitHub Pages deployment
  base: process.env.GITHUB_PAGES === 'true' ? "/coheus/" : "/",
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/mapbox-gl') ||
            id.includes('node_modules/@vis.gl/react-mapbox') ||
            id.includes('node_modules/@vis.gl/')
          ) return 'vendor-mapbox';
          if (id.includes('node_modules/framer-motion') || id.includes('node_modules/motion')) return 'vendor-motion';
          if (id.includes('node_modules/d3-') || id.includes('node_modules/topojson') || id.includes('node_modules/us-atlas')) return 'vendor-geo';
          if (id.includes('/hmda-databank/core/MortgageLenderDashboard')) return 'vendor-hmda-dashboard';
        },
      },
    },
  },
  define: {
    'import.meta.env.VITE_HMDA_DATA_PREFIX': JSON.stringify(process.env.VITE_HMDA_DATA_PREFIX || 'data/hmda/'),
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
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@hmda', replacement: path.resolve(__dirname, './src/hmda-databank') },
      { find: /^@\/(.*)/, replacement: `${path.resolve(__dirname, './src')}/$1` },
      { find: 'motion/react', replacement: 'framer-motion' },
    ],
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  optimizeDeps: {
    include: [
      'mapbox-gl',
      '@vis.gl/react-mapbox',
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['server/**', 'node_modules/**', 'dist/**'],
  },
}));

