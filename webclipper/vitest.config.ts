import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@ui": path.resolve("src/ui"),
      "@viewmodels": path.resolve("src/viewmodels"),
      "@services": path.resolve("src/services"),
      "@platform": path.resolve("src/platform"),
      "@collectors": path.resolve("src/collectors"),
      "@entrypoints": path.resolve("src/entrypoints")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
