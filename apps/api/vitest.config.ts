import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"]
  }
});
