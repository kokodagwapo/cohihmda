/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Use /coheus/ base path for GitHub Pages deployment
  base: process.env.GITHUB_PAGES === 'true' ? "/coheus/" : "/",
  build: {
    outDir: "docs",
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': {
        // Default 3002 = Docker backend; set VITE_PROXY_API_PORT=3001 for local npm run dev:backend
        target: process.env.VITE_PROXY_API_PORT === '3001' ? 'http://localhost:3001' : 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
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
}));
