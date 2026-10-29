import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  reporter: [["list"], ["html", { open: "never" }]],
  use: { screenshot: "only-on-failure", baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1",
    port: 4173,
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-webkit", use: { ...devices["iPhone 13"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
    {
      name: "surface-touch",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1368, height: 912 },
        hasTouch: true,
      },
    },
  ],
});
