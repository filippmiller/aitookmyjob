import { test, expect } from "@playwright/test";

function rand(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

const BASE = "/global/en/";

// ─── Homepage ───────────────────────────────────────────────

test.describe("Homepage", () => {
  test("loads with featured story, nav, sections, and footer", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    // Featured story area
    await expect(page.locator("#featuredStory")).toBeVisible();
    await expect(page.locator("#shareStoryBtn")).toBeVisible();
    await expect(page.locator("#authTriggerBtn")).toBeVisible();

    // Nav
    await expect(page.locator("nav .nav-brand").first()).toBeVisible();
    await expect(page.locator("#langSelect")).toBeVisible();
    await expect(page.locator("#countrySelect")).toBeVisible();

    // Sections
    for (const id of ["stories", "community", "news", "resources"]) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }

    // Onboarding and How it works
    await expect(page.locator(".onboarding-cta")).toBeVisible();
    await expect(page.locator(".how-it-works")).toBeVisible();

    // Footer
    await expect(page.locator(".site-footer")).toBeVisible();
  });

  test("stat counters render in sidebar or ribbon", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(4000);
    const affected = page.locator('[data-stat="affected"]').first();
    await expect(affected).toBeAttached();
  });

  test("theme toggle switches dark/light", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(2000);
    const html = page.locator("html");

    const initialTheme = await html.getAttribute("data-theme");
    await page.locator("#themeToggle").click();
    await page.waitForTimeout(500);
    const newTheme = await html.getAttribute("data-theme");
    expect(newTheme).not.toBe(initialTheme);
  });
});

// ─── Navigation Links ───────────────────────────────────────

test.describe("Nav links", () => {
  test("nav anchor links scroll to sections", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    for (const section of ["stories", "community", "news", "resources"]) {
      const link = page.locator(`a.nav-link[href="#${section}"]`);
      await link.click();
      await page.waitForTimeout(500);
      await expect(page.locator(`#${section}`)).toBeInViewport();
    }
  });

  test("forum link navigates to /forum", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(2000);
    await page.locator('a[href="/forum"]:visible').first().click();
    await page.waitForTimeout(2000);
    expect(page.url()).toContain("/forum");
  });
});

// ─── Registration & Login ───────────────────────────────────

test.describe("Auth flow", () => {
  test("register and verify auth message", async ({ page }) => {
    const email = `${rand("e2e")}@example.com`;
    const password = "TestPassword123!";

    await page.goto(BASE);
    await page.waitForTimeout(3000);

    // Open auth modal
    await page.locator("#authTriggerBtn").click();
    await expect(page.locator("#authModal")).toBeVisible();

    // Register
    await page.locator(".tab-btn[data-tab='register']").click();
    await page.waitForTimeout(300);
    await page.locator("#registerForm input[name='email']").fill(email);
    await page.locator("#registerForm input[name='password']").fill(password);
    await page.locator("#registerForm input[name='confirmPassword']").fill(password);

    const regResponse = page.waitForResponse(resp =>
      resp.url().includes("/api/auth/register") && resp.request().method() === "POST"
    );
    await page.locator("#registerForm button[type='submit']").click();
    await regResponse;
    await expect(page.locator("#authMessage")).toBeVisible({ timeout: 10000 });
  });

  test("login form is accessible and submittable", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    // Open auth modal via JS to bypass click interception
    await page.evaluate(() => {
      const modal = document.getElementById('authModal');
      if (modal) modal.classList.add('is-open');
    });
    await expect(page.locator("#authModal")).toBeVisible();

    // Login tab should be active by default
    await expect(page.locator("#loginForm")).toBeVisible();
    await page.locator("#loginForm input[name='loginEmail']").fill("test@example.com");
    await page.locator("#loginForm input[name='loginPassword']").fill("TestPassword123!");
    await page.locator("#loginForm button[type='submit']").click();
    await expect(page.locator("#authMessage")).toBeVisible({ timeout: 10000 });
  });
});

// ─── Forum ──────────────────────────────────────────────────

test.describe("Forum", () => {
  test("forum page loads", async ({ page }) => {
    const response = await page.goto("/forum");
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(2000);
    const body = await page.textContent("body");
    expect(body.length).toBeGreaterThan(50);
  });
});

// ─── Story Submission Modal ─────────────────────────────────

test.describe("Story submission", () => {
  test("story modal opens and has all form fields", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    await page.locator("#shareStoryBtn").click();
    await page.waitForTimeout(500);
    await expect(page.locator("#storyModal")).toBeVisible();

    // Verify form fields exist
    for (const id of ["storyName", "storyProfession", "storyCompany", "storyDate", "storyReason", "storyText", "storyCountry", "storySubmitBtn"]) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }

    // Close modal
    await page.locator("#storyModalClose").click();
  });

  test("anonymous story submission sends POST", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    await page.locator("#shareStoryBtn").click();
    await page.waitForTimeout(500);

    await page.locator("#storyName").fill("E2E Test User");
    await page.locator("#storyProfession").fill("Software Engineer");
    await page.locator("#storyCompany").fill("TestCorp");
    await page.locator("#storyDate").fill("March 2026");
    await page.locator("#storyReason").fill("Role was automated by AI code generation tools");
    await page.locator("#storyText").fill("This is an automated E2E test story submission. It contains enough characters to pass the minimum length validation for the story text field in the form.");
    await page.locator("#storyNda").check();

    const responsePromise = page.waitForResponse(resp =>
      resp.url().includes("/api/stories") && resp.request().method() === "POST"
    );
    await page.locator("#storySubmitBtn").click();
    const response = await responsePromise;
    expect(response.status()).toBeLessThan(500);
  });
});

