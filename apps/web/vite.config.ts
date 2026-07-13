import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "mui-vendor": ["@mui/material", "@emotion/react", "@emotion/styled"],
          "query-vendor": ["@tanstack/react-query", "axios", "zustand"],
          "forms-vendor": ["react-hook-form", "zod", "@hookform/resolvers"]
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false
  }
});
