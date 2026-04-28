import { test, expect } from "@playwright/test";

test.describe("Privacy and trust guardrails", () => {
  test("public stories expose only the safe story surface", async ({ request }) => {
    const response = await request.get("/api/stories?country=global&limit=1");
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.stories.length).toBeGreaterThan(0);
    const story = data.stories[0];

    for (const field of ["submittedBy", "privacy", "moderation", "details"]) {
      expect(story[field], `${field} should not be returned publicly`).toBeUndefined();
    }
    expect(story.metrics?.reactedBy).toBeUndefined();
  });

  test("junk Authorization headers do not bypass CSRF", async ({ request }) => {
    const storiesResponse = await request.get("/api/stories?country=global&limit=1");
    const { stories } = await storiesResponse.json();
    expect(stories.length).toBeGreaterThan(0);

    const response = await request.post(`/api/stories/${stories[0].id}/reactions`, {
      headers: {
        Authorization: "Bearer definitely-not-valid",
        "Content-Type": "application/json"
      },
      data: { type: "support" }
    });

    expect(response.status()).toBe(403);
  });

  test("story submission preview reflects safer publication choices", async ({ page }) => {
    await page.goto("/global/en/");
    await page.locator("#shareStoryBtn").click();

    await page.locator("#storyName").fill("Jane Doe");
    await page.locator("#storyProfession").fill("Support Analyst");
    await page.locator("#storyCompany").fill("Acme Robotics");
    await page.locator("#storyDate").fill("March 2026");
    await page.locator("#storyReason").fill("Role reduced after chatbot rollout");
    await page.locator("#storyText").fill("My team was cut after a chatbot rollout changed how support tickets were handled. I am still looking for comparable work.");
    await page.locator("#storyAiTool").fill("Chatbot");

    await page.locator("#storyPreviewToggle").click();
    const preview = page.locator("#storyPreviewContent");
    await expect(preview).toContainText("J. D.");
    await expect(preview).toContainText("Support Analyst at Undisclosed company");
    await expect(preview).toContainText("2026");
    await expect(preview).toContainText("Still searching");

    await page.locator("#storyPrivacyCompany").selectOption("public");
    await expect(preview).toContainText("Acme Robotics");
  });
});
