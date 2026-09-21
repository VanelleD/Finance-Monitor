# Ledger — a private finance monitor

A single-user web app for tracking money in, money out, what you own, what you owe,
and what you're aiming at. It runs on your own machine against a SQLite file you
control, and deploys to Cloudflare's free tier when you want it on your phone.

Same codebase both ways — Cloudflare D1 *is* SQLite, so the schema, the queries and
the maths don't change between them.

<!-- Design canvas: https://claude.ai/artifact/XpaFE9gfq8kTCKaK3t9vWu -->

## What it does

| Screen | What's on it |
|---|---|
| **Dashboard** | Net worth, money in vs out for the month, where it went by category, recent activity, target progress |
| **Transactions** | The full ledger, filterable by direction, category, money source and free text, with CSV export |
| **Net worth** | Assets and liabilities side by side, a shared-scale composition bar, and which debt costs most to carry |
| **Targets** | Four kinds of goal, each measured from the entries you already record |

## Running it locally

```bash
npm install
cp .env.example .env
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"   # paste into SESSION_SECRET
npm run seed       # optional: six months of sample data to look at
npm run dev        # UI on :5173, API on :8787
```

Open http://localhost:5173 and set a passphrase. Your data lives in
`data/finance.sqlite` — back it up by copying that file.

To run it as one process with no Vite in the loop:

```bash
npm run build && npm run dev:api   # everything on http://localhost:8787
```

## Deploying it free

Cloudflare Workers with static assets and D1. The free plan allows 100,000
requests a day and 5M row-reads / 100k row-writes a day, which for one person
logging transactions is orders of magnitude more headroom than you need.

**Try it against the real runtime first, no account needed.** This runs the
Workers runtime and a local D1 on your machine, so you find out it works before
you sign up for anything:

```bash
echo "SESSION_SECRET=$(node -e 'console.log(crypto.randomUUID()+crypto.randomUUID())')" > .dev.vars
npm run dev:cf        # http://localhost:8787
```

Then, to put it online:

```bash
npx wrangler login                        # opens a browser, authorises this machine
npx wrangler d1 create finance-monitor    # copy the printed database_id
#   paste it into wrangler.toml, replacing PASTE_YOUR_DATABASE_ID_HERE
npx wrangler secret put SESSION_SECRET    # paste a long random string when prompted
npm run deploy
```

Wrangler prints the live URL, something like
`https://finance-monitor.<your-subdomain>.workers.dev`. The schema applies itself
on the first request, so there is no migration step.

### Open it and set your passphrase immediately

The first visitor to a fresh deployment is the one who sets the passphrase — that
is how a single-user app with no signup can work at all. The hostname is not
published anywhere, but it is on the public internet, so **claim it as soon as it
deploys**.

If you ever load it and see "Welcome back" instead of "Set your passphrase" on a
deployment you have not set up yet, someone else got there first. Wipe it and
start over:

```bash
npx wrangler d1 execute finance-monitor --remote \
  --command "DELETE FROM settings WHERE key LIKE 'auth.%'"
```

### Why the login is built in rather than handed to Cloudflare Access

Access is free for up to 50 users, but it can only properly protect a domain you
own — it cannot reliably gate the default `*.workers.dev` hostname. Rather than
require you to buy a domain, the app has its own passphrase gate. If you do point
a domain at the Worker later, putting Access in front of it as a second layer is
worth doing.

### Looking at the deployed database

```bash
npx wrangler d1 execute finance-monitor --remote --command "SELECT COUNT(*) FROM entries"
npx wrangler tail                         # live logs
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite + API with hot reload |
| `npm run dev:cf` | The real Workers runtime and a local D1, no account needed |
| `npm run build` | Build the client into `dist/client` |
| `npm test` | 74 unit and integration tests |
| `npm run typecheck` | `tsc --noEmit` across client, server and tests |
| `npm run seed` | Sample data (`-- --reset` to replace what's there) |
| `npm run deploy` | Build, then `wrangler deploy` |

## How it's put together

```
src/shared/     money, dates, and every derived number — pure, tested, runs everywhere
src/server/     Hono API; one narrow Db interface over better-sqlite3 or D1
src/client/     React SPA; the design system as CSS tokens
tests/          unit tests for the maths, integration tests against a real database
```

Four decisions worth knowing about:

**Money is integer cents, everywhere.** Never a float. `parseMoney` refuses input
with more than two decimal places rather than silently rounding someone's money.

**Nothing derived is stored.** Net worth, account balances, savings rate and target
progress are always recomputed from entries, assets and liabilities by
`src/shared/derive.ts`. They can't drift out of sync with the ledger, and because
that module is pure it runs identically on the server, in the browser and in tests.

**Transfers are a third direction, not income or expense.** Moving $600 from
checking to savings is neither. Counting it either way would corrupt the savings
rate, which is the main thing worth knowing.

**Key derivation runs in the browser.** Cloudflare caps a request at 10ms of CPU,
which 600k rounds of PBKDF2 would blow straight through. The client stretches the
passphrase and sends the 32-byte derived key over TLS; the server stores and
compares a SHA-256 of it. The work factor is unchanged for an attacker holding the
database — guessing still costs 600k iterations per attempt — while the server does
almost nothing.

## Security, honestly

- The passphrase gates **access**. It does **not** encrypt the database. Anyone with
  the SQLite file, or with your Cloudflare account, can read your figures.
- There's no password reset. Forget the passphrase and you'll need to clear the
  `auth.verifier` row in the `settings` table to set a new one.
- Sessions are signed cookies (HttpOnly, SameSite=Lax, Secure in production) with a
  30-day life. Eight wrong attempts locks logins for 15 minutes.
- On a fresh deployment, whoever loads it first sets the passphrase. Claim it the
  moment it goes up (see above).
- CSV export quotes every cell and defuses leading `=`, `+`, `-` and `@`, so a payee
  named `=HYPERLINK(...)` can't execute when the file is opened in a spreadsheet.
- Entry search escapes `%` and `_` so they're matched as text, not wildcards.

## Charts

Every chart follows one set of mark specs: bars cap at 24px with a 4px rounded top,
lines are 2px, end dots are 8px with a 2px surface ring, area fills sit at 10%
opacity, gridlines are 1px solid and recessive, two or more series always get a
legend, and text never wears a series colour.

Both palettes were checked with a validator rather than by eye. Every categorical
colour clears the lightness band, the chroma floor, colour-blind separation under
simulated protanopia and deuteranopia, normal-vision separation, and 3:1 contrast
against the surface it's drawn on — in dark mode and light.

Money in is teal and money out is amber, deliberately not green and red: that pair
is the single worst choice for colour blindness. Direction is also carried by an
arrow and a sign, so colour is never the only channel.

## What isn't built yet

- **Recurring entries** can be flagged `repeatRule: "monthly"`, but nothing
  generates the next occurrence yet — the flag is stored, not acted on.
- **The net-worth trend** on the dashboard is traced backwards from today through
  monthly flow, so it reflects money saved and spent but not revaluations. It's
  labelled as an estimate on the card. Storing monthly snapshots would make it exact.
- **Multi-currency.** Everything is USD; the column exists but nothing converts.
- **CSV import**, bank sync, and categories/money-source management screens.
