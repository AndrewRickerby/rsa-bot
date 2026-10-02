# RSA Driving Test Cancellation Watcher

Personal-use bot: logs into your own MyRoadSafety.ie account, polls for
cancellations matching your preferences, and either auto-books or sends
you a Discord alert when a match turns up.

## RSA's official warning, and how this bot handles it

MyRoadSafety currently shows this notice on the booking page:

> Raheny Driving Test Centre will be closing on Friday September 18th
> 2026. Any applications received from now to this date will be moved
> across to Killester Driving Test Centre.
>
> The RSA is not affiliated with any third-party apps purporting to offer
> driving test slot notifications and bookings. Customers who choose to
> use them are doing so at their own risk.
>
> Customers using third-party apps to book their driving test may find
> that their test has been cancelled and they have lost their fee.
>
> Users who continuously refresh the booking page will be blocked from
> MyRoadSafety for 24 hours, and our Customer Care Team is unable to
> unblock you, so please don't call to ask to be unblocked.

This is exactly the kind of tool that notice describes, so:

- **Centre closure**: this project's own `.env` uses `Killester` instead
  of `Raheny` in `TEST_CENTRES`, since Raheny closes 2026-09-18 and
  applications move to Killester. Update your own `.env` again if RSA
  changes the arrangement.
- **No affiliation / at your own risk**: this project has nothing to do
  with RSA. It automates your own login the same way you would manually.
  Use it knowing they've explicitly disclaimed it.
- **Risk of a cancelled test / lost fee**: real for any third-party
  booking tool, this one included. Double-check every auto-booked slot in
  MyRoadSafety yourself rather than assuming the bot got it right.
- **24h block for hammering the booking page**: enforced in code, not just
  documentation - see below.

## 1. Fill in the real selectors (do this first, nothing else will work otherwise)

Login (`src/session.js`) is done and verified against the real site -
RSA's login page is an Angular app behind a legal-warning modal and a
cookie-consent banner, which `login()` dismisses before filling in
`formcontrolname="userName"` / `formcontrolname="password"` and clicking
the real `uid="no-parent-login-button"` submit button.

What's still a placeholder and needs to be filled in once you can see the
real booking page (log in manually, then inspect it the same way - right
click -> Inspect, look for a stable `id`/`name`/`data-testid`/`formcontrolname`
rather than an auto-generated class like `css-1a2b3c`):

- Test centre picker on the booking page (`fetchAvailableSlots()` in
  `src/slots.js`)
- Each slot row + its date/time text (`fetchAvailableSlots()` in
  `src/slots.js`)
- The exact booking page URL (`BOOKING_URL` in `src/slots.js` currently
  just points at the site root)
- The click-to-select-slot action, confirm button, and success message
  (`bookSlot()` in `src/book.js`)

## Configuring your preferences