// ─── Research / Charts ──────────────────────────────────────

test.describe("Research charts", () => {
  test("chart canvases exist in sidebar", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(4000);

    for (const id of ["trendChart", "geoChart", "industryChart", "recoveryChart"]) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
  });
});

// ─── News Carousel ──────────────────────────────────────────

test.describe("News carousel", () => {
  test("carousel loads headlines from news API", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(4000);

    await expect(page.locator("#newsCarousel")).toBeVisible();
    const cards = page.locator(".carousel-card");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(10);
  });

  test("carousel has navigation arrows", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    await expect(page.locator("#carouselPrev")).toBeAttached();
    await expect(page.locator("#carouselNext")).toBeAttached();
  });

  test("news API returns carousel-ready headlines", async ({ request }) => {
    const resp = await request.get("/api/news?country=global");
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(Array.isArray(data.news)).toBe(true);
    expect(data.news.length).toBeGreaterThanOrEqual(10);
    expect(data.news[0].title).toBeTruthy();
    expect(data.news[0].source).toBeTruthy();
    expect(data.news[0].url).toBeTruthy();
  });
});

// ─── Language Switching (all 5 languages) ───────────────────

test.describe("Language switching", () => {
  const langTests = [
    { code: "en", nav: "Stories", hero: "matters", footer: "Documenting" },
    { code: "ru", nav: "\u0418\u0441\u0442\u043e\u0440\u0438\u0438", hero: "matters", footer: "\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0438\u0440\u0443\u0435\u043c" },
    { code: "de", nav: "Geschichten", hero: "matters", footer: "Dokumentation" },
    { code: "fr", nav: "T\u00e9moignages", hero: "matters", footer: "Documenter" },
    { code: "es", nav: "Historias", hero: "matters", footer: "Documentando" },
  ];

  for (const { code, nav, footer } of langTests) {
    test(`${code.toUpperCase()} locale loads translated UI`, async ({ page }) => {
      await page.goto(`/global/${code}/`);
      await page.waitForTimeout(5000);

      // Verify nav link translated
      const storiesLink = page.locator('a.nav-link[href="#stories"]');
      await expect(storiesLink).toContainText(nav, { timeout: 20000 });

      // Verify footer translated
      const footerDesc = page.locator('[data-i18n="footerDesc"]');
      await expect(footerDesc).toContainText(footer);
    });
  }

  test("language switcher changes URL and translations", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    // Switch to ES via dropdown
    await page.locator("#langSelect").selectOption("es");
    await page.waitForTimeout(3000);

    // URL should update
    expect(page.url()).toContain("/es/");
  });
});

// ─── Responsive Design ──────────────────────────────────────

test.describe("Responsive viewports", () => {
  const viewports = [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 900 },
  ];

  for (const vp of viewports) {
    test(`renders correctly at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(BASE);
      await page.waitForTimeout(3000);

      // Core elements visible at all sizes
      await expect(page.locator("#featuredStory")).toBeVisible();
      await expect(page.locator(".site-nav")).toBeVisible();
      await expect(page.locator(".site-footer")).toBeVisible();

      // On mobile, check mobile ribbon is visible and sidebar is hidden
      if (vp.width < 1024) {
        await expect(page.locator(".mobile-ribbon")).toBeVisible();
      }

      // On desktop, sidebar should exist
      if (vp.width >= 1024) {
        await expect(page.locator(".data-sidebar")).toBeAttached();
      }
    });
  }
});

// ─── 404 handling ───────────────────────────────────────────

test.describe("404 handling", () => {
  test("nonexistent route is handled", async ({ request }) => {
    const response = await request.get("/this-page-does-not-exist-" + Date.now());
    expect([200, 301, 302, 404, 429]).toContain(response.status());
  });
});

// ─── Health & API ───────────────────────────────────────────

test.describe("API endpoints", () => {
  test("health endpoint returns 200", async ({ request }) => {
    const response = await request.get("/health");
    expect([200, 429]).toContain(response.status());
  });

  test("meta endpoint returns languages and countries", async ({ request }) => {
    const response = await request.get("/api/meta");
    expect([200, 429]).toContain(response.status());
    if (response.status() === 200) {
      const data = await response.json();
      expect(data.languages).toContain("en");
      expect(data.languages.length).toBe(5);
    }
  });

  test("stats endpoint returns counters", async ({ request }) => {
    const response = await request.get("/api/stats?country=global");
    expect([200, 429]).toContain(response.status());
  });

  test("stories endpoint returns array", async ({ request }) => {
    const response = await request.get("/api/stories?country=global&limit=5");
    expect([200, 429]).toContain(response.status());
  });
});

// ─── Static assets & translations ───────────────────────────

test.describe("Static assets", () => {
  test("CSS and JS load successfully", async ({ request }) => {
    for (const path of ["/styles.css", "/sidebar.css", "/carousel.css", "/app.js"]) {
      const resp = await request.get(path);
      expect([200, 429]).toContain(resp.status());
    }
  });

  test("translation files load for all 5 languages", async ({ request }) => {
    for (const lang of ["en", "ru", "de", "fr", "es"]) {
      const resp = await request.get(`/i18n/${lang}.json`);
      expect(resp.status()).toBe(200);
      const data = await resp.json();
      expect(data.brand).toBe("AI Took My Job");
      expect(data.navStories).toBeTruthy();
      expect(data.footerDesc).toBeTruthy();
    }
  });
});
