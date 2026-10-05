import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const pages = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GITHUB_PAGES === "true";

export default defineConfig({
  base: pages ? "/tcg-rating-preview/" : "/",
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: [".trycloudflare.com"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
