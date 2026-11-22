import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The Tauri dev server must use a fixed port (see src-tauri/tauri.conf.json `devUrl`).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "safari17",
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        layer: resolve(import.meta.dirname, "layer.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
