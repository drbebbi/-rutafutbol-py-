import { expect, test } from "@playwright/test";
import { PRODUCTION_BASE_URL } from "../../playwright.config";

/*
 * Header, caching and gate claims are made against the production build.
 *
 * The default base URL is a development server, because the synthetic fixture
 * route the wizard specs drive is refused on a production build. But a claim
 * about what ships has to be tested on what ships: the development server
 * rewrites Cache-Control and serves its own headers, so asserting there would
 * be asserting about a build nobody deploys.
 */
test("security headers are present on a public response", async ({ request }) => {
  const response = await request.get(`${PRODUCTION_BASE_URL}/`);
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).toContain("base-uri 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("form-action 'self'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBeDefined();
  expect(headers["permissions-policy"]).toContain("camera=()");
});

test("private routes are never stored in a shared cache", async ({ request }) => {
  const response = await request.get(`${PRODUCTION_BASE_URL}/case`);
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("a malformed evaluation request is refused with a client-safe error", async ({ request, baseURL }) => {
  const response = await request.post("/api/test-fixtures/evaluate", {
    headers: { origin: baseURL ?? "", "content-type": "application/json" },
    data: { citizenship: "not-a-country" },
  });
  expect(response.status()).toBe(400);
  const body = (await response.json()) as { message: string; correlationId: string };
  expect(body.message).not.toContain("stack");
  expect(body.correlationId).toBeTruthy();
});

test("a cross-origin evaluation request is refused", async ({ request }) => {
  const response = await request.post("/api/test-fixtures/evaluate", {
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    data: { citizenship: "DE", residence: "NONE" },
  });
  expect(response.status()).toBe(403);
});

test("the admin boundary denies an unauthenticated visitor", async ({ page }) => {
  await page.goto(`${PRODUCTION_BASE_URL}/admin`);
  await expect(page.getByTestId("admin-denied")).toBeVisible();
  await expect(page.getByTestId("admin-denied-reason")).toHaveText("NOT_AUTHENTICATED");
});

test("the case page renders its signed-out state", async ({ page }) => {
  await page.goto(`${PRODUCTION_BASE_URL}/case`);
  await expect(page.getByTestId("case-signed-out")).toBeVisible();
});

test("an unknown route renders the not-found page", async ({ page }) => {
  const response = await page.goto(`${PRODUCTION_BASE_URL}/no-such-page`);
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toBeVisible();
});

test("a production build refuses the synthetic knowledge route even when it is switched on", async ({
  request,
}) => {
  // Same environment variables as the development server, which serves it
  // happily. The production build refuses on the build itself, so no
  // deployment mistake can turn invented rules into a live answer.
  const response = await request.post(`${PRODUCTION_BASE_URL}/api/test-fixtures/evaluate`, {
    headers: { origin: PRODUCTION_BASE_URL },
    data: { citizenship: "DE", residence: "NONE" },
  });
  expect(response.status()).toBe(404);
});
