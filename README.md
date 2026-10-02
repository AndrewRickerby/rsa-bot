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

- **Centre closure**: `src/config.js` uses `Killester` instead of `Raheny`,
  since Raheny closes 2026-09-18 and applications move to Killester. Update
  this yourself again if RSA changes the arrangement.
- **No affiliation / at your own risk**: this project has nothing to do
  with RSA. It automates your own login the same way you would manually.
  Use it knowing they've explicitly disclaimed it.
- **Risk of a cancelled test / lost fee**: real for any third-party
  booking tool, this one included. Double-check every auto-booked slot in
  MyRoadSafety yourself rather than assuming the bot got it right.
- **24h block for hammering the booking page**: enforced in code, not just
  documentation - see below.

## 1. Fill in the real selectors (do this first, nothing else will work otherwise)

This is the only real work left. Playwright needs exact CSS selectors for:

- Login form: email field, password field, submit button (`src/session.js`)
- Something that only appears once logged in, e.g. a nav link (`src/session.js`)
- Test centre picker on the booking page (`src/slots.js`)
- Each slot row + its date/time text (`src/slots.js`)
- The click-to-select-slot action, confirm button, and success message (`src/book.js`)

How to find them:
1. Log in to myroadsafety.rsa.ie normally in Chrome.
2. Right-click the element in question -> Inspect.
3. Look for a stable `id`, `name`, or `data-testid` attribute (avoid
   auto-generated classes like `css-1a2b3c`, they change on every deploy).
4. Swap the placeholder selector in the code for the real one.

The placeholder selectors live in `login()` and `getBrowserContext()` in
`src/session.js`, `fetchAvailableSlots()` in `src/slots.js`, and
`bookSlot()` in `src/book.js` - every `page.locator(...)`,
`page.fill(...)`, `page.click(...)`, and `page.selectOption(...)` call in
those functions is a guess that needs to be checked against the real
site.

## Configuring your preferences

`src/config.js` controls which slots count as a match:

- `testCentres`: exact centre names as they appear in the RSA site's
  dropdown/list.
- `earliestDate` / `latestDate`: inclusive date range, `YYYY-MM-DD`.
- `allowedDaysOfWeek`: `0`-`6` (Sunday-Saturday); empty array allows any day.
- `earliestTime` / `latestTime`: inclusive 24-hour range, `HH:MM`.
- `maxAutoBookings`: how many slots the bot will auto-book in a single run
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

## 3. Test in alert-only mode first

Leave `AUTO_BOOK_ENABLED=false` in `.env` and run:

```bash
npm start
```

Watch the console output and confirm it logs in successfully and reports
slot counts. Fix selectors until this works cleanly before touching
auto-booking.

## 4. Turn on auto-booking

Once you're confident the scraping is accurate, set `AUTO_BOOK_ENABLED=true`.
It will book at most one slot per run (`maxAutoBookings` in `src/config.js`)
and then stop booking further ones automatically, just to keep a single bug
from booking you into a pile of tests. Bump that number once you trust it.

## 5. Deploy on Railway

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
   `DISCORD_WEBHOOK_URL`, `POLL_MIN_SECONDS`, `POLL_MAX_SECONDS`,
   `AUTO_BOOK_ENABLED`). Railway injects these as environment variables -
   you don't need a `.env` file in the deployed container.
4. This is a background worker, not a web server, so you don't need to
   generate a public domain for it. Deploy, then check
   **Deployments -> View Logs** to confirm it logs in and starts polling.
5. Leave `AUTO_BOOK_ENABLED=false` for your first deploy and watch the
   logs for a few poll cycles before switching it to `true`.

**Session persistence note:** the bot saves `session-state.json` to the
container's filesystem so it doesn't log in on every poll. That file
survives restarts but is wiped on every new deploy, so each redeploy
costs one extra login - not a problem on its own, just worth knowing.
If you want it to persist across deploys too, add a
[Railway Volume](https://docs.railway.app/reference/volumes) mounted at
`/app` (or wherever you set `STORAGE_STATE_PATH` to point) for the
service.

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
  bot isn't re-authenticating on every single poll.
- This is almost certainly against RSA's terms of use even though
  several commercial apps do the same thing openly. Worst realistic case
  is your account gets rate-limited or temporarily locked, not anything
  more severe, but it's worth going in aware of that.
