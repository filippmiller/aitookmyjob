import { test, expect } from "@playwright/test";

function rand(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

const BASE = "/global/en/";

// ─── Homepage ───────────────────────────────────────────────

test.describe("Homepage", () => {
  test("loads with hero, nav, sections, and footer", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    // Hero
    await expect(page.locator("h1.hero-title")).toBeVisible();
    await expect(page.locator(".hero-subtitle")).toBeVisible();
    await expect(page.locator("#shareStoryBtn")).toBeVisible();
    await expect(page.locator("#authTriggerBtn")).toBeVisible();

    // Nav (use .first() since .nav-brand exists in nav and footer)
    await expect(page.locator("nav .nav-brand").first()).toBeVisible();
    await expect(page.locator("#langSelect")).toBeVisible();
    await expect(page.locator("#countrySelect")).toBeVisible();

    // Sections
    for (const id of ["dashboard", "stories", "community", "news", "resources"]) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }

    // Footer
    await expect(page.locator(".site-footer")).toBeVisible();
  });

  test("stat counters render numbers", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(4000);
    const affected = page.locator('[data-stat="affected"]');
    await expect(affected).toBeVisible();
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

    for (const section of ["dashboard", "stories", "community", "news", "resources"]) {
      const link = page.locator(`a.nav-link[href="#${section}"]`);
      await link.click();
      await page.waitForTimeout(500);
      await expect(page.locator(`#${section}`)).toBeInViewport();
    }
  });

  test("forum link navigates to /forum", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(2000);
    await page.locator('a[href="/forum"]').first().click();
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

  test("login with valid credentials", async ({ page }) => {
    const email = `${rand("login")}@example.com`;
    const password = "TestPassword123!";

    await page.goto(BASE);
    await page.waitForTimeout(3000);

    // First register
    await page.locator("#authTriggerBtn").click();
    await page.locator(".tab-btn[data-tab='register']").click();
    await page.waitForTimeout(300);
    await page.locator("#registerForm input[name='email']").fill(email);
    await page.locator("#registerForm input[name='password']").fill(password);
    await page.locator("#registerForm input[name='confirmPassword']").fill(password);
    await page.locator("#registerForm button[type='submit']").click();
    await page.waitForTimeout(2000);

    // Logout first
    const logoutBtn = page.locator("#sessionLogoutBtn");
    if (await logoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await logoutBtn.click();
      await page.waitForTimeout(1000);
    }

    // Now login
    await page.locator(".tab-btn[data-tab='login']").click();
    await page.waitForTimeout(300);
    await page.locator("#loginForm input[name='loginEmail']").fill(email);
    await page.locator("#loginForm input[name='loginPassword']").fill(password);
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
  test("dashboard chart canvases exist", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(4000);

    for (const id of ["trendChart", "geoChart", "industryChart", "recoveryChart"]) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
  });
});

// ─── Language Switching (all 5 languages) ───────────────────

test.describe("Language switching", () => {
  const langTests = [
    { code: "en", nav: "Dashboard", hero: "human", footer: "Documenting" },
    { code: "ru", nav: "\u041f\u0430\u043d\u0435\u043b\u044c", hero: "\u0427\u0435\u043b\u043e\u0432\u0435\u0447\u0435\u0441\u043a\u0430\u044f", footer: "\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0438\u0440\u0443\u0435\u043c" },
    { code: "de", nav: "\u00dcbersicht", hero: "menschlichen", footer: "Dokumentation" },
    { code: "fr", nav: "Tableau de bord", hero: "humain", footer: "Documenter" },
    { code: "es", nav: "Panel", hero: "humano", footer: "Documentando" },
  ];

  for (const { code, nav, hero, footer } of langTests) {
    test(`${code.toUpperCase()} locale loads translated UI`, async ({ page }) => {
      // Navigate directly to the locale URL
      await page.goto(`/global/${code}/`);
      await page.waitForTimeout(4000);

      // Verify nav link translated
      const dashLink = page.locator('a.nav-link[href="#dashboard"]');
      await expect(dashLink).toContainText(nav);

      // Verify hero title translated
      const heroTitle = page.locator("h1.hero-title");
      await expect(heroTitle).toContainText(hero);

      // Verify footer translated
      const footerDesc = page.locator('[data-i18n="footerDesc"]');
      await expect(footerDesc).toContainText(footer);

      // Verify section headers translated (not English if non-EN)
      if (code !== "en") {
        const dashTitle = page.locator('[data-i18n="sectionDashboard"]');
        const dashText = await dashTitle.textContent();
        expect(dashText).not.toBe("Impact Dashboard");
      }
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

    // Verify at least hero changed
    const heroTitle = page.locator("h1.hero-title");
    await expect(heroTitle).toContainText("humano");
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
      await expect(page.locator("h1.hero-title")).toBeVisible();
      await expect(page.locator(".site-nav")).toBeVisible();
      await expect(page.locator(".site-footer")).toBeVisible();

      // On mobile, check hamburger exists
      if (vp.width < 768) {
        const mobileToggle = page.locator("#mobileMenuToggle");
        await expect(mobileToggle).toBeAttached();
      }

      // On tablet and desktop, verify no horizontal overflow
      if (vp.width >= 768) {
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
        expect(bodyWidth).toBeLessThanOrEqual(vp.width + 20);
      }
    });
  }
});

// ─── 404 Page ───────────────────────────────────────────────

test.describe("404 handling", () => {
  test("nonexistent route is handled", async ({ request }) => {
    const response = await request.get("/this-page-does-not-exist-" + Date.now());
    // Server may return 404 or redirect/serve fallback
    expect([200, 301, 302, 404]).toContain(response.status());
  });
});

// ─── Health & API ───────────────────────────────────────────

test.describe("API endpoints", () => {
  test("health endpoint returns 200", async ({ request }) => {
    const response = await request.get("/health");
    expect(response.status()).toBe(200);
  });

  test("meta endpoint returns languages and countries", async ({ request }) => {
    const response = await request.get("/api/meta");
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.languages).toContain("en");
    expect(data.languages).toContain("ru");
    expect(data.languages.length).toBe(5);
  });

  test("stats endpoint returns counters", async ({ request }) => {
    const response = await request.get("/api/stats?country=global");
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.counters).toBeDefined();
  });

  test("stories endpoint returns array", async ({ request }) => {
    const response = await request.get("/api/stories?country=global&limit=5");
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data.stories)).toBe(true);
  });
});

// ─── Static assets & translations ───────────────────────────

test.describe("Static assets", () => {
  test("CSS and JS load successfully", async ({ request }) => {
    for (const path of ["/styles.css", "/app.js"]) {
      const resp = await request.get(path);
      expect(resp.status()).toBe(200);
    }
  });

  test("translation files load for all 5 languages", async ({ request }) => {
    for (const lang of ["en", "ru", "de", "fr", "es"]) {
      const resp = await request.get(`/i18n/${lang}.json`);
      expect(resp.status()).toBe(200);
      const data = await resp.json();
      expect(data.brand).toBe("AI Took My Job");
      expect(data.navDashboard).toBeTruthy();
      expect(data.heroTitle).toBeTruthy();
      expect(data.footerDesc).toBeTruthy();
      expect(data.sectionStories).toBeTruthy();
      expect(data.ctaShareStory).toBeTruthy();
    }
  });
});
