import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

export default defineConfig({
  plugins: [vue()],
  root: ".",
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "ui"),
    },
  },
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
