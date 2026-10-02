export class BlockedError extends Error {}

const BLOCK_PHRASES = [
  "you have been temporarily blocked",
  "you've been temporarily blocked",
  "too many requests",
  "please try again later",
  "access denied",
  "request blocked",
];

export async function assertNotBlocked(page, response) {
  if (response && [403, 429, 503].includes(response.status())) {
    throw new BlockedError(
      `Got HTTP ${response.status()} loading MyRoadSafety - likely rate-limited/blocked.`
    );
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lower = bodyText.toLowerCase();
  if (BLOCK_PHRASES.some((phrase) => lower.includes(phrase))) {
    throw new BlockedError("MyRoadSafety is showing a block/rate-limit page.");
  }
}
