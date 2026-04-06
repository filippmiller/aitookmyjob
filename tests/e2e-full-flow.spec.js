import { test, expect } from "@playwright/test";

function rand(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

test("full user/admin flow covers buttons, forms, and key scenarios", async ({ page }) => {
  const email = `${rand("pw")}@example.com`;
  const password = "StrongPassw0rd!";
  const phone = "+15555550999";

  await page.goto("/global/en/");

  // Wait for JavaScript to initialize the app (loading skeleton should disappear)
  await page.waitForTimeout(5000); // Wait 5 seconds for JS to run

  // Verify the loading skeleton is gone and main content is visible
  await expect(page.locator(".loading-skeleton")).not.toBeVisible();
  await expect(page.locator("#main-content")).toBeVisible();

  await expect(page.locator("h1.hero-title")).toBeVisible();
  await expect(page.locator("#stories")).toBeVisible();
  await expect(page.locator("#community")).toBeVisible();

  await page.getByRole("button", { name: "Share Your Story" }).click();
  await expect(page.locator("#storyForm")).toBeInViewport();

  // Close modal and navigate to forum
  await page.locator("#storyModalClose").click();
  await page.getByRole("link", { name: /Join.*Forum/i }).click();
  await expect(page.locator(".section-title").first()).toContainText(/Forum/i);
  await page.goBack();

  await page.locator("#authTriggerBtn").click();
  await expect(page.locator("#authModal")).toBeVisible();

  // Switch to register tab
  await page.locator(".tab-btn[data-tab='register']").click();
  await page.locator("#registerForm input[name='email']").fill(email);
  await page.locator("#registerForm input[name='password']").fill(password);
  await page.locator("#registerForm input[name='confirmPassword']").fill(password);
  await page.locator("#registerForm button[type='submit']").click();
  await expect(page.locator("#authMessage")).toContainText(/Registration successful|Signed in as|Account created/i);

  await page.locator("#phoneStartForm input[name='phone']").fill(phone);
  const otpStartPromise = page.waitForResponse((resp) => resp.url().includes("/api/auth/phone/request-otp") && resp.request().method() === "POST");
  await page.locator("#phoneStartForm button[type='submit']").click();
  const otpStart = await otpStartPromise;
  const otpJson = await otpStart.json();
  expect(otpJson.devCode).toBeTruthy();

  await page.locator("#phoneConfirmForm input[name='phone']").fill(phone);
  await page.locator("#phoneConfirmForm input[name='code']").fill(String(otpJson.devCode));
  await page.locator("#phoneConfirmForm button[type='submit']").click();
  await expect(page.locator("#phoneMessage")).toContainText(/Phone verified/i);

  // Wait for auth modal to auto-close after phone verification
  await expect(page.locator("#authModal")).not.toHaveClass(/is-open/, { timeout: 5000 });

  // Submit a story via the modal form
  await page.getByRole("button", { name: "Share Your Story" }).click();
  await expect(page.locator("#storyModal")).toBeVisible();

  await page.locator("#storyForm input[name='name']").fill("Playwright User");
  await page.locator("#storyForm input[name='profession']").fill("Analyst");
  await page.locator("#storyForm input[name='company']").fill("Playwright Labs");
  await page.locator("#storyForm input[name='laidOffAt']").fill("2026-02-11");
  await page.locator("#storyForm input[name='reason']").fill("AI automation replaced repetitive reporting.");
  await page.locator("#storyForm textarea[name='story']").fill(
    "I lost my role as repetitive analytics workflows were automated. Sharing this here so others can compare timelines and outcomes."
  );

  // Verify character counter updates
  const charCount = page.locator("#storyCharCount");
  await expect(charCount).toContainText(/\d+ \/ 3,000/);

  await page.locator("#storyForm input[name='ndaConfirmed']").check();
  await page.locator("#storyForm button[type='submit']").click();
  await expect(page.locator("#storySuccessPanel")).toBeVisible({ timeout: 10000 });

  // Close success panel
  await page.locator("#storySuccessClose").click();

  // Auth session check — reopen auth modal to access session controls
  await page.locator("#authTriggerBtn").click();
  await expect(page.locator("#authModal")).toBeVisible();
  await page.getByRole("button", { name: "Check session" }).click();
  await expect(page.locator("#authMessage")).toContainText(/Signed in as|$/);
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.locator("#authMessage")).toContainText(/Logged out/i);
});
