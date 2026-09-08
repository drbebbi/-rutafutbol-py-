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
  /*
   * Two servers, because the fixture route's gate is part of what is tested.
   *
   * The synthetic-knowledge route is hard-disabled in a production build, so
   * the specs that drive it need a development server. Proving that it *is*
   * disabled needs the production build - a claim that can only be made by
   * running one. So both are started, and the production build answers on its
   * own port at PRODUCTION_BASE_URL.
   */
  webServer: [
    {
      command: "npm run dev -- --port 3100 --hostname 127.0.0.1",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        CEDULA_ENVIRONMENT: "LOCAL",
        // Enables the controlled synthetic fixture route. Refused in a
        // production build whatever this says.
        CEDULA_SYNTHETIC_KNOWLEDGE: "1",
      },
    },
    {
      command: "npm run start -- --port 3101 --hostname 127.0.0.1",
      url: "http://127.0.0.1:3101",
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        CEDULA_ENVIRONMENT: "LOCAL",
        // Deliberately switched on: the point is that a production build
        // refuses anyway.
        CEDULA_SYNTHETIC_KNOWLEDGE: "1",
      },
    },
  ],
});

/** Where the production build answers, for the specs that need one. */
export const PRODUCTION_BASE_URL = "http://127.0.0.1:3101";
