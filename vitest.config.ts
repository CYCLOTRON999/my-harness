import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["benchmarks/test-repos/**", "node_modules/**", "dist/**"],
  },
});
