# Hisaab — Group Expense Settlement Tool: Design & Build Plan

## Context

Sumit wants a Splitwise-class group expense app with an excellent UX and a broad feature set, built
greenfield, pushed to the **sumittripathi07** GitHub account (public repo), and deployed on **GCP**.
Goal: a polished, India-first (INR + UPI) but multi-currency product that works as a real tool for
trips, flatmates and events, and doubles as a portfolio piece.

**Decided by Sumit:** web app + installable PWA · Next.js + Postgres · GCP Cloud Run + Cloud SQL ·
settle-up = record payments + UPI deep links/QR · auth = Google + email magic link · new dedicated
GCP project · public repo · v1 must include AI receipt scanning, multi-currency + live FX,
recurring expenses + reminders, real-time sync + web push · settlements count immediately and the
payee can dispute them · no custom domain (run.app URL, Gmail SMTP) · scale to zero (no warm
instance).

**My calls (flag any you want changed):** name "Hisaab" (repo `sumittripathi07/hisaab`), region
`asia-south1` (Mumbai), Better Auth, Prisma, Tailwind v4 + shadcn/ui, Claude for receipt OCR,
Postgres LISTEN/NOTIFY + SSE for real-time (no Redis), gcloud bash script for infra (no Terraform),
settle-up is per group in v1 (settling with a friend across all shared groups comes later),
dashboard totals are shown per currency plus an approximate total in your default currency,
placeholder claim rules (§2).

### Goals
- Adding an expense takes < 10 seconds on a phone; settling up takes 2 taps.
- Money is always exact: integer minor units, splits always sum to the total, balances always net to zero.
- Feels native: installable, fast, animated, dark mode, works on a flaky connection for viewing.

### Non-goals (v1)
- Native iOS/Android apps, moving money in-app (no payment gateway), bank/SMS auto-import,
  business/accounting features (GST invoices, ledgers), admin console.

### Anti-goals (fails even if it "works")
- Any rounding drift (a paisa lost or created).
- A user seeing or changing data of a group they're not in.
- Slow, form-heavy expense entry. Secrets committed to the public repo.

---

## Pre-requisites Sumit must do (I can't do these for you)
1. **GitHub:** `gh` is currently logged in as `sumit-t-edmissioncrm`. Run `gh auth login` and add
   `sumittripathi07`, then `gh auth switch -u sumittripathi07`.
2. **GCP billing:** I'll create the project with `gcloud`. You'll need to confirm the billing-account
   link (it costs about $10–15/month, mostly the Cloud SQL `db-f1-micro` instance).
3. **Google OAuth client:** create it in the console (consent screen + Web client). I'll give you the
   exact redirect URIs once Cloud Run has a URL.
