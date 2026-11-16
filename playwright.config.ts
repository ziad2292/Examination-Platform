import { defineConfig } from "@playwright/test";

const browserName = process.env.E2E_BROWSER || "chromium";
if (!["chromium", "firefox", "webkit"].includes(browserName))
  throw new Error("E2E_BROWSER must be chromium, firefox, or webkit");

export default defineConfig({
  testDir: "./e2e",
  outputDir: `test-results/${browserName}`,
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    browserName: browserName as "chromium" | "firefox" | "webkit",
    launchOptions:
      browserName === "chromium"
        ? {
            executablePath:
              process.env.E2E_BROWSER_PATH ||
              (process.platform === "win32"
                ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
                : undefined),
          }
        : {},
    trace: "retain-on-failure",
  },
  reporter: "list",
});
