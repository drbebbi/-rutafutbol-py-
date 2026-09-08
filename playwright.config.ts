import { defineConfig, devices } from "@playwright/test";

const isCI = process.env["CI"] === "true" || process.env["CI"] === "1";

/**
 * Some environments ship a Chromium build that does not match the revision
 * this Playwright version downloads. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points at
 * the available binary instead of downloading another one.
 */
const chromiumExecutable = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
const chromiumOverride =
  chromiumExecutable === undefined || chromiumExecutable === ""
    ? {}
    : { launchOptions: { executablePath: chromiumExecutable } };

/**
 * End-to-end tests exercise system wiring only.
 *
 * The legal behaviour is proved by the engine, golden and property suites; what
 * these tests prove is that a browser request reaches the engine and that the
 * answer comes back intact. They run against the controlled synthetic fixture
 * route, so no invented legal content is ever asserted here.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: isCI ? 1 : 0,
  failOnFlakyTests: true,
  workers: isCI ? 2 : 4,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  use: {
    baseURL: process.env["PLAYWRIGHT_BASE_URL"] ?? "http://127.0.0.1:3100",
    trace: "on-first-retry",
    video: "off",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], ...chromiumOverride } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], ...chromiumOverride } },
    { name: "mobile-webkit", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: "npm run start -- --port 3100 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      CEDULA_ENVIRONMENT: "LOCAL",
      // Enables the controlled synthetic fixture route. Refused in production.
      CEDULA_SYNTHETIC_KNOWLEDGE: "1",
    },
  },
});
