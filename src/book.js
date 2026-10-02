export async function bookSlot(page, slot) {
  await slot.row.click();

  const confirmButton = page.locator('button:has-text("Confirm")');
  await confirmButton.click();

  await page.waitForSelector("text=Booking confirmed", { timeout: 15000 });

  return true;
}
