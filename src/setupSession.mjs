import "dotenv/config";
import { chromium } from "playwright";
import { createInterface } from "readline/promises";
import { stdin, stdout, platform } from "process";
import fs from "fs";
import { spawn } from "child_process";
import { RSA_URL, STORAGE_STATE_PATH, dismissOverlays } from "./session.js";

const BASE64_OUTPUT_PATH = "./session-state.b64.txt";

function tryCopyToClipboard(text) {
  return new Promise((resolve) => {
    const command = platform === "darwin" ? "pbcopy" : platform === "win32" ? "clip" : "xclip";
    const args = platform === "linux" ? ["-selection", "clipboard"] : [];
    const proc = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
    proc.stdin.end(text);
  });
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(RSA_URL, { waitUntil: "networkidle" });
await dismissOverlays(page);

await page
  .fill('input[formcontrolname="userName"]', process.env.RSA_EMAIL || "")
  .catch(() => {});
await page
  .fill('input[formcontrolname="password"]', process.env.RSA_PASSWORD || "")
  .catch(() => {});

console.log("\nA browser window has opened with your email/password pre-filled.");
console.log("1. Review the fields, click Login yourself.");
console.log("2. Complete the SMS verification step if RSA asks for one.");
console.log("3. Once you're fully logged in (past any 2FA page), come back here.\n");

const rl = createInterface({ input: stdin, output: stdout });
await rl.question("Press Enter once you're logged in... ");
rl.close();

if (page.url().includes("/home/login") || page.url().includes("/home/2fa")) {
  console.warn(
    `\nWarning: the browser is still on ${page.url()}, which doesn't look fully logged in. ` +
      `Saving the session anyway, but it probably won't work - rerun this script once you can ` +
      `confirm you're actually past login.`
  );
}

await context.storageState({ path: STORAGE_STATE_PATH });
await browser.close();

const savedState = fs.readFileSync(STORAGE_STATE_PATH, "utf-8");
const encoded = Buffer.from(savedState, "utf-8").toString("base64");
fs.writeFileSync(BASE64_OUTPUT_PATH, encoded);

const copied = await tryCopyToClipboard(encoded);

console.log(`\nSaved session to ${STORAGE_STATE_PATH}.`);
console.log("Running locally: nothing else to do, the bot will reuse this file automatically.");
console.log(
  `\nDeploying on Railway: paste the value as the SESSION_STATE_B64 variable ` +
    `(Railway dashboard -> your service -> Variables), then redeploy.`
);
console.log(
  copied
    ? "It's already on your clipboard - paste it directly, don't retype or re-copy from the terminal " +
        "(long single-line values are easy to truncate when selecting manually)."
    : `Couldn't copy it to your clipboard automatically. It's also saved to ${BASE64_OUTPUT_PATH} - open ` +
        "that file and copy its full contents rather than selecting from this terminal output, since a " +
        "partial copy produces a corrupt session that fails with a confusing JSON error."
);
