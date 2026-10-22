import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset");
});

test("landing page shows the product and the safety notice", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /daily check-in, through Alexa/ })).toBeVisible();
  await expect(page.getByText("KinLoop is not a medical device and does not replace emergency services.").first()).toBeVisible();
});

test("privacy page states what is stored and for how long", async ({ page }) => {
  await page.goto("/privacy/");
  await expect(page.getByText("90 days", { exact: true })).toBeVisible();
});

test("simulator: a red flag from Kamala lands on Arjun's phone", async ({ page }) => {
  await page.goto("/simulator/");
  await page.getByLabel("Speak replies").uncheck();
  const kitchen = page.getByRole("region", { name: "Kamala's kitchen" });
  await kitchen.getByRole("button", { name: "I'm feeling dizzy and I nearly fainted" }).click();
  await expect(kitchen.getByText(/Please call 112 now/)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Kamala reported fainting" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("cell", { name: "report_symptom" })).toBeVisible();
});

test("dashboard: family sign-in through OAuth + PKCE shows Kamala's day", async ({ page }) => {
  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Link KinLoop dashboard to KinLoop/ })).toBeVisible();
  await page.getByLabel("Your KinLoop name").fill("arjun");
  await page.getByLabel("PIN").fill("2222");
  await page.getByRole("button", { name: "Allow and link" }).click();
  await expect(page.getByRole("heading", { name: "Kamala today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Doses taken, last 7 days" })).toBeVisible();
  await page.getByLabel("Message").fill("I'll visit on Sunday.");
  await page.getByRole("button", { name: "Queue for Alexa" }).click();
  await expect(page.getByText("I'll visit on Sunday.").first()).toBeVisible();
});

test("simulator: Hindi red flag, Echo Show card, and Arjun closes the loop", async ({ page }) => {
  await page.goto("/simulator/");
  await page.getByLabel("Speak replies").uncheck();
  const kitchen = page.getByRole("region", { name: "Kamala's kitchen" });
  const arjun = page.getByRole("region", { name: "Arjun, in Bengaluru" });

  await kitchen.getByRole("button", { name: "Alexa, what do I need to do today?" }).click();
  const screen = kitchen.frameLocator('iframe[title="Echo Show screen"]');
  await expect(screen.getByText("Today, Kamala")).toBeVisible();
  await expect(screen.getByText("Amlodipine")).toBeVisible();

  await kitchen.getByRole("button", { name: "हिन्दी / Hinglish" }).click();
  await kitchen.getByRole("button", { name: "मुझे सीने में दर्द हो रहा है" }).click();
  await expect(kitchen.getByText(/chest pain can be serious\. Please call 112 now/)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Kamala reported chest pain" })).toBeVisible({ timeout: 8000 });

  await arjun.getByRole("button", { name: "I'm calling her now" }).click();
  await expect(arjun.getByText(/marked 1 alert as handled/)).toBeVisible();
  await kitchen.getByRole("button", { name: "English" }).click();
  await kitchen.getByRole("button", { name: "Alexa, what do I need to do today?" }).click();
  await expect(kitchen.getByText(/Arjun has seen your alert/)).toBeVisible();
});
