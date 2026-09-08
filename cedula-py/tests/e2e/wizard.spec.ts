import { expect, test } from "@playwright/test";

/**
 * System wiring, not legal behaviour.
 *
 * Everything asserted here rides on the controlled synthetic fixture route, so
 * the assertions are about the mechanism - a browser answer reaching the engine
 * and a decision coming back - never about Paraguayan law.
 */
test("the landing page renders and links into the wizard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing")).toBeVisible();
  await page.getByTestId("start-wizard").click();
  await expect(page.getByTestId("wizard")).toBeVisible();
});

test("an anonymous supported case gets a decision back", async ({ page }) => {
  await page.goto("/wizard");
  await page.getByTestId("citizenship").selectOption("DE");
  await page.getByTestId("residence").selectOption("NONE");
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("case-type")).toHaveText("STANDARD_FIRST_CEDULA_FROM_NONE");
  await expect(page.getByTestId("procedure-count")).toContainText("2");
});

test("a missing wizard fact asks the user rather than guessing", async ({ page }) => {
  await page.goto("/wizard");
  await page.getByTestId("residence-unknown").check();
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("status")).toHaveText("NEEDS_USER_INFORMATION");
  await expect(page.getByTestId("blocking-issues")).toContainText("RESIDENCE_STATUS_REQUIRED");
});

test("a country outside the product scope is reported as unsupported", async ({ page }) => {
  await page.goto("/wizard");
  await page.getByTestId("citizenship").selectOption("BR");
  await page.getByTestId("residence").selectOption("NONE");
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("status")).toHaveText("UNSUPPORTED");
  await expect(page.getByTestId("case-type")).toHaveText("COUNTRY_NOT_SUPPORTED");
});

test("a known special case is not terminated on country scope", async ({ page }) => {
  await page.goto("/wizard");
  await page.getByTestId("citizenship").selectOption("BR");
  await page.getByTestId("residence").selectOption("NONE");
  await page.getByTestId("paraguayan-spouse").check();
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("case-type")).toHaveText("SPECIAL_CASE");
  await expect(page.getByTestId("status")).not.toHaveText("UNSUPPORTED");
});

test("an applicant who already held a cedula is out of scope for this product", async ({ page }) => {
  await page.goto("/wizard");
  await page.getByTestId("previous-cedula").check();
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("case-type")).toHaveText("NOT_FIRST_CEDULA");
});

test("the temporal Identificaciones conflict surfaces as official verification", async ({ page }) => {
  await page.goto("/wizard");
  await page.getByTestId("citizenship").selectOption("DE");
  await page.getByTestId("residence").selectOption("TEMPORAL");
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("status")).toHaveText("NEEDS_OFFICIAL_VERIFICATION");
  await expect(page.getByTestId("verification-flags")).toContainText(
    "TEMPORAL_IDENTIFICACIONES_DOCUMENT_SET",
  );
  // The decisive assertion: no document requirement was invented to fill the
  // gap the conflict leaves.
  await expect(page.getByTestId("document-count")).toContainText("1");
});
