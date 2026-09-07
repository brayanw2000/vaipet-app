import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    permissions: ["geolocation"],
    geolocation: { longitude: -46.6333, latitude: -23.5505 },
    locale: "pt-BR",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Allows pinning a pre-installed Chromium in sandboxed/CI environments.
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
          args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
        },
      },
    },
  ],
});
