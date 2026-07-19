/**
 * Fast critical-path Playwright smoke suite.
 * - No fixed sleeps (no waitForTimeout)
 * - Uses expect / locators / response assertions only
 * - Separate from full E2E (playwright.smoke.config.mjs)
 *
 * Run: npm run test:smoke
 * Against remote: BASE_URL=https://... npm run test:smoke
 */

import { test, expect } from "@playwright/test";

test.describe("critical probes", () => {
  test("GET /live is live", async ({ request }) => {
    const res = await request.get("/live");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.live).toBe(true);
    expect(body.ok).toBe(true);
  });

  test("GET /health reports service", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("aitookmyjob");
  });

  test("GET /ready is ready", async ({ request }) => {
    const res = await request.get("/ready");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(true);
  });
});

test.describe("critical API reads", () => {
  test("GET /api/meta", async ({ request }) => {
    const res = await request.get("/api/meta");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
    expect(body.domainContractVersion || body.countries || body.storage).toBeTruthy();
  });

  test("GET /api/stories", async ({ request }) => {
    const res = await request.get("/api/stories?limit=5");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test("GET /api/stats", async ({ request }) => {
    const res = await request.get("/api/stats");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
    expect(typeof body).toBe("object");
  });

  test("GET /api/resources", async ({ request }) => {
    const res = await request.get("/api/resources?limit=5");
    expect(res.status()).toBe(200);
  });

  test("GET /api/forum/categories", async ({ request }) => {
    const res = await request.get("/api/forum/categories");
    expect(res.status()).toBe(200);
  });
});

test.describe("critical UI shell", () => {
  test("homepage loads with main content", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    // Title or brand text without fixed sleep
    await expect(page).toHaveTitle(/AI|Took|Job|aitookmyjob/i);
    // Main document should not be an error page shell only
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("forum page shell renders", async ({ page }) => {
    await page.goto("/forum");
    await expect(page.locator("body")).toBeVisible();
    // Section title or heading appears when JS/HTML is served
    const title = page.locator(".section-title, h1, h2").first();
    await expect(title).toBeVisible();
  });
});
