import "dotenv/config";
import { getBrowserContext, login } from "./session.js";
import { fetchAvailableSlots, findMatchingSlot } from "./slots.js";
import { bookSlot } from "./book.js";
import { notifySlotBooked, notifySlotFound, notifyError, notifyBlocked } from "./notify.js";
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

let bookingsMade = 0;

function randomWait() {
  return MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT);
}

async function pollOnce() {
  const { browser, context } = await getBrowserContext();
  try {
    await login(context);
    const page = await context.newPage();

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
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("Starting RSA driving test watcher.");
  console.log(`Auto-booking is ${AUTO_BOOK_ENABLED ? "ENABLED" : "disabled (alert-only)"}.`);

  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      if (err instanceof BlockedError) {
        console.error(`Blocked by MyRoadSafety: ${err.message}`);
        const resumeAt = new Date(Date.now() + BLOCK_COOLDOWN_MS);
        try {
          await notifyBlocked(resumeAt);
        } catch (mailErr) {
          console.error("Also failed to send blocked-notice email:", mailErr);
        }
        console.log(`Pausing until ${resumeAt.toISOString()} instead of retrying.`);
        await new Promise((resolve) => setTimeout(resolve, BLOCK_COOLDOWN_MS));
        continue;
      }

      console.error("Error during poll:", err);
      try {
        await notifyError(err);
      } catch (mailErr) {
        console.error("Also failed to send error email:", mailErr);
      }
    }

    const wait = randomWait();
    console.log(`Sleeping ${Math.round(wait / 1000)}s before next check.`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

main();
