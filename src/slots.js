import { preferences } from "./config.js";
import { assertNotBlocked } from "./blockGuard.js";

const BOOKING_URL = "https://myroadsafety.rsa.ie";

export async function fetchAvailableSlots(page) {
  const response = await page.goto(BOOKING_URL, { waitUntil: "networkidle" });
  await assertNotBlocked(page, response);

  const results = [];

  for (const centre of preferences.testCentres) {
    await page.selectOption('select[name="testCentre"]', { label: centre }).catch(() => {});
    await page.waitForTimeout(800);

    const rows = await page.locator(".slot-row").all();

    for (const row of rows) {
      const dateText = await row.locator(".slot-date").innerText().catch(() => null);
      const timeText = await row.locator(".slot-time").innerText().catch(() => null);
      if (!dateText || !timeText) continue;

      results.push({
        centre,
        date: normaliseDate(dateText),
        time: timeText.trim(),
        row,
      });
    }
  }

  return results;
}

function normaliseDate(rawText) {
  const parsed = new Date(rawText.trim());
  if (isNaN(parsed)) return null;
  return parsed.toISOString().slice(0, 10);
}

export function findMatchingSlot(slots) {
  return slots.find((slot) => {
    if (!slot.date) return false;
    if (slot.date < preferences.earliestDate) return false;
    if (slot.date > preferences.latestDate) return false;

    if (preferences.allowedDaysOfWeek.length > 0) {
      const dow = new Date(slot.date).getDay();
      if (!preferences.allowedDaysOfWeek.includes(dow)) return false;
    }

    if (slot.time < preferences.earliestTime || slot.time > preferences.latestTime) {
      return false;
    }

    return true;
  });
}
