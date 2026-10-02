import { chromium } from "playwright";
import fs from "fs";
import { assertNotBlocked } from "./blockGuard.js";

const STORAGE_STATE_PATH = "./session-state.json";
const RSA_URL = "https://myroadsafety.rsa.ie";

export async function getBrowserContext() {
  const browser = await chromium.launch({ headless: true });

  const hasSavedSession = fs.existsSync(STORAGE_STATE_PATH);
  const context = await browser.newContext(
    hasSavedSession ? { storageState: STORAGE_STATE_PATH } : {}
  );

  return { browser, context };
}

export async function login(context) {
  const page = await context.newPage();
  const response = await page.goto(RSA_URL, { waitUntil: "networkidle" });
  await assertNotBlocked(page, response);

  const alreadyLoggedIn = await page
    .locator("text=My Bookings")
    .first()
    .isVisible()
    .catch(() => false);

  if (alreadyLoggedIn) {
    await page.close();
    return;
  }

  await page.fill('input[name="email"]', process.env.RSA_EMAIL);
  await page.fill('input[name="password"]', process.env.RSA_PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForLoadState("networkidle");

  const stillOnLogin = await page
    .locator('input[name="password"]')
    .first()
    .isVisible()
    .catch(() => false);
  if (stillOnLogin) {
    throw new Error(
      "Login appears to have failed - check credentials or whether the site added a captcha/2FA step."
    );
  }

  await context.storageState({ path: STORAGE_STATE_PATH });
  await page.close();
}
