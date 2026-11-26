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
  // Lab-only static files (spike probes); a normal build ships no public folder.
  publicDir: process.env.LAB ? "lab-public" : false,
  build: {
    target: "safari17",
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        layer: resolve(import.meta.dirname, "layer.html"),
        settings: resolve(import.meta.dirname, "settings.html"),
        onboarding: resolve(import.meta.dirname, "onboarding.html"),
        // The Widget Lab is for design review and screenshot tests only, never shipped.
        ...(process.env.LAB ? { lab: resolve(import.meta.dirname, "lab.html") } : {}),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // material-color-utilities 0.4.0 has an extension-less ESM import (color_spec_2025.js)
    // that Node rejects; let Vite resolve it like the app build does.
    server: { deps: { inline: ["@material/material-color-utilities"] } },
  },
});
