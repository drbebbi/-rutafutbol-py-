import { expect, test } from "@playwright/test";

test("security headers are present on a public response", async ({ request }) => {
  const response = await request.get("/");
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
  const response = await request.get("/case");
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
  await page.goto("/admin");
  await expect(page.getByTestId("admin-denied")).toBeVisible();
  await expect(page.getByTestId("admin-denied-reason")).toHaveText("NOT_AUTHENTICATED");
});

test("the case page renders its signed-out state", async ({ page }) => {
  await page.goto("/case");
  await expect(page.getByTestId("case-signed-out")).toBeVisible();
});

test("an unknown route renders the not-found page", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toBeVisible();
});
