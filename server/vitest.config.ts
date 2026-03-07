import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/middleware/**/*.ts", "src/routes/**/*.ts"],
      thresholds: {
        lines: 0,
        functions: 70,
        branches: 60,
        statements: 0,
      },
    },
  },
});
