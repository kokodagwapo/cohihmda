/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

// Suppress ECONNREFUSED noise during startup (backend not ready yet)
const silenceProxyErrors = (proxy: any) => {
  proxy.on('error', (err: any, _req: any, res: any) => {
    if (err.code === 'ECONNREFUSED') return;
    console.error('[vite] proxy error:', err.message);
  });
};

function resolveHmdaDistDir(): string {
  const candidates = [
    path.resolve(__dirname, "../dist"),
    path.resolve(__dirname, "public/hmda-app"),
    "/dist-hmda-embed",
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return candidates[0];
}

function hmdaEmbeddedAppPlugin(): Plugin {
  const mount = "/hmda-app";
  const distDir = resolveHmdaDistDir();
  const indexHtml = path.join(distDir, "index.html");
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
  };

  return {
    name: "hmda-embedded-app",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || "";
        if (!rawUrl.startsWith(mount)) return next();

        if (!fs.existsSync(indexHtml)) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("HMDA embedded build not found. Run: cd .. && npm run build -- --base=/hmda-app/\n");
          return;
        }

        const pathPart = rawUrl.split("?")[0];
        const relative = decodeURIComponent(pathPart.slice(mount.length) || "/");
        let filePath = path.join(distDir, relative);

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = fs.existsSync(path.join(filePath, "index.html"))
            ? path.join(filePath, "index.html")
            : indexHtml;
        }

        res.setHeader("Content-Type", mime[path.extname(filePath).toLowerCase()] || "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

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
    hmdaEmbeddedAppPlugin(),
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
