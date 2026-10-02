import { chromium } from "playwright";
import fs from "fs";
import { assertNotBlocked } from "./blockGuard.js";

export const STORAGE_STATE_PATH = "./session-state.json";
export const RSA_URL = "https://myroadsafety.rsa.ie";

export class LoginFailedError extends Error {}

function ensureSessionStateFromEnv() {
  if (fs.existsSync(STORAGE_STATE_PATH)) return;
  if (!process.env.SESSION_STATE_B64) return;

  const cleaned = process.env.SESSION_STATE_B64.trim().replace(/\s+/g, "");
  const json = Buffer.from(cleaned, "base64").toString("utf-8");

  try {
    JSON.parse(json);
  } catch {
    console.error(
      "SESSION_STATE_B64 doesn't decode to valid JSON - it was likely truncated or corrupted when it was " +
        "copied into this variable. Rerun `npm run setup-session` and paste the FULL printed value " +
        "(ideally from the session-state.b64.txt file it writes, not from scrolled terminal output). " +
        "Ignoring it for now and falling back to a fresh login."
    );
    return;
  }

  fs.writeFileSync(STORAGE_STATE_PATH, json);
}

export async function getBrowserContext() {
  ensureSessionStateFromEnv();

  const browser = await chromium.launch({ headless: true });

  const hasSavedSession = fs.existsSync(STORAGE_STATE_PATH);
  const context = await browser.newContext(
    hasSavedSession ? { storageState: STORAGE_STATE_PATH } : {}
  );

  return { browser, context };
}

export async function dismissOverlays(page) {
  await page
    .locator("#onetrust-accept-btn-handler")
    .click({ timeout: 5000 })
    .catch(() => {});
  await page
    .locator('button[uid="no-parent-close-button"]')
    .click({ timeout: 5000 })
    .catch(() => {});
}

// Takes an existing page (reused across polls, not a fresh one each time)
// so the app's own session stays "open" the way it would for a real user
// who never closes the tab, rather than cold-starting a brand new browser
// and losing it every poll.
export async function login(page) {
  const response = await page.goto(RSA_URL, { waitUntil: "networkidle" });
  await assertNotBlocked(page, response);

  if (!page.url().includes("/home/login")) {
    await page.context().storageState({ path: STORAGE_STATE_PATH });
    return;
  }

  await dismissOverlays(page);

  await page.fill('input[formcontrolname="userName"]', process.env.RSA_EMAIL);
  await page.fill('input[formcontrolname="password"]', process.env.RSA_PASSWORD);
  await page.click('button[uid="no-parent-login-button"]');

  await page.waitForLoadState("networkidle");

  if (page.url().includes("/home/2fa")) {
    throw new LoginFailedError(
      "RSA is asking for an SMS verification code (/home/2fa/login). The bot can't answer that unattended - " +
        "complete login manually once with a headed browser, save the resulting session via context.storageState(), " +
        "and place it at session-state.json so future runs reuse that trusted-device session instead of hitting 2FA again."
    );
  }

  if (page.url().includes("/home/login")) {
    throw new LoginFailedError(
      "Login appears to have failed - check credentials or whether the site added a captcha step."
    );
  }

  await page.context().storageState({ path: STORAGE_STATE_PATH });
}
