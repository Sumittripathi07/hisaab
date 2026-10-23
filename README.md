# Hisaab

Split expenses with friends, flatmates and trip groups, then settle up without the awkward chasing.
India-first (INR, UPI) but multi-currency by design. Built mobile-first as a web app (installable PWA planned),
running on Google Cloud Run with scale-to-zero.

Full design: [`docs/superpowers/specs/2026-10-22-hisaab-design.md`](docs/superpowers/specs/2026-10-22-hisaab-design.md).

## What works today (Phase 2)

- **Sign in** with Google or an email magic link. No passwords. The same email via either route is one account.
- **Onboarding** on first sign-in: name, default currency, optional UPI ID.
- **Profile and settings**: name, currency, UPI ID, light/dark/system theme. A name change shows in every group.
  The timezone is detected at onboarding and isn't editable yet.
- **Groups**: create with an emoji and colour, a type (Trip, Home, Couple, Event, Other) and a base currency. Archive
  and unarchive. Archived groups are read-only.
- **Invites**: a shareable link with a QR code, the native share sheet (WhatsApp and friends), and a rotatable invite
  code. Joining is one tap and safe to repeat.
- **Placeholder members**: add "Rahul" before he has an account. He claims his spot from a single-use link, or you
  regenerate it.
- **Roles**: owner, admin, member. Admins remove members, the owner transfers ownership, and a group can never end up
  ownerless.
