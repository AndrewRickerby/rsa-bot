import "dotenv/config";
import { getBrowserContext, login, LoginFailedError } from "./session.js";
import { fetchAvailableSlots, findMatchingSlot } from "./slots.js";
import { bookSlot } from "./book.js";
import {
  notifySlotBooked,
  notifySlotFound,
  notifyError,
  notifyBlocked,
  notifyLoginFailing,
} from "./notify.js";
import { BlockedError } from "./blockGuard.js";
import { maxAutoBookings } from "./config.js";

const AUTO_BOOK_ENABLED = process.env.AUTO_BOOK_ENABLED === "true";

const FLOOR_SECONDS = 120;
const configuredMin = Number(process.env.POLL_MIN_SECONDS || 180);
const configuredMax = Number(process.env.POLL_MAX_SECONDS || 300);
if (configuredMin < FLOOR_SECONDS) {
  console.warn(
    `POLL_MIN_SECONDS=${configuredMin} is below the ${FLOOR_SECONDS}s floor; clamping to avoid getting blocked.`
  );
}
const MIN_WAIT = Math.max(configuredMin, FLOOR_SECONDS) * 1000;
const MAX_WAIT = Math.max(configuredMax, FLOOR_SECONDS) * 1000;

const BLOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000 + 10 * 60 * 1000;

const LOGIN_FAILURE_THRESHOLD = 2;
const LOGIN_FAILURE_COOLDOWN_MS = 2 * 60 * 60 * 1000;

// The browser tab is kept open and reused across polls instead of
// cold-starting a fresh one every time, so the app's own session stays
// "open" the way it would for a real user who never closes the tab - the
// best shot at avoiding getting signed out every couple of hours. It's
// still recycled periodically to keep memory bounded on a long-running
// host; the saved session carries over that recycle, so it doesn't cost
// a fresh login.
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

let bookingsMade = 0;
let consecutiveLoginFailures = 0;

let browser = null;
let context = null;
let page = null;
let sessionStartedAt = null;

function randomWait() {
  return MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT);
}

async function closeSession() {
  if (browser) {
    await browser.close().catch(() => {});
  }
  browser = null;
  context = null;
  page = null;
  sessionStartedAt = null;
}

async function ensureSession() {
  if (browser && Date.now() - sessionStartedAt > SESSION_MAX_AGE_MS) {
    console.log("Recycling the browser after 6h to keep memory bounded (saved session carries over).");
    await closeSession();
  }

  if (!browser) {
    ({ browser, context } = await getBrowserContext());
    page = await context.newPage();
    sessionStartedAt = Date.now();
  }
}

async function pollOnce() {
  await ensureSession();

  await login(page);
  consecutiveLoginFailures = 0;

  const slots = await fetchAvailableSlots(page);
  console.log(`[${new Date().toISOString()}] Checked ${slots.length} slot(s) across configured centres.`);

  const match = findMatchingSlot(slots);
  if (!match) return;

  console.log(`Match found: ${match.centre} ${match.date} ${match.time}`);

  if (AUTO_BOOK_ENABLED && bookingsMade < maxAutoBookings) {
    await bookSlot(page, match);
    bookingsMade += 1;
    await notifySlotBooked(match);
    console.log("Booked and notified. Stopping further auto-bookings this run (limit reached).");
  } else {
    await notifySlotFound(match);
  }
}

async function main() {
  console.log("Starting RSA driving test watcher.");
  console.log(`Auto-booking is ${AUTO_BOOK_ENABLED ? "ENABLED" : "disabled (alert-only)"}.`);

  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      // Any failure leaves the page/context in an unknown state, so start
      // clean next time rather than keep reusing something possibly broken.
      // The saved session on disk (from the last successful check) means
      // this doesn't cost a fresh login in the common case.
      await closeSession();

      if (err instanceof BlockedError) {
        console.error(`Blocked by MyRoadSafety: ${err.message}`);
        const resumeAt = new Date(Date.now() + BLOCK_COOLDOWN_MS);
        try {
          await notifyBlocked(resumeAt);
        } catch (notifyErr) {
          console.error("Also failed to send blocked-notice alert:", notifyErr);
        }
        console.log(`Pausing until ${resumeAt.toISOString()} instead of retrying.`);
        await new Promise((resolve) => setTimeout(resolve, BLOCK_COOLDOWN_MS));
        continue;
      }

      if (err instanceof LoginFailedError) {
        consecutiveLoginFailures += 1;
        console.error(`Login failed (${consecutiveLoginFailures} in a row): ${err.message}`);

        if (consecutiveLoginFailures >= LOGIN_FAILURE_THRESHOLD) {
          const resumeAt = new Date(Date.now() + LOGIN_FAILURE_COOLDOWN_MS);
          try {
            await notifyLoginFailing(resumeAt, consecutiveLoginFailures);
          } catch (notifyErr) {
            console.error("Also failed to send login-failure alert:", notifyErr);
          }
          console.log(`Pausing until ${resumeAt.toISOString()} instead of retrying logins back-to-back.`);
          await new Promise((resolve) => setTimeout(resolve, LOGIN_FAILURE_COOLDOWN_MS));
          consecutiveLoginFailures = 0;
          continue;
        }
      } else {
        console.error("Error during poll:", err);
        try {
          await notifyError(err);
        } catch (notifyErr) {
          console.error("Also failed to send error alert:", notifyErr);
        }
      }
    }

    const wait = randomWait();
    console.log(`Sleeping ${Math.round(wait / 1000)}s before next check.`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

main();