These env vars (set in `.env`, or in Railway's Variables tab) control
which slots count as a match. Leave any of them blank and it falls back
to "everywhere" - no restriction on that field at all:

- `TEST_CENTRES`: comma-separated exact centre names as they appear in
  the RSA site's dropdown/list, e.g. `Finglas,Killester`. Blank = check
  every centre listed on the booking page.
- `EARLIEST_DATE` / `LATEST_DATE`: inclusive date range, `YYYY-MM-DD`.
  Blank = no limit on that end of the range.
- `ALLOWED_DAYS_OF_WEEK`: comma-separated `0`-`6` (Sunday-Saturday), e.g.
  `1,2,3,4,5` for weekdays only. Blank = any day.
- `EARLIEST_TIME` / `LATEST_TIME`: inclusive 24-hour range, `HH:MM`.
  Blank = no limit on that end of the range.

`maxAutoBookings` in `src/config.js` is a separate safety limit (not a
preference) - how many slots the bot will auto-book in a single run
before it falls back to alert-only, so a bug can't book you into a pile
of tests.

## 2. Install

```bash
npm install
npx playwright install chromium
cp .env.example .env
# then edit .env with your real credentials and Discord webhook URL
```

For notifications, create a Discord webhook: open Discord, go to the
server/channel you want alerts in -> Edit Channel -> Integrations ->
Webhooks -> New Webhook -> Copy Webhook URL. Paste that into
`DISCORD_WEBHOOK_URL` in `.env`.

## 3. Handle RSA's SMS verification (do this before running unattended)

RSA asks for an SMS code on login (`/home/2fa/login`), which an unattended
bot obviously can't answer. The fix is to log in once yourself and let the
bot reuse that authenticated session instead of logging in fresh every
poll:

```bash
npm run setup-session
```

This opens a real (visible) browser with your `.env` credentials
pre-filled. Click Login, complete the SMS step on your phone, then come
back to the terminal and press Enter. It saves the logged-in session to
`session-state.json` and prints a base64 blob.

- **Running locally**: nothing else to do - `session-state.json` is
  picked up automatically by `getBrowserContext()` in `src/session.js`.
- **Running on Railway** (no screen to click through): paste the printed
  base64 blob into the `SESSION_STATE_B64` variable in Railway's
  Variables tab. On startup, `session.js` decodes it back into
  `session-state.json` if that file isn't already there.

In earlier testing, the saved session stopped working after under 2
hours - the bot was launching a brand new browser from scratch every
poll and throwing it away straight after, so there was never a live tab
for RSA's app to silently refresh the way it would for a real user who
just leaves the tab open. `src/index.js` now keeps one browser tab open
and reuses it across polls instead (recycled every 6h for memory hygiene,
but the saved session carries over that recycle) specifically to give
that silent refresh a chance to happen. This might fix it outright, or
RSA might cap the session at a fixed lifetime regardless of activity, in
which case you're still stuck redoing `npm run setup-session`
periodically - we won't know which until it's run for a few hours. Watch
the Railway logs after deploying this to see how long it actually lasts.

Either way, if the saved session does expire, the bot tries a fresh
credentialed login; if that fails twice in a row (whether from hitting
`/home/2fa/login` again, or anything else), it stops retrying every few
minutes, sends one Discord alert, and backs off for 2 hours before trying
again - instead of hammering RSA's login endpoint with your real
credentials. Rerun `npm run setup-session` and update `SESSION_STATE_B64`
any time you get that alert to recover immediately rather than waiting
out the cooldown.

## 4. Test in alert-only mode first

Leave `AUTO_BOOK_ENABLED=false` in `.env` and run:

```bash
npm start
```

Watch the console output and confirm it logs in successfully and reports
slot counts. Fix selectors until this works cleanly before touching
auto-booking.

## 5. Turn on auto-booking

Once you're confident the scraping is accurate, set `AUTO_BOOK_ENABLED=true`.
It will book at most one slot per run (`maxAutoBookings` in `src/config.js`)
and then stop booking further ones automatically, just to keep a single bug
from booking you into a pile of tests. Bump that number once you trust it.

## 6. Deploy on Railway

This repo includes a `Dockerfile` (Railway's default Nixpacks builder
doesn't have the system libraries Chromium needs, so the Dockerfile
installs them via `playwright install --with-deps`) and a `railway.json`
that tells Railway to build from it.

1. Push this repo to GitHub (or use the Railway CLI to deploy from your
   local folder without GitHub - see option B below).
2. In the [Railway dashboard](https://railway.app), **New Project ->
   Deploy from GitHub repo**, and pick this repo. Railway will detect
   `railway.json` and build the Dockerfile automatically.
3. Open the service -> **Variables** tab and add everything from
   `.env.example` with your real values (`RSA_EMAIL`, `RSA_PASSWORD`,
   `DISCORD_WEBHOOK_URL`, `TEST_CENTRES`, `EARLIEST_DATE`, `LATEST_DATE`,
   `ALLOWED_DAYS_OF_WEEK`, `EARLIEST_TIME`, `LATEST_TIME`,
   `POLL_MIN_SECONDS`, `POLL_MAX_SECONDS`, `AUTO_BOOK_ENABLED`,
   `SESSION_STATE_B64` from `npm run setup-session` - see step 3 above).
   Railway injects these as environment variables - you don't need a
   `.env` file in the deployed container.
4. This is a background worker, not a web server, so you don't need to
   generate a public domain for it. Deploy, then check
   **Deployments -> View Logs** to confirm it logs in and starts polling.
5. Leave `AUTO_BOOK_ENABLED=false` for your first deploy and watch the
   logs for a few poll cycles before switching it to `true`.

**Session persistence note:** `session-state.json` is wiped on every new
deploy (ephemeral container filesystem), but `session.js` re-creates it
from `SESSION_STATE_B64` on startup if it's missing - so a redeploy just
restores the same session instead of hitting RSA's login/2FA page again.
This only breaks once RSA actually invalidates that saved session (see
step 3), at which point you rerun `npm run setup-session` and update the
variable. If you'd rather the file just persist across deploys instead,
a [Railway Volume](https://docs.railway.app/reference/volumes) mounted
at `/app` works too, but isn't necessary.

**Option B - deploy without GitHub, via CLI:**

```bash
npm install -g @railway/cli
railway login
railway init
railway up
# then set variables either in the dashboard or:
railway variables set RSA_EMAIL=... RSA_PASSWORD=... DISCORD_WEBHOOK_URL=...
```

### Alternative: your own server (systemd)

If you'd rather run this on a VPS/home server instead of Railway, there's
still a `rsa-bot.service` file for that:

```bash
sudo useradd -r -s /bin/false rsa-bot
sudo mkdir -p /opt/rsa-bot
sudo cp -r . /opt/rsa-bot
sudo chown -R rsa-bot:rsa-bot /opt/rsa-bot
sudo cp rsa-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rsa-bot
sudo journalctl -u rsa-bot -f   # watch logs
```

## Notes on staying under the radar

- `POLL_MIN_SECONDS` / `POLL_MAX_SECONDS` in `.env` control the check
  interval with randomised jitter (default 3-5 min). Don't go much
  tighter than this - the commercial apps doing the same thing check on
  a similar cadence, and hammering it faster is the fastest way to get
  your account rate-limited or flagged. `src/index.js` also clamps
  `POLL_MIN_SECONDS` to a hard floor of 120s no matter what `.env` says,
  so a typo can't turn this into the "continuously refreshing" behaviour
  RSA explicitly blocks for.
- If the site ever does return a block/rate-limit page or a 403/429/503
  (`src/blockGuard.js`), the bot stops polling entirely, sends a Discord
  alert once, and waits a full 24h + buffer before trying again - matching RSA's
  stated block duration, since their Customer Care team can't lift it
  early and retrying sooner would just prolong it.
- The session is saved to `session-state.json` after first login so the
  bot isn't re-authenticating on every single poll. In practice this
  matters even more than usual here, since RSA's 2FA means re-authenticating
  isn't just slower, it's a wall the bot can't get past unattended - see
  step 3.
- This is almost certainly against RSA's terms of use even though
  several commercial apps do the same thing openly. Worst realistic case
  is your account gets rate-limited or temporarily locked, not anything
  more severe, but it's worth going in aware of that.