- **App shell**: bottom nav on phones, sidebar on desktop, dashboard with your groups and what you owe and are owed.
- **Expenses and splits**: add one on a keypad in two taps, then split it equally, by exact amounts, percentages,
  shares or itemised (tax and tip are shared in proportion to each person's items), with +/− adjustments and one or
  several payers. Search and filter, edit (a stale edit says "reload?" rather than overwriting), duplicate, and delete
  with undo. Money is exact minor units end to end: no floats, and an odd paisa always lands on the same person.
- **Balances and simplification**: who is owed and who owes, per group, with debts simplified to the fewest payments
  (switch it off to see pairwise debts). Leaving a group with a balance asks you to settle first.
- **UPI settle-up and disputes**: "Pay ₹850 via UPI" opens GPay or PhonePe with the amount and note filled in, with a
  QR code for another phone. "Mark as paid" records it (or record cash and bank transfers by hand); the payee can say
  they never received it, and the balance comes back.
- **Activity and comments**: a feed per group and a personal one that says what you owe or get back, and comments on
  expenses and payments.

See the [roadmap](#roadmap) for what's next.

## Tech stack

Next.js 16 (App Router, React 19, Server Actions) · TypeScript · Tailwind v4 + shadcn/ui · Better Auth (Google + magic
link) · PostgreSQL 16 with Prisma 7 · Nodemailer (Gmail SMTP in production) · Zod · Vitest + Playwright ·
GitHub Actions → Cloud Run + Cloud SQL, with Workload Identity Federation (no JSON keys).

## Local setup

Needs Node 24, pnpm 10 and Docker.

```bash
docker compose up -d          # Postgres 16 on :5432 (creates the hisaab and hisaab_test databases)
cp .env.example .env
pnpm i
pnpm prisma migrate deploy
pnpm dev --port 3005
```

Edit `.env` before the first run. `env.ts` refuses to start without these:

| Variable | Local value |
|---|---|
| `BETTER_AUTH_SECRET` | any 32+ character string, e.g. `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:3005` (match the port you run on) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | a real OAuth client to try Google sign-in, or any placeholder text if you only use magic links |
| `SMTP_URL` | leave as `file://./.dev-outbox` |

**Magic links locally.** With `SMTP_URL=file://./.dev-outbox` nothing is sent. Each email is written as a JSON file
in `.dev-outbox/`. Request a link on `/sign-in`, then open the newest file and copy the URL from its `text` field:

```bash
cat "$(ls -t .dev-outbox/*.json | head -1)"
```

Create a schema change with `pnpm db:migrate` (`prisma migrate dev`).

## Tests

```bash
pnpm test        # Vitest against the hisaab_test database (docker compose up -d first)
pnpm test:e2e    # Playwright: production build served on :3100, real browser, file outbox
pnpm lint && pnpm typecheck
```

CI runs the same commands on every PR (`check` job).

## Deploy

Merging to `main` runs `.github/workflows/ci.yml`:

1. `check`: lint, typecheck, unit tests, build, e2e.
2. `deploy` (main only): authenticates to Google Cloud through **Workload Identity Federation** (GitHub's OIDC token
   for this repo only, so no service-account keys exist), builds the `web` and `migrate` images and pushes them to
   **Artifact Registry**.
3. Runs the `hisaab-migrate` Cloud Run **job** (`prisma migrate deploy`), which must succeed before the new code ships.
4. Deploys `hisaab-web` to **Cloud Run** (scale to zero, Cloud SQL attached over the socket) and smoke-checks
   `/api/health`, `/api/auth/ok` and `/sign-in`.

Runtime secrets are mounted from Secret Manager; `BETTER_AUTH_URL` comes from the `APP_URL` repository variable.

### Infra script

`infra/setup.sh` provisions everything idempotently: APIs, Artifact Registry, Cloud SQL, the two service accounts,
per-secret IAM, the WIF pool and provider, and the GitHub repository variables. Every step checks first and skips what
exists, so it is safe to re-run.

```bash
bash infra/setup.sh   # needs gcloud, gh, jq, openssl; project and region come from infra/config.env
```

It runs a preflight first and stops if the project or billing is missing, or if any owner-managed secret below has no
version. Resources are prefixed `hisaab-` because the GCP project is shared with other personal apps.

### Secrets

Names only. Values never go in git, chat or CI logs.

| Secret | Created by |
|---|---|
| `HISAAB_DATABASE_URL` | `infra/setup.sh` (generated, written together with the SQL user's password) |
| `HISAAB_BETTER_AUTH_SECRET` | `infra/setup.sh` (generated) |
| `HISAAB_GOOGLE_CLIENT_ID` | the owner, from the Google OAuth client |
| `HISAAB_GOOGLE_CLIENT_SECRET` | the owner, from the Google OAuth client |
| `HISAAB_SMTP_URL` | the owner: `smtps://<user>%40gmail.com:<app password>@smtp.gmail.com:465` |

Add an owner secret by reading the value silently so it never lands in shell history or the screen:

```bash
read -rs v && printf '%s' "$v" | gcloud secrets create HISAAB_SMTP_URL --data-file=- --project <PROJECT_ID>; unset v
# to rotate an existing secret, use `gcloud secrets versions add HISAAB_SMTP_URL --data-file=-` instead of `create`
```

Then re-run `infra/setup.sh` so `hisaab-run` is granted access to it. Grants are per secret, never project-wide.

## Roadmap

Each phase ends deployed and working. Details in the [design spec](docs/superpowers/specs/2026-10-22-hisaab-design.md#build-phases-each-phase-ends-deployed-and-working).

| Phase | Scope |
|---|---|
| 0, 1, 2 | Done: foundations and deploy; auth, profiles, groups, invites; **money core** (expenses with all split methods and multiple payers, balances, simplified debts, settle-up with UPI deep link/QR, disputes, activity log, undo, comments) |
| 3 | **Real-time and notifications**: live updates over SSE, notification centre, web push, PWA install, email notifications |
| 4 | **Multi-currency and AI receipts**: live FX rates, per-expense currency, receipt photos parsed into itemised splits |
| 5 | **Recurring and reminders**: recurring expenses on a schedule, weekly digest, Cloud Scheduler jobs |
| 6 | **v1 polish and hardening**: landing page and demo mode, command palette, animations, accessibility, security headers, full e2e suite |

Later: analytics, export/import, offline queue, Hindi, budgets, cross-group "settle with a friend".
