import { test, expect } from "@playwright/test";

function rand(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

test("full user/admin flow covers buttons, forms, and key scenarios", async ({ page }) => {
  const email = `${rand("pw")}@example.com`;
  const password = "StrongPassw0rd!";
  const phone = "+15555550999";

  await page.goto("/global/en/");

  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("#stories")).toBeVisible();
  await expect(page.locator("#forum")).toBeVisible();
  await expect(page.locator("#admin")).toBeVisible();
  await expect(page.locator("#auth")).toBeVisible();
  await expect(page.locator("#integrations")).toBeVisible();

  await page.getByRole("button", { name: "Share your story" }).click();
  await expect(page.locator("#storyForm")).toBeInViewport();
  await page.getByRole("button", { name: "Open forum" }).click();
  await expect(page.locator("#forum")).toBeInViewport();
  await page.getByRole("button", { name: "Open auth" }).click();
  await expect(page.locator("#auth")).toBeInViewport();

  await page.locator("#registerForm input[name='email']").fill(email);
  await page.locator("#registerForm input[name='password']").fill(password);
  await page.locator("#registerForm button[type='submit']").click();
  await expect(page.locator("#authMessage")).toContainText(/Registration successful|Signed in as/i);

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

  await page.locator("#createTopicForm select[name='categoryId']").selectOption("dev");
  await page.locator("#createTopicForm input[name='title']").fill(`Topic ${rand("t")}`);
  await page.locator("#createTopicForm textarea[name='body']").fill("This is a playwright-created topic after verified phone.");
  await page.locator("#createTopicForm button[type='submit']").click();
  await expect(page.locator("#forumCreateMessage")).toContainText(/Topic created/i);

  const firstTopicOption = page.locator("#quickReplyForm select[name='topicId'] option").nth(1);
  expect(await page.locator("#quickReplyForm select[name='topicId'] option").count()).toBeGreaterThan(1);
  const firstTopicId = await firstTopicOption.getAttribute("value");
  expect(firstTopicId).toBeTruthy();
  await page.locator("#quickReplyForm select[name='topicId']").selectOption(firstTopicId);
  await page.locator("#quickReplyForm textarea[name='body']").fill("Quick reply from Playwright.");
  await page.locator("#quickReplyForm button[type='submit']").click();
  await expect(page.locator("#forumCreateMessage")).toContainText(/Reply posted/i);

  const inlineReplyForm = page.locator(".reply-form").first();
  await inlineReplyForm.locator("textarea[name='body']").fill("Inline reply from Playwright.");
  await inlineReplyForm.locator("button[type='submit']").click();
  await expect(page.locator("#forumCreateMessage")).toContainText(/Reply posted/i);

  await page.locator("#submitStoryForm input[name='name']").fill("Playwright User");
  await page.locator("#submitStoryForm input[name='profession']").fill("Analyst");
  await page.locator("#submitStoryForm input[name='company']").fill("Playwright Labs");
  await page.locator("#submitStoryForm input[name='laidOffAt']").fill("2026-02-11");
  await page.locator("#submitStoryForm input[name='reason']").fill("AI automation replaced repetitive reporting.");
  await page.locator("#submitStoryForm textarea[name='story']").fill(
    "I lost my role as repetitive analytics workflows were automated. Sharing this here so others can compare timelines and outcomes."
  );
  await page.locator("#submitStoryForm select[name='visibilityName']").selectOption("coarse");
  await page.locator("#submitStoryForm select[name='visibilityCompany']").selectOption("hidden");
  await page.locator("#submitStoryForm select[name='visibilityGeo']").selectOption("coarse");
  await page.locator("#submitStoryForm select[name='visibilityDate']").selectOption("coarse");
  await page.locator("#submitStoryForm input[name='ndaConfirmed']").check();
  await page.locator("#submitStoryForm button[type='submit']").click();
  await expect(page.locator("#submitResult")).toContainText(/Story submitted/i);

  await page.locator("#adminTokenForm input[name='token']").fill("change-me-admin-token");
  await page.locator("#adminTokenForm button[type='submit']").click();
  await expect(page.locator("#admin")).toBeVisible();
  await expect(page.locator(".admin-pre").first()).toContainText("moderation");

  await page.getByRole("button", { name: "Load moderation queue" }).click();
  await expect(page.locator(".queue-grid .queue-item, .queue-grid .card").first()).toBeVisible();

  const actionForm = page.locator("form.moderation-action").first();
  if (await actionForm.count()) {
    await actionForm.locator("select[name='action']").selectOption("approve");
    await actionForm.locator("input[name='reason']").fill("Playwright moderation approval");
    const moderationActionResponse = page.waitForResponse((resp) => resp.url().includes("/api/admin/moderation/") && resp.request().method() === "POST");
    await actionForm.locator("button[type='submit']").click();
    const moderationRes = await moderationActionResponse;
    expect(moderationRes.ok()).toBeTruthy();
  }

  await page.locator("#transparencyForm input[name='period']").fill("2026-Q1");
  await page.locator("#transparencyForm button[type='submit']").click();
  await expect(page.locator("#admin pre").nth(1)).toContainText("totals");

  await page.getByRole("button", { name: "Load anomaly signals" }).click();
  await expect(page.locator("#admin")).toContainText(/Anomaly signals|No anomaly signals/i);

  await page.locator("#sanctionForm input[name='targetUserId']").fill("non-existing-user-id");
  await page.locator("#sanctionForm input[name='type']").fill("warn");
  await page.locator("#sanctionForm input[name='reason']").fill("Playwright negative test");
  await page.locator("#sanctionForm input[name='durationDays']").fill("1");
  await page.locator("#sanctionForm button[type='submit']").click();
  await expect(page.locator("#sanctionMessage")).toContainText(/Target user not found|Validation failed|Could not apply/i);

  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.locator("#integrations .admin-pre")).toBeVisible();
  await page.locator("#telegramLinkCodeForm button[type='submit']").click();
  await expect(page.locator("#telegramLinkCodeForm code")).not.toHaveText("-");

  await page.getByRole("button", { name: "Check session" }).click();
  await expect(page.locator("#authMessage")).toContainText(/Signed in as|$/);
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.locator("#authMessage")).toContainText(/Logged out/i);
});
