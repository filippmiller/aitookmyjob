import { test, expect } from "@playwright/test";

test.describe("Forum page", () => {
  test("loads categories and topics from API", async ({ page }) => {
    await page.goto("/forum");
    await expect(page.locator(".section-title")).toContainText("Community Forum");

    // Categories should load (at least the "All" link)
    await expect(page.locator("#categoriesList .category-link").first()).toBeVisible({ timeout: 10000 });

    // Stats should show real numbers (not dashes)
    const topicsStat = page.locator("#statTopics");
    await expect(topicsStat).not.toHaveText("—", { timeout: 10000 });

    // Category filter dropdown should be populated
    const filterOptions = page.locator("#forumCategoryFilter option");
    expect(await filterOptions.count()).toBeGreaterThan(1);
  });

  test("new topic button shows creation form", async ({ page }) => {
    await page.goto("/forum");
    await page.locator("#newTopicBtn").click();
    await expect(page.locator("#newTopicForm")).toBeVisible();
    await expect(page.locator("#topicCategory")).toBeVisible();
    await expect(page.locator("#topicTitle")).toBeVisible();

    // Cancel hides the form
    await page.locator("#cancelTopicBtn").click();
    await expect(page.locator("#newTopicForm")).not.toBeVisible();
  });

  test("search filters topics", async ({ page }) => {
    await page.goto("/forum");
    // Wait for topics to load
    await expect(page.locator("#categoriesList .category-link").first()).toBeVisible({ timeout: 10000 });

    // Type a search that won't match anything
    await page.locator("#forumSearch").fill("xyznonexistent12345");
    await page.waitForTimeout(300); // debounce
    await expect(page.locator("#topicsList")).toContainText(/No topics match|No discussions/);
  });
});

test.describe("Research page", () => {
  test("loads aggregate data and renders charts", async ({ page }) => {
    await page.goto("/research");
    await expect(page.locator(".section-title")).toContainText("Research");

    // Summary cards should populate
    const totalStories = page.locator("#totalStories");
    await expect(totalStories).not.toHaveText("—", { timeout: 10000 });

    // Chart canvases should exist
    await expect(page.locator("#trendChart")).toBeVisible();
    await expect(page.locator("#professionsChart")).toBeVisible();
    await expect(page.locator("#recoveryChart")).toBeVisible();

    // API documentation section should be present
    await expect(page.locator("text=/api/research/aggregates/")).toBeVisible();
  });

  test("country filter reloads data", async ({ page }) => {
    await page.goto("/research");
    await expect(page.locator("#totalStories")).not.toHaveText("—", { timeout: 10000 });

    // Change country
    await page.locator("#countryFilter").selectOption("us");
    // Data should still load (may be zero for US)
    await page.waitForTimeout(1000);
    // generatedAt should be populated
    await expect(page.locator("#generatedAt")).not.toHaveText("—");
  });
});

test.describe("Story page", () => {
  test("renders error for nonexistent story", async ({ page }) => {
    await page.goto("/story/nonexistent-id-12345");
    await expect(page.locator("#storyError")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#storyError")).toContainText("Story Not Found");
  });
});

test.describe("Sitemap", () => {
  test("returns valid XML with required URLs", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("xml");

    const body = await response.text();
    expect(body).toContain('<?xml version="1.0"');
    expect(body).toContain("<urlset");
    expect(body).toContain("<loc>");
    // Should have at least the homepage
    expect(body).toContain("/</loc>");
  });
});

test.describe("Robots.txt", () => {
  test("returns valid robots.txt with sitemap", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("User-agent");
    expect(body).toContain("Sitemap:");
    expect(body).toContain("sitemap.xml");
  });
});

test.describe("Health and API", () => {
  test("health endpoint returns ok", async ({ request }) => {
    const response = await request.get("/health");
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.service).toBe("aitookmyjob");
  });

  test("stats endpoint returns counters", async ({ request }) => {
    const response = await request.get("/api/stats");
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.counters).toBeDefined();
    expect(typeof data.counters.sharedStories).toBe("number");
  });

  test("forum categories endpoint returns array", async ({ request }) => {
    const response = await request.get("/api/forum/categories");
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data.categories)).toBe(true);
    expect(data.categories.length).toBeGreaterThan(0);
  });
});
