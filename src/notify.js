const DISCORD_CONTENT_LIMIT = 1900;

function truncate(text) {
  return text.length > DISCORD_CONTENT_LIMIT
    ? `${text.slice(0, DISCORD_CONTENT_LIMIT)}\n...(truncated)`
    : text;
}

export async function sendDiscordMessage(content) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not set.");
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: truncate(content) }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discord webhook request failed: ${res.status} ${body}`);
  }
}

export async function notifySlotBooked(slot) {
  await sendDiscordMessage(
    `✅ **Driving test booked:** ${slot.centre} on ${slot.date} at ${slot.time}\n` +
      `Double check MyRoadSafety to confirm the details.`
  );
}

export async function notifySlotFound(slot) {
  await sendDiscordMessage(
    `🔔 **Driving test slot found:** ${slot.centre} on ${slot.date} at ${slot.time}\n` +
      `Auto-booking is disabled or the limit was reached - log in to MyRoadSafety now to grab it yourself.`
  );
}

export async function notifyError(err) {
  await sendDiscordMessage(
    `⚠️ **Driving test bot error** - it may need attention:\n\`\`\`\n${err.stack || err.message || err}\n\`\`\``
  );
}

export async function notifyBlocked(resumeAt) {
  await sendDiscordMessage(
    `⛔ **Driving test bot: MyRoadSafety blocked us, pausing 24h**\n` +
      `MyRoadSafety appears to have blocked this account/IP, most likely for checking too often. ` +
      `RSA support can't lift this early, so the bot is pausing entirely until ${resumeAt.toISOString()} ` +
      `instead of retrying.\n\nNo action needed - it'll resume automatically.`
  );
}

export async function notifyLoginFailing(resumeAt, failureCount) {
  await sendDiscordMessage(
    `🔒 **Driving test bot: ${failureCount} login failures in a row, pausing**\n` +
      `The saved session likely expired and a fresh login isn't getting through (SMS verification, or RSA ` +
      `treating this host differently). Pausing login attempts until ${resumeAt.toISOString()} instead of ` +
      `retrying every few minutes.\n\nRun \`npm run setup-session\` again and update SESSION_STATE_B64, then ` +
      `redeploy to recover immediately instead of waiting.`
  );
}
