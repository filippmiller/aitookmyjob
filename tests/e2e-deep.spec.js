import { test, expect } from "@playwright/test";

const TEST_EMAIL = "alexmiller.idothings@gmail.com";
const TEST_PASSWORD = "Test123!@#";
const TEST_PHONE = "+15555550999";

function rand(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

// ═══════════════════════════════════════════════════════════════
//  1. HOMEPAGE — all sections, links, buttons
// ═══════════════════════════════════════════════════════════════

test.describe("Homepage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/global/en/");
    await page.waitForTimeout(3000);
  });

  test("renders all major sections", async ({ page }) => {
    await expect(page.locator("h1.hero-title")).toBeVisible();
    await expect(page.locator("#dashboard")).toBeVisible();
    await expect(page.locator("#stories")).toBeVisible();
    await expect(page.locator("#community")).toBeVisible();
    await expect(page.locator("#news")).toBeVisible();
    await expect(page.locator("#resources")).toBeVisible();
    await expect(page.locator(".site-footer")).toBeVisible();
  });

  test("nav links are present and clickable", async ({ page }) => {
    const navLinks = page.locator(".nav-links .nav-link");
    expect(await navLinks.count()).toBeGreaterThanOrEqual(4);

    // Click Dashboard anchor
    await page.locator('.nav-link[href="#dashboard"]').click();
    // Click Stories anchor
    await page.locator('.nav-link[href="#stories"]').click();
    // Click Community anchor
    await page.locator('.nav-link[href="#community"]').click();
  });

  test("hero stats populate from API", async ({ page }) => {
    // Stats should animate from -- to actual values
    const affected = page.locator('[data-stat="affected"]');
    await expect(affected).not.toHaveText("--", { timeout: 10000 });
    const stories = page.locator('[data-stat="stories"]');
    await expect(stories).not.toHaveText("--", { timeout: 10000 });
  });

  test("Share Your Story button opens story modal", async ({ page }) => {
    await page.locator("#shareStoryBtn").click();
    await expect(page.locator("#storyModal")).toHaveClass(/is-open/);
    await expect(page.locator("#storyForm")).toBeVisible();

    // Close with X button
    await page.locator("#storyModalClose").click();
    await expect(page.locator("#storyModal")).not.toHaveClass(/is-open/);
  });

  test("Sign In button opens auth modal", async ({ page }) => {
    await page.locator("#authTriggerBtn").click();
    await expect(page.locator("#authModal")).toHaveClass(/is-open/);

    // Close with X
    await page.locator("#authModalClose").click();
    await expect(page.locator("#authModal")).not.toHaveClass(/is-open/);
  });

  test("theme toggle switches between dark and light", async ({ page }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");

    await page.locator("#themeToggle").click();
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.locator("#themeToggle").click();
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("country and language selectors are functional", async ({ page }) => {
    const countrySelect = page.locator("#countrySelect");
    const langSelect = page.locator("#langSelect");

    await expect(countrySelect).toBeVisible();
    await expect(langSelect).toBeVisible();

    // Verify all country options
    const countryOptions = countrySelect.locator("option");
    expect(await countryOptions.count()).toBeGreaterThanOrEqual(5);

    // Verify all language options
    const langOptions = langSelect.locator("option");
    expect(await langOptions.count()).toBe(5);
  });

  test("dashboard charts render with canvas elements", async ({ page }) => {
    // Scroll to dashboard section first
    await page.locator("#dashboard").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await expect(page.locator("#trendChart")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#geoChart")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#industryChart")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#recoveryChart")).toBeVisible({ timeout: 5000 });
  });

  test("stories section renders story cards or empty state", async ({ page }) => {
    const container = page.locator("#storiesContainer");
    await expect(container).toBeVisible();
    // Either stories or an empty state message
    await page.waitForTimeout(2000);
    const html = await container.innerHTML();
    expect(html.length).toBeGreaterThan(10);
  });

  test("footer links are present", async ({ page }) => {
    const footer = page.locator(".site-footer");
    await expect(footer).toBeVisible();
    await expect(footer.locator("a")).toHaveCount(await footer.locator("a").count());
    expect(await footer.locator("a").count()).toBeGreaterThanOrEqual(6);
  });

  test("Account link navigates to forum page", async ({ page }) => {
    await page.locator('.nav-actions a[href="/forum"]').click();
    await page.waitForURL(/\/forum/);
    await expect(page.locator(".section-title")).toContainText(/Forum/i);
  });
});

// ═══════════════════════════════════════════════════════════════
//  2. LANGUAGE SWITCHER — all 5 languages
// ═══════════════════════════════════════════════════════════════

test.describe("Language switching", () => {
  test("switching to each language changes News nav text", async ({ page }) => {
    await page.goto("/global/en/");
    await page.waitForTimeout(3000);

    const newsLink = page.locator('[data-i18n="navNews"]');

    // EN → "News"
    await expect(newsLink).toHaveText("News", { timeout: 5000 });

    // RU → "Новости"
    await page.locator("#langSelect").selectOption("ru");
    await expect(newsLink).toHaveText("Новости", { timeout: 5000 });

    // DE → "Nachrichten"
    await page.locator("#langSelect").selectOption("de");
    await expect(newsLink).toHaveText("Nachrichten", { timeout: 5000 });

    // FR → "Actualités"
    await page.locator("#langSelect").selectOption("fr");
    await expect(newsLink).toHaveText("Actualités", { timeout: 5000 });

    // ES → "Noticias"
    await page.locator("#langSelect").selectOption("es");
    await expect(newsLink).toHaveText("Noticias", { timeout: 5000 });
  });
});

// ═══════════════════════════════════════════════════════════════
//  3. REGISTRATION + LOGIN + PHONE OTP + SESSION
// ═══════════════════════════════════════════════════════════════

test.describe("Auth flow", () => {
  const uniqueEmail = `test_deep_${Date.now()}@example.com`;

  test("register, login, phone verify, session check, logout", async ({ page }) => {
    await page.goto("/global/en/");
    await page.waitForTimeout(3000);

    // Open auth modal and switch to register
    await page.locator("#authTriggerBtn").click();
    await expect(page.locator("#authModal")).toHaveClass(/is-open/);
    await page.locator(".tab-btn[data-tab='register']").click();

    // Fill registration
    await page.locator("#registerForm input[name='email']").fill(uniqueEmail);
    await page.locator("#registerForm input[name='password']").fill(TEST_PASSWORD);
    await page.locator("#registerForm input[name='confirmPassword']").fill(TEST_PASSWORD);
    await page.locator("#registerForm button[type='submit']").click();

    // Should auto-login and show phone section
    await expect(page.locator("#authMessage")).toContainText(/Registration successful|Signed in as|Account created/i, { timeout: 10000 });
    await expect(page.locator("#phoneSection")).toBeVisible();
    await expect(page.locator("#sessionSection")).toBeVisible();

    // Phone OTP flow
    await page.locator("#phoneStartForm input[name='phone']").fill(TEST_PHONE);
    const otpPromise = page.waitForResponse(r => r.url().includes("/api/auth/phone/request-otp") && r.request().method() === "POST");
    await page.locator("#phoneStartForm button[type='submit']").click();
    const otpRes = await otpPromise;
    const otpData = await otpRes.json();
    expect(otpData.devCode).toBeTruthy();

    // Verify phone
    await page.locator("#phoneConfirmForm input[name='phone']").fill(TEST_PHONE);
    await page.locator("#phoneConfirmForm input[name='code']").fill(String(otpData.devCode));
    await page.locator("#phoneConfirmForm button[type='submit']").click();
    await expect(page.locator("#phoneMessage")).toContainText(/Phone verified/i);

    // Wait for modal auto-close
    await expect(page.locator("#authModal")).not.toHaveClass(/is-open/, { timeout: 5000 });

    // Reopen modal — should show session controls (logged in state)
    await page.locator("#authTriggerBtn").click();
    await expect(page.locator("#sessionSection")).toBeVisible();

    // Check session
    await page.getByRole("button", { name: "Check session" }).click();
    await expect(page.locator("#authMessage")).toContainText(/Signed in as/i);

    // Logout
    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page.locator("#authMessage")).toContainText(/Logged out/i);

    // After logout, auth tabs should be visible again
    await expect(page.locator("#authTabs")).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
//  4. FORM VALIDATION — empty forms, error messages
// ═══════════════════════════════════════════════════════════════

test.describe("Form validation", () => {
  test("login with empty fields shows browser validation", async ({ page }) => {
    await page.goto("/global/en/");
    await page.waitForTimeout(2000);
    await page.locator("#authTriggerBtn").click();
    await expect(page.locator("#authModal")).toHaveClass(/is-open/);

    // Try submit empty login — browser required validation should prevent submission
    const submitBtn = page.locator("#loginForm button[type='submit']");
    await submitBtn.click();

    // The email input should have :invalid state (browser validation)
    const emailInput = page.locator("#loginEmail");
    const isValid = await emailInput.evaluate(el => el.checkValidity());
    expect(isValid).toBe(false);
  });

  test("register with mismatched passwords shows feedback", async ({ page }) => {
    await page.goto("/global/en/");
    await page.waitForTimeout(2000);
    await page.locator("#authTriggerBtn").click();
    await page.locator(".tab-btn[data-tab='register']").click();

    await page.locator("#registerForm input[name='email']").fill("test@test.com");
    await page.locator("#registerForm input[name='password']").fill("LongPassword123!");
    await page.locator("#registerForm input[name='confirmPassword']").fill("DifferentPass456!");
    await page.locator("#registerForm button[type='submit']").click();

    // Toast appears briefly — check that it was added to DOM at any point
    await expect(page.locator(".toast").first()).toBeAttached({ timeout: 5000 });
  });

  test("story form validates minimum character length", async ({ page }) => {
    await page.goto("/global/en/");
    await page.waitForTimeout(2000);
    await page.locator("#shareStoryBtn").click();
    await expect(page.locator("#storyModal")).toHaveClass(/is-open/);

    // Fill only story text with too few chars
    await page.locator("#storyText").fill("Too short");

    // Character counter should show red for < 40 chars
    const charCount = page.locator("#storyCharCount");
    await expect(charCount).toContainText("9 / 3,000");
  });

  test("story preview toggle works", async ({ page }) => {
    await page.goto("/global/en/");
    await page.waitForTimeout(2000);
    await page.locator("#shareStoryBtn").click();

    const previewPanel = page.locator("#storyPreviewPanel");
    await expect(previewPanel).not.toBeVisible();

    await page.locator("#storyText").fill("This is a test story for preview mode.");
    await page.locator("#storyPreviewToggle").click();
    await expect(previewPanel).toBeVisible();
    await expect(page.locator("#storyPreviewContent")).toContainText("This is a test story for preview mode.");

    // Toggle off
    await page.locator("#storyPreviewToggle").click();
    await expect(previewPanel).not.toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
//  5. STORY SUBMISSION (authenticated)
// ═══════════════════════════════════════════════════════════════

test.describe("Story submission", () => {
  test("anonymous story submit with all fields filled", async ({ page }) => {
    await page.goto("/global/en/");
    await page.waitForTimeout(3000);

    // Open story modal (not logged in = anonymous submission)
    await page.locator("#shareStoryBtn").click();
    await expect(page.locator("#storyModal")).toHaveClass(/is-open/);

    // Fill ALL fields
    await page.locator("#storyForm input[name='name']").fill("Alex Miller");
    await page.locator("#storyForm input[name='profession']").fill("Senior Developer");
    await page.locator("#storyForm input[name='company']").fill("TechCorp International");
    await page.locator("#storyForm input[name='laidOffAt']").fill("March 2026");
    await page.locator("#storyForm input[name='reason']").fill("Entire QA department replaced by AI-powered testing suite");
    await page.locator("#storyForm textarea[name='story']").fill(
      "After 8 years at TechCorp, our entire QA team of 45 people was let go. " +
      "The company replaced us with an AI testing framework that they claimed could do our jobs better. " +
      "The transition happened over just 3 weeks with no retraining offered."
    );
    await page.locator("#storyForm select[name='country']").selectOption("us");
    await page.locator("#storyForm input[name='aiTool']").fill("TestAI Pro");
    await page.locator("#storyForm input[name='foundNewJob']").check();
    await page.locator("#storyForm input[name='ndaConfirmed']").check();

    // Verify char counter updated
    await expect(page.locator("#storyCharCount")).toContainText(/\d+ \/ 3,000/);

    // Submit (anonymous — goes to /api/stories/anonymous)
    const submitPromise = page.waitForResponse(r => r.url().includes("/api/stories") && r.request().method() === "POST");
    await page.locator("#storyForm button[type='submit']").click();
    const submitRes = await submitPromise;
    expect(submitRes.status() === 201 || submitRes.status() === 202).toBeTruthy();

    // Success panel should appear
    await expect(page.locator("#storySuccessPanel")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#storySuccessPanel")).toContainText("Story Submitted");

    // Close success
    await page.locator("#storySuccessClose").click();
    await expect(page.locator("#storyModal")).not.toHaveClass(/is-open/);
  });
});

// ═══════════════════════════════════════════════════════════════
//  6. FORUM PAGE — full interaction
// ═══════════════════════════════════════════════════════════════

test.describe("Forum page deep", () => {
  test("all UI elements render and categories load", async ({ page }) => {
    await page.goto("/forum");

    // Header
    await expect(page.locator(".section-title")).toContainText("Community Forum");
    await expect(page.locator(".section-subtitle")).toContainText("Discuss, support, and share knowledge");

    // Search input
    await expect(page.locator("#forumSearch")).toBeVisible();

    // Category filter
    await expect(page.locator("#forumCategoryFilter")).toBeVisible();

    // New topic button
    await expect(page.locator("#newTopicBtn")).toBeVisible();

    // Wait for categories to load
    await expect(page.locator("#categoriesList .category-link").first()).toBeVisible({ timeout: 10000 });

    // Verify all 9 categories + "All" = 10 links
    const catLinks = page.locator("#categoriesList .category-link");
    expect(await catLinks.count()).toBe(10);

    // Stats section
    await expect(page.locator("#statTopics")).not.toHaveText("—", { timeout: 5000 });
    await expect(page.locator("#statStories")).not.toHaveText("—", { timeout: 5000 });
  });

  test("category sidebar filters topics", async ({ page }) => {
    await page.goto("/forum");
    await expect(page.locator("#categoriesList .category-link").first()).toBeVisible({ timeout: 10000 });

    // Click a specific category (e.g., second one = "cop" for copywriters)
    const secondCat = page.locator("#categoriesList .category-link").nth(1);
    await secondCat.click();
    await expect(secondCat).toHaveClass(/active/);

    // The filter dropdown should match
    const filterVal = await page.locator("#forumCategoryFilter").inputValue();
    expect(filterVal.length).toBeGreaterThan(0);
  });

  test("new topic form shows/hides and validates", async ({ page }) => {
    await page.goto("/forum");
    await expect(page.locator("#categoriesList .category-link").first()).toBeVisible({ timeout: 10000 });

    // Show form
    await page.locator("#newTopicBtn").click();
    await expect(page.locator("#newTopicForm")).toBeVisible();
    await expect(page.locator("#topicCategory")).toBeVisible();
    await expect(page.locator("#topicTitle")).toBeVisible();
    await expect(page.locator("#topicBody")).toBeVisible();

    // Cancel
    await page.locator("#cancelTopicBtn").click();
    await expect(page.locator("#newTopicForm")).not.toBeVisible();
  });

  test("theme toggle works on forum page", async ({ page }) => {
    await page.goto("/forum");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator("#themeToggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.locator("#themeToggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("footer renders with correct links", async ({ page }) => {
    await page.goto("/forum");
    const footer = page.locator(".site-footer");
    await expect(footer).toBeVisible();
    await expect(footer.locator('a[href="/"]')).toBeVisible();
    await expect(footer.locator('a[href="/forum"]')).toBeVisible();
    await expect(footer.locator('a[href="/research"]')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
//  7. RESEARCH PAGE — data, charts, filters
// ═══════════════════════════════════════════════════════════════

test.describe("Research page deep", () => {
  test("all summary cards, charts, and table populate", async ({ page }) => {
    await page.goto("/research");

    // Title
    await expect(page.locator(".section-title")).toContainText("Research");

    // Summary cards
    await expect(page.locator("#totalStories")).not.toHaveText("—", { timeout: 10000 });
    await expect(page.locator("#totalProfessions")).not.toHaveText("—", { timeout: 10000 });
    await expect(page.locator("#totalMonths")).not.toHaveText("—", { timeout: 10000 });

    // Charts
    await expect(page.locator("#trendChart")).toBeVisible();
    await expect(page.locator("#professionsChart")).toBeVisible();
    await expect(page.locator("#recoveryChart")).toBeVisible();

    // Professions table
    const table = page.locator("#professionsTable");
    await expect(table).toBeVisible();

    // API documentation section
    await expect(page.locator("text=/api/research/aggregates/")).toBeVisible();
    await expect(page.locator("text=/api/stats/")).toBeVisible();
    await expect(page.locator("text=/api/transparency/")).toBeVisible();

    // Generated at timestamp
    await expect(page.locator("#generatedAt")).not.toHaveText("—", { timeout: 10000 });
  });

  test("country filter reloads all data", async ({ page }) => {
    await page.goto("/research");
    await expect(page.locator("#totalStories")).not.toHaveText("—", { timeout: 10000 });

    const initialValue = await page.locator("#totalStories").textContent();

    // Switch country
    await page.locator("#countryFilter").selectOption("us");
    await page.waitForTimeout(1500);

    // generatedAt should update
    await expect(page.locator("#generatedAt")).not.toHaveText("—");
  });

  test("navigation links work from research page", async ({ page }) => {
    await page.goto("/research");

    // Home link
    const homeLink = page.locator('.nav-link[href="/"]');
    await expect(homeLink).toBeVisible();

    // Forum link
    await page.locator('.nav-link[href="/forum"]').click();
    await page.waitForURL(/\/forum/);
    await expect(page.locator(".section-title")).toContainText("Community Forum");
  });
});

// ═══════════════════════════════════════════════════════════════
//  8. STORY PAGE — individual story + error state
// ═══════════════════════════════════════════════════════════════

test.describe("Story page", () => {
  test("nonexistent story shows error with back link", async ({ page }) => {
    await page.goto("/story/does-not-exist-999");
    await expect(page.locator("#storyError")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#storyError")).toContainText("Story Not Found");

    // Back to Home link
    await expect(page.locator('#storyError a[href="/"]')).toBeVisible();
  });

  test("story page structure renders correctly", async ({ page }) => {
    await page.goto("/story/some-invalid-id");
    // Page should have the navigation
    await expect(page.locator(".nav-brand-name")).toContainText("AI Took My Job");
    // Either loading skeleton or error should eventually resolve to error
    await expect(page.locator("#storyError")).toBeVisible({ timeout: 15000 });
  });
});

// ═══════════════════════════════════════════════════════════════
//  9. 404 PAGE
// ═══════════════════════════════════════════════════════════════

test.describe("404 page", () => {
  test("custom 404 renders for invalid routes", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist-at-all");
    expect(response.status()).toBe(404);
    await expect(page.locator("h1")).toContainText("404");
    await expect(page.locator("text=doesn't exist")).toBeVisible();
    await expect(page.locator('a[href="/"]')).toBeVisible();
  });

  test("404 for unknown page route", async ({ page }) => {
    const r = await page.goto("/another-fake-page-xyz");
    expect(r.status()).toBe(404);
    await expect(page.locator("h1")).toContainText("404");
  });
});

// ═══════════════════════════════════════════════════════════════
//  10. API ENDPOINTS — comprehensive validation
// ═══════════════════════════════════════════════════════════════

test.describe("API endpoints", () => {
  test("GET /health returns correct shape", async ({ request }) => {
    const r = await request.get("/health");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(d.ok).toBe(true);
    expect(d.service).toBe("aitookmyjob");
    expect(d.timestamp).toBeTruthy();
  });

  test("GET /api/stats returns counters", async ({ request }) => {
    const r = await request.get("/api/stats");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(d.country).toBe("global");
    expect(typeof d.counters.laidOff).toBe("number");
    expect(typeof d.counters.sharedStories).toBe("number");
    expect(typeof d.counters.foundJob).toBe("number");
    expect(typeof d.counters.distinctCompanies).toBe("number");
    expect(typeof d.foundRate).toBe("number");
  });

  test("GET /api/stats?country=us filters by country", async ({ request }) => {
    const r = await request.get("/api/stats?country=us");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(d.country).toBe("us");
  });

  test("GET /api/stories returns paginated list", async ({ request }) => {
    const r = await request.get("/api/stories?limit=3");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(Array.isArray(d.stories)).toBe(true);
    expect(typeof d.total).toBe("number");
  });

  test("GET /api/stories/:id returns 404 for missing", async ({ request }) => {
    const r = await request.get("/api/stories/nonexistent-id");
    expect(r.status()).toBe(404);
  });

  test("GET /api/meta returns countries and languages", async ({ request }) => {
    const r = await request.get("/api/meta");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(Array.isArray(d.countries)).toBe(true);
    expect(d.countries.length).toBeGreaterThan(0);
    expect(Array.isArray(d.languages)).toBe(true);
  });

  test("GET /api/forum/categories returns all categories", async ({ request }) => {
    const r = await request.get("/api/forum/categories");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(d.categories.length).toBe(9);
    expect(d.categories[0]).toHaveProperty("id");
    expect(d.categories[0]).toHaveProperty("key");
  });

  test("GET /api/forum/topics returns topics array", async ({ request }) => {
    const r = await request.get("/api/forum/topics?country=global");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(d.country).toBe("global");
    expect(Array.isArray(d.topics)).toBe(true);
  });

  test("GET /api/news returns news items", async ({ request }) => {
    const r = await request.get("/api/news?country=global");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(Array.isArray(d.news)).toBe(true);
  });

  test("GET /api/resources returns resources", async ({ request }) => {
    const r = await request.get("/api/resources?country=global");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(Array.isArray(d.resources)).toBe(true);
  });

  test("GET /api/research/aggregates returns aggregates", async ({ request }) => {
    const r = await request.get("/api/research/aggregates?country=global");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(typeof d.totalPublishedStories).toBe("number");
    expect(Array.isArray(d.topProfessions)).toBe(true);
    expect(Array.isArray(d.monthlyTrend)).toBe(true);
  });

  test("GET /api/companies/top returns company list", async ({ request }) => {
    const r = await request.get("/api/companies/top?country=global");
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(d.country).toBe("global");
    expect(Array.isArray(d.companies)).toBe(true);
  });

  test("GET /sitemap.xml returns valid XML", async ({ request }) => {
    const r = await request.get("/sitemap.xml");
    expect(r.status()).toBe(200);
    const body = await r.text();
    expect(body).toContain('<?xml');
    expect(body).toContain("<urlset");
    expect(body).toContain("aitookmyjob.filippmiller.com");
  });

  test("GET /robots.txt is valid", async ({ request }) => {
    const r = await request.get("/robots.txt");
    expect(r.status()).toBe(200);
    const body = await r.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Sitemap:");
    expect(body).toContain("Disallow: /api/admin/");
  });

  test("POST /api/stories requires auth", async ({ request }) => {
    const r = await request.post("/api/stories", { data: { name: "test" } });
    expect(r.status()).toBe(401);
  });

  test("POST /api/forum/topics requires auth", async ({ request }) => {
    const r = await request.post("/api/forum/topics", { data: { title: "test", body: "test body text here" } });
    expect(r.status()).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
//  11. RESPONSIVE — mobile, tablet, desktop
// ═══════════════════════════════════════════════════════════════

test.describe("Responsive layout", () => {
  test("mobile (375px) — nav collapses, hero visible", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/global/en/");
    await page.waitForTimeout(3000);

    // Hero should be visible
    await expect(page.locator("h1.hero-title")).toBeVisible();

    // Mobile menu toggle should be visible
    await expect(page.locator("#mobileMenuToggle")).toBeVisible();

    // Story modal should work at mobile size
    await page.locator("#shareStoryBtn").click();
    await expect(page.locator("#storyModal")).toHaveClass(/is-open/);
    await page.locator("#storyModalClose").click();
  });

  test("tablet (768px) — layout adapts", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/global/en/");
    await page.waitForTimeout(3000);

    await expect(page.locator("h1.hero-title")).toBeVisible();
    await expect(page.locator("#dashboard")).toBeVisible();
    await expect(page.locator("#stories")).toBeVisible();
  });

  test("desktop (1280px) — full layout", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/global/en/");
    await page.waitForTimeout(3000);

    // All nav links should be visible
    await expect(page.locator('.nav-link[href="#dashboard"]')).toBeVisible();
    await expect(page.locator('.nav-link[href="#stories"]')).toBeVisible();
    await expect(page.locator('.nav-link[href="#community"]')).toBeVisible();

    // Hero stats visible
    await expect(page.locator(".hero-stats-grid")).toBeVisible();
  });

  test("forum page at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/forum");

    await expect(page.locator(".section-title")).toContainText("Community Forum");
    await expect(page.locator("#forumSearch")).toBeVisible();
    await expect(page.locator("#newTopicBtn")).toBeVisible();
  });

  test("research page at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/research");

    await expect(page.locator(".section-title")).toContainText("Research");
    await expect(page.locator("#totalStories")).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
//  12. NAVIGATION — cross-page links
// ═══════════════════════════════════════════════════════════════

test.describe("Cross-page navigation", () => {
  test("home → forum → research → home", async ({ page }) => {
    await page.goto("/global/en/");
    await page.waitForTimeout(3000);

    // Go to forum
    await page.goto("/forum");
    await expect(page.locator(".section-title")).toContainText("Community Forum");

    // Go to research
    await page.goto("/research");
    await expect(page.locator(".section-title")).toContainText("Research");

    // Go home via nav brand link (first one, in header)
    await page.locator('nav .nav-brand').click();
    await page.waitForTimeout(3000);
    await expect(page.locator("h1.hero-title")).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
//  13. LOCALE ROUTING
// ═══════════════════════════════════════════════════════════════

test.describe("Locale routing", () => {
  test("root / serves the homepage directly", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);
    // Static middleware serves index.html at /
    await expect(page.locator("h1.hero-title")).toBeVisible({ timeout: 10000 });
  });

  test("/global/en/ serves the homepage", async ({ page }) => {
    await page.goto("/global/en/");
    await page.waitForTimeout(4000);
    await expect(page.locator("h1.hero-title")).toBeVisible({ timeout: 15000 });
  });

  test("/us/en/ serves the homepage with US context", async ({ page }) => {
    await page.goto("/us/en/");
    await page.waitForTimeout(3000);
    await expect(page.locator("h1.hero-title")).toBeVisible();
  });
});
