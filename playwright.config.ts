import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts",
  testMatch: "qa-live.spec.ts",
  timeout: 60_000,
  retries: 1,
  use: {
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
});