4. **Secrets you add yourself** (`gcloud secrets versions add …`, I'll give you the commands):
   Anthropic API key, Google OAuth client secret, SMTP credentials.
5. **Email sending:** Gmail SMTP with an app password (no domain needed, 500/day cap, sends from
   your Gmail). Create the app password at myaccount.google.com → Security → App passwords. The app
   only reads `SMTP_URL`, so you can move to Resend + a domain later without code changes.

---

## Tech Stack

| Layer | Choice |
|---|---|
| App | Next.js (latest stable, App Router, React 19, TypeScript strict), Server Actions for mutations, Route Handlers for SSE/cron/uploads |
| UI | Tailwind v4, shadcn/ui, `motion` (animations), `sonner` (toasts with undo), `cmdk` (command palette), `vaul` (mobile drawers), Recharts (via shadcn charts), lucide icons |
| Data fetching | TanStack Query on the client for live-updating lists; RSC for first paint |
| Validation | Zod schemas shared by forms and server actions |
| Auth | Better Auth: Google provider + magic-link plugin, Prisma adapter, built-in rate limiting |
| DB | PostgreSQL 16 on Cloud SQL, Prisma ORM + migrations |
| Real-time | Postgres `LISTEN/NOTIFY` → per-instance fan-out → SSE stream per group |
| Push | Web Push (VAPID) via `web-push`; service worker via Serwist |
| Email | Nodemailer over `SMTP_URL`, React Email templates |
| Files | GCS private bucket, signed upload/view URLs; client-side resize before upload |
| AI OCR | Anthropic SDK, `claude-haiku-5-5` vision with JSON-schema structured output (load `claude-api` skill when implementing) |
| FX | `open.er-api.com` daily rates (160+ currencies, no key), cached in DB; manual override per expense |
| QR | `qrcode` lib for UPI QR on desktop |
| Tests | Vitest (money core + server actions), Playwright (critical e2e flows) |
| CI/CD | GitHub Actions → Artifact Registry → Cloud Run; Workload Identity Federation (no JSON keys) |

---

## Feature Spec (end to end)

### 1. Auth & onboarding
- Sign in with Google (one tap) or email magic link. No passwords.
- First-run onboarding (3 steps): name + avatar, default currency (auto-detected from locale), UPI ID
  (optional, validated `name@bank` format), and "create your first group" / "join with a link".
- Profile & settings: name, avatar, default currency, UPI ID, timezone, notification preferences
  (per channel × per event type), theme (system/light/dark).
- Session list with "sign out other devices". Account deletion (anonymises the user's member rows so
  group history stays intact) and "export my data" (JSON).

### 2. Groups & people
- Create group: name, emoji/cover colour, type (Trip / Home / Couple / Event / Other), base currency,
  "simplify debts" toggle (default on).
- **Members are `GroupMember` rows, not users.** That allows **placeholder members** ("Rahul", no
  account yet). Each placeholder has a claim link; when Rahul signs up via that link he takes over the
  placeholder and all of its history. Claim rules (my call): claim links are single-use and an admin
  can regenerate them. An email-invited placeholder can only be claimed by an account with that same
  email. A claim is refused if the person is already a member of the group. Merging two member rows
  is a later feature.
- Invite: shareable link + QR (rotatable invite code), invite by email (creates a placeholder + sends
  an email), native share sheet (`navigator.share`) to WhatsApp.
- Roles: owner / admin / member. Admins can edit group settings and remove members. Anyone can add
  expenses. Members can edit or delete the expenses they created, and admins can edit or delete any.
- Leave a group only when your balance is zero (otherwise the UI shows you what to settle). Archive a
  group (read-only, hidden from the dashboard).
- **1:1 expenses with a friend** are implicit two-person "direct" groups (`type = DIRECT`), so all
  logic is reused. The "Friends" tab lists people you share groups with and your net balance with each.

### 3. Expenses
- **Fast add flow** (bottom-sheet on mobile): a big custom amount keypad → description (auto-suggests
  a category + emoji from keywords and past entries) → "paid by you, split equally" defaults → save.
  Every field is a tap-to-change chip. "Save & add another".
- Fields: amount, currency, description, category, date, notes, receipt photo, payer(s), split.
- **Multiple payers** ("I paid ₹600, Amit paid ₹400").
- **Split methods:** equal (choose which members), exact amounts, percentages, shares (e.g. 2:1:1),
  itemized (from a receipt), plus per-person **adjustments** (+/−) on top of any method. Live
  validation shows "₹120 left to assign".
- Rounding: largest-remainder allocation, so leftover paise go deterministically to the
  earliest-sorted members and the sum always equals the total.
- Edit with optimistic concurrency (`version` column). On conflict: "Amit edited this just now —
  reload?". Soft delete with an **Undo** toast. Every change is recorded in the activity log with a
  diff.
- Expense detail: who paid, who owes what, receipt image, comment thread, edit history.
- Search (description/notes) and filters (member, category, date range, has-receipt). Duplicate an
  expense.

### 4. AI receipt scanning
- Snap or upload a photo (also via the **PWA share target**, which is a later phase) → client resizes
  to ~1600px JPEG → signed upload to GCS → server calls Claude with the image → structured JSON:
  merchant, date, currency, line items (name, qty, amount), subtotal, tax, service charge, tip, total.
- Prefills the expense form. The **itemized split UI** lets you tap people under each line item;
  tax/tip/service are prorated by each person's item subtotal. Mismatches (items ≠ total) are flagged
  and you can still edit everything.
- Limits: 30 scans per user per day **and** a global daily cap (env `AI_DAILY_CAP`, default 300),
  so free sign-ups can't run up the Anthropic bill. Demo users can't scan. Failures fall back to
  manual entry gracefully. The receipt image stays attached to the expense.

### 5. Multi-currency
- Each expense has its own currency. The FX rate is captured at creation from the daily cached rate
  for that date or the nearest earlier one. If nothing older is cached (an expense dated before
  caching started), it uses the oldest cached rate, marks it "approximate — tap to edit", and lets
  you override it manually. The footer credits the rate provider, as its terms require. Each payer/share row stores
  both the original amount and the base-currency amount (largest-remainder converted so rows sum to
  the expense's base amount).
- Balances are always in the group's base currency. Expenses show "€40 (₹3,712)". Settlements can be
  recorded in any currency as well.
- Formatting via `Intl.NumberFormat` (INR shows lakh grouping: ₹1,23,456).

### 6. Balances & debt simplification
- Group view: each member's net balance (colour-coded) and a "you owe / you're owed" headline.
- Dashboard: total owed / owing across all groups, one line per currency (e.g. "₹4,200 + €35"),
  then "≈ ₹7,450" converted to your default currency at today's rate, then per-group and per-friend
  breakdowns. A friend's balance is the sum of your pairwise balances with them in each group, shown
  with a per-group breakdown and a "Settle" button for each group.
- **Simplify debts:** greedy min-cash-flow (match largest debtor to largest creditor), giving ≤ n−1
  transfers. When the toggle is off, show pairwise debts instead. Balances are computed on read with
  SQL aggregates (no denormalised balance table, so there's no cache drift).

### 7. Settle up
- "Settle up" shows the suggested transfers involving you. Each one offers:
  - **Pay via UPI:** a deep link
    `upi://pay?pa=<payee UPI>&pn=<name>&am=<rupees, 2 decimals>&cu=INR&tn=Hisaab: <group>` that opens
    GPay/PhonePe/Paytm, **plus** a QR code and a one-tap "copy UPI ID". Some apps refuse links to
    personal UPI IDs with the amount prefilled, so the copy/QR fallback is always visible. After
    paying, a "Did it go through? → Mark as paid" prompt records the settlement.
  - Record as cash / bank transfer / other.
- Partial payments are allowed. **A recorded settlement counts toward balances immediately** (as in
  Splitwise). The payee gets a notification with a one-tap **"I didn't receive this"**, which marks
  it DISPUTED, removes it from balances, and notifies the payer. Either side can resolve it by
  re-recording.
- Permissions: anyone can record a payment *from themselves*, or one between two placeholders. The
  payee (or an admin, when the payee is a placeholder) can dispute. The creator or an admin can
  edit/delete.
- UPI is offered only when the payee has a UPI ID and the currency is INR. Otherwise it falls back to
  the "record" options.
- "All settled up 🎉" confetti moment when a group hits zero.

### 8. Recurring expenses
- Any expense can be made recurring: daily / weekly / monthly (with day-of-month handling for the
  29th–31st) / yearly, with an optional end date. It's stored as a template plus `nextRunAt`.
- Cloud Scheduler hits `/api/cron/recurring` hourly, which creates the due expenses idempotently
  (unique on `recurringId + occurrenceDate`) and notifies the group.
- Manage from group settings: pause, edit template, delete.

### 9. Reminders & nudges
- A "Nudge" button on any debt sends a friendly push + email ("Amit reminded you about ₹850 in Goa
  Trip"). Limited to one nudge per pair per 24h.
- Optional weekly digest email (Sunday morning, in the user's timezone): what you owe, what you're
  owed, and the week's activity. Cron at `/api/cron/digest`.
- **Email abuse limits** (Gmail suspends accounts that spam): per user, at most 20 invite emails and
  5 magic links per hour. A global hourly cap keeps total sends under the 500/day Gmail limit.
  Demo users can't send email.

### 10. Real-time & notifications
- On every mutation the server sends `NOTIFY group_events '{groupId, kind, entityId}'`. Each Cloud Run
  instance keeps one `LISTEN` connection and fans events out to the SSE clients subscribed to that
  group. The client invalidates the matching TanStack Query keys, so the UI updates live with a subtle
  highlight animation. The SSE stream closes when the tab is hidden (this saves Cloud Run cost) and
  reconnects on focus with a refetch.
- **Notification centre** (bell icon, unread count). **Web push** (iOS works for the installed PWA,
  16.4+) and email, with each one honouring the user's preferences. Events: added to group, new
  expense involving you, expense edited/deleted, settlement recorded/disputed, nudge, comment
  mention, recurring expense created.

### 11. Activity & comments
- A per-group activity feed and a global feed ("Priya added 'Dinner at Thalassa' — you owe ₹740").
- Comments on expenses and settlements, with @mentions that trigger notifications.

### 12. UX polish (applies everywhere)
- Mobile-first layout with bottom nav (Home · Groups · Friends · Activity · Account) and a floating
  "+" button. Desktop gets a sidebar plus a ⌘K command palette ("add expense in Goa Trip…").
- Optimistic UI on every mutation, skeleton loaders, illustrated empty states, haptics
  (`navigator.vibrate`) on save, spring animations, pull-to-refresh, swipe actions on list rows
  (edit/delete).
- Dark mode, WCAG AA contrast, full keyboard navigation, `prefers-reduced-motion` respected.
- PWA: manifest, icons, splash, install prompt after the second visit, app shortcuts ("Add expense",
  "Scan receipt"), offline read-only access to the last-viewed data.
- Public landing page (portfolio-ready) with a product tour, plus `/demo` sign-in that seeds a sample
  group.

### Later phases (post-v1)
- Analytics: spending by category/member/month, a trip "Wrapped" shareable image card.
- Export: CSV + PDF statement per group. Import from a Splitwise CSV.
- PWA share target (share a receipt photo from the gallery straight into Hisaab) and an offline
  add-expense queue with background sync.
- Hindi localisation (i18n-ready from day 1 via `next-intl` message files).
- Budgets per group/category with alerts. Expense templates. Group cover photos.

---

## Data Model (Prisma, key tables)

All money is **`BigInt` minor units** + ISO currency code. FX rates are `Decimal(18,8)`. Expenses
and settlements soft delete via `deletedAt`.

- **Better Auth tables:** `User` (+ `defaultCurrency`, `upiId`, `timezone`, `notificationPrefs Json`,
  `onboardedAt`), `Session`, `Account`, `Verification`.
- `Group` — id, name, emoji, color, type (TRIP|HOME|COUPLE|EVENT|OTHER|DIRECT), baseCurrency,
  simplifyDebts, inviteCode (unique), archivedAt, createdById.
- `GroupMember` — id, groupId, userId? (null = placeholder), displayName, email?, role, claimToken?,
  joinedAt, leftAt. Unique (groupId, userId).
- `Expense` — id, groupId, description, category, notes, date, currency, amount, fxRate, baseAmount,
  splitMethod, splitInput Json (raw shares/percents for re-editing), receiptId?, recurringId?,
  occurrenceDate?, createdById, version, deletedAt. Unique (recurringId, occurrenceDate).
- `ExpensePayer` — expenseId, memberId, amount, baseAmount.
- `ExpenseShare` — expenseId, memberId, amount, baseAmount.
- `ExpenseItem` — expenseId, name, quantity, amount; `ExpenseItemAssignee` — itemId, memberId.
- `Settlement` — id, groupId, fromMemberId, toMemberId, amount, currency, fxRate, baseAmount,
  method (UPI|CASH|BANK|OTHER), status (RECORDED|DISPUTED), note, date, createdById,
  disputedAt?, deletedAt. Only RECORDED settlements count toward balances.
- `Receipt` — id, uploaderId, gcsPath, status (UPLOADED|PARSED|FAILED), parsed Json, createdAt.
- `RecurringExpense` — id, groupId, template Json, frequency, interval, anchorDay, nextRunAt,
  endsAt?, pausedAt?, createdById.
- `Comment` — id, expenseId? | settlementId?, authorUserId, body, createdAt, deletedAt.
- `Activity` — id, groupId, actorUserId, kind, entityId, payload Json (incl. diffs), createdAt.
- `Notification` — id, userId, kind, payload Json, readAt, createdAt.
- `PushSubscription` — id, userId, endpoint (unique), p256dh, auth, createdAt.
- `Nudge` — fromMemberId, toMemberId, createdAt (for the 24h limit).
- `FxRate` — date, base, rates Json. PK (date, base).

**Authorisation rule:** every server action and route goes through `src/server/authz.ts`:
- `requireMember(groupId, { write })` resolves the session user to an *active* `GroupMember` row
  (`leftAt` is null) or throws a 403. `write: true` also rejects archived groups.
- `requireMemberFor(entity, id, { write })` looks up the groupId from the expense, settlement,
  comment or recurring row, then calls `requireMember`.
- Receipts that aren't attached to an expense yet are uploader-only.
- No query touches group data without going through one of these.

---

## Repo Layout

```
hisaab/
├─ prisma/schema.prisma, migrations/, seed.ts         # seed = demo group
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/page.tsx                          # landing
│  │  ├─ (auth)/sign-in, onboarding
│  │  ├─ (app)/dashboard, groups/[groupId]/{page,expenses/[id],settle,settings},
│  │  │        friends, activity, notifications, account
│  │  ├─ join/[inviteCode], claim/[token]
│  │  ├─ api/auth/[...all]/route.ts                    # Better Auth
│  │  ├─ api/groups/[groupId]/events/route.ts          # SSE
│  │  ├─ api/receipts/{upload-url,parse}/route.ts
│  │  ├─ api/cron/[job]/route.ts                       # recurring | digest | fx
│  │  └─ manifest.ts, sw.ts (Serwist)
│  ├─ lib/money/{split,simplify,fx,format}.ts (+ *.test.ts)   # pure, framework-free core
│  ├─ lib/{auth,db,realtime,push,email,storage,ai,upi}.ts
│  ├─ server/{authz.ts, actions/{groups,expenses,settlements,comments,recurring,profile}.ts}
│  ├─ components/{ui (shadcn), expense-form, keypad, split-editor, balance-list, ...}
│  └─ emails/ (React Email templates)
├─ e2e/*.spec.ts                                       # Playwright
├─ infra/setup.sh                                      # idempotent gcloud provisioning
├─ Dockerfile                                          # Next standalone output, node:22-slim
└─ .github/workflows/{ci.yml, deploy.yml}
```

---

## GCP Architecture

- **Project** `hisaab-<suffix>`, region `asia-south1`.
- **Cloud Run service** `hisaab-web`: min 0 / max 3 instances, 1 vCPU / 512Mi. Concurrency is 500,
  because SSE streams are mostly idle and each one holds a request slot. Request timeout is 3600s
  (for SSE). Cloud SQL is attached through the built-in connector (unix socket).
- **Cloud Run job** `hisaab-migrate`: runs `prisma migrate deploy` with the same image, executed by
  CI before each deploy.
- **Cloud SQL** Postgres 16, **`--edition=ENTERPRISE`** (the Enterprise Plus default doesn't offer
  `db-f1-micro`), `db-f1-micro`, 10GB SSD, automated daily backups + PITR.
- **Connection budget:** `db-f1-micro` allows about 25 connections. The Prisma pool is capped at
  `connection_limit=5` per instance, so 3 instances × (5 + 1 LISTEN) + migrate job ≈ 20.
- **GCS** bucket `hisaab-receipts-<suffix>`: private, uniform access, CORS for signed PUT, lifecycle
  rule that deletes unattached uploads after 1 day. Signing works keylessly through the IAM
  signBlob API.
- **Secret Manager:** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `SMTP_URL`, `ANTHROPIC_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `CRON_SECRET`. These are mounted as env vars on the service and the job.
- **Cloud Scheduler:** `recurring` (hourly), `fx` (daily 00:30 UTC), `digest` (hourly; sends to
  users whose local time is Sun 09:00). Each one POSTs with an `X-Cron-Secret` header, and the
  secret is compared in constant time.
- **Artifact Registry** Docker repo `hisaab`.
- **Service accounts:**
  - `hisaab-run` (runtime): Cloud SQL client, secret accessor, storage object admin on the bucket,
    and **`iam.serviceAccountTokenCreator` on itself** (needed to sign GCS URLs without a key file).
  - `hisaab-deployer` (CI): run admin, artifact writer, act-as runtime SA. It's bound to GitHub
    through **Workload Identity Federation**, restricted to the repo `sumittripathi07/hisaab`.
- `infra/setup.sh` creates all of the above idempotently. Nothing is hand-clicked except billing and
  the OAuth client.

### CI/CD
- `ci.yml` (PRs + main): pnpm install → lint → typecheck → Vitest → `next build` → Playwright against
  a Postgres service container.
- `deploy.yml` (push to main, after CI): WIF auth → docker build/push (tag = git SHA) → execute the
  `hisaab-migrate` job with the new image → `gcloud run deploy` → smoke-check `/api/health`.

---

## Build Phases (each phase ends deployed and working)

**Phase 0 — Foundations.** Scaffold Next.js + Tailwind + shadcn + Prisma, health route, Dockerfile,
CI. Create the GitHub repo `sumittripathi07/hisaab`, run `infra/setup.sh`, and get a first deploy
of a "hello" page live on Cloud Run. *Done when the run.app URL serves the page from CI.*

**Phase 1 — Auth, profiles, groups.** Better Auth (Google + magic link), onboarding, profile/UPI,
group CRUD, invites (link/QR/email), join + placeholder claim, roles, `requireMember`, app shell
(bottom nav, sidebar, theme). *Done when two real accounts can sign in and end up in the same
group.*

**Phase 2 — Money core (the heart).** `lib/money` (split, simplify, format) with exhaustive Vitest
tests, the expense add/edit/delete flow with keypad, all split methods, multiple payers,
adjustments, balances, the simplified-debts view, settle-up with UPI deep link/QR/copy-ID, dispute
flow, activity log, undo, comments. *Done when a 5-person trip with mixed splits settles to exactly
zero.*

**Phase 3 — Real-time & notifications.** LISTEN/NOTIFY + SSE, live UI updates, notification
centre, web push + service worker + PWA install, email notifications, preferences, nudges.
*Done when an expense added on phone A appears on phone B within ~1s and a push arrives.*

**Phase 4 — Multi-currency & AI receipts.** FX cache + cron, per-expense currency/override, dual
amounts, GCS signed uploads, Claude parsing, itemized split UI with tax/tip proration.
*Done when a photographed restaurant bill becomes a correct itemized split.*

**Phase 5 — Recurring & reminders.** Recurring templates + cron + idempotency, weekly digest,
Cloud Scheduler jobs. *Done when a monthly rent expense appears on schedule.*

**Phase 6 — v1 polish & hardening.** Landing page + demo mode, command palette, swipe actions,
animations/confetti, empty states, a11y pass, CSP + security headers, rate limits review, Playwright
suite for critical journeys, `/security-review`, README with screenshots + architecture diagram.
**→ v1 release.**

**Phase 7+ — Later phases** (analytics, export/import, share target, offline queue, Hindi, budgets,
cross-group "settle with friend", merging placeholder members, custom domain + Resend).

**Execution note:** once approved, Phase 0 starts by creating the repo in a project folder (not this
temporary session folder). I'll ask where to put it, e.g. `~/Documents/Code/Projs/hisaab`. Each
phase is turned into a detailed task list (superpowers:writing-plans) before coding starts, and
built test-first for the money core.

---

## Verification

- **Money correctness (Vitest):** splits always sum to the total for every method and for random
  amounts/member counts (loop over a few thousand random cases); simplify produces ≤ n−1 transfers and
  preserves every net balance; FX conversion rows sum to the base amount; rounding is deterministic.
- **Authz:** tests that a non-member gets 403 from every action/route (one table-driven test).
- **E2E (Playwright, in CI against Postgres):** sign in via a test-only magic-link capture → create a
  group → invite + join with a second browser context → add equal/itemized/foreign-currency expenses
  → check balances → settle up → balances show zero → payee disputes → balance reappears. Plus: a
  real-time update visible in the second context.
- **Deployed smoke test:** `/api/health` checks the DB. Manually on a real phone: install the PWA,
  sign in with Google, scan a real receipt, tap Pay via UPI (verify GPay opens with the amount
  prefilled — don't complete the payment), receive a push.
- **Cron:** trigger each Scheduler job manually (`gcloud scheduler jobs run`) and verify the effects
  plus idempotency (running it twice creates nothing new).
