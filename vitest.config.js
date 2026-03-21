import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "ui") },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["tests/**/*.test.{js,ts}"],
    coverage: {
      include: ["electron/services/**", "ui/utils/**"],
    },
  },
});
