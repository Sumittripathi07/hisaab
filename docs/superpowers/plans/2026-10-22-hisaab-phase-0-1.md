# Hisaab Phase 0–1 (Foundations + Auth, Profiles, Groups) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed Next.js app on GCP Cloud Run where two real people can sign in (Google or
magic link), finish onboarding, and end up in the same group via invite link, email invite, or a
placeholder claim.

**Architecture:** One Next.js 16 app (App Router) backed by Postgres through Prisma 7. Business logic
lives in plain `src/server/*.ts` service functions that take `userId` explicitly; they are tested
against a real Postgres. Thin `"use server"` actions resolve the session user and wrap the services
via `defineAction`. Infra comes from one idempotent `infra/setup.sh`, and one GitHub Actions workflow
tests, builds, migrates and deploys.

**Tech Stack:** Next.js 16.4 · React 19 · TypeScript strict · Tailwind 4.3 + shadcn/ui · Better Auth
1.7 · Prisma 7.10 + `@prisma/adapter-pg` · PostgreSQL 16 · Zod 4 · Nodemailer · `qrcode` · Vitest ·
Playwright · Docker · GitHub Actions · Cloud Run · Cloud SQL · Artifact Registry · Secret Manager.

**Spec:** `docs/superpowers/specs/2026-10-22-hisaab-design.md` (§1 Auth & onboarding, §2 Groups &
people, Data Model, Authorisation rule, GCP Architecture, Build Phases 0–1).

## Global Constraints

- Project root `/Users/sumit/Documents/Code/Projs/hisaab`. Package manager pnpm 10. Node 24 LTS
  (`node:24-slim` in Docker; `"engines": { "node": ">=24" }`).
- Pin these exact majors: `next@16.4`, `better-auth@1.7`, `prisma@7.10` and `@prisma/client@7.10` (do
  **not** use the 8.0 RC), `tailwindcss@4`, `zod@4`, `vitest@5`, `@playwright/test@1.64`.
- GCP region `asia-south1`. Project ID `hisaab-<6 hex chars>`, recorded in `infra/config.env`.
- GitHub repo `sumittripathi07/hisaab`, public. Never commit secrets: only `.env.example` and the
  non-secret `infra/config.env` are committed. `.env*` (except `.env.example`) is gitignored.
- Prisma client generates to `src/generated/prisma` (gitignored) and is imported from
  `@/generated/prisma/client`. The pg pool size is `max: 5` per instance (the spec's connection budget).
- No module may throw at import time just because runtime secrets are missing during `next build`.
  Docker's builder stage and CI's build step supply **dummy** values for every required env var. The
  runtime image never contains them.
- Every server action goes through `defineAction` (Task 7). Every group-scoped service goes through
  `requireMember` (Task 9). No exceptions.
- IDs: Better Auth tables use Better Auth's string IDs. Our tables use `@default(cuid())`.
- Emails are compared case-insensitively and stored lowercased.
- Phase 0 commits go straight to `main` (a new repo). Phase 1 is built on branch `feat/phase-1` and
  merged through a PR in Task 14, so production never runs auth code before its secrets exist.

**Deliberate deviations from the spec (recorded so reviewers don't flag them):**
- Node 24 instead of 22 (24 is the current LTS).
- Prisma pool `max: 5` instead of the `connection_limit=5` URL param (Prisma 7 uses driver adapters).
- Next 16's `proxy.ts` replaces `middleware.ts`.
- One `ci.yml` with `check` and `deploy` jobs instead of two workflow files.
- Plain HTML email templates instead of React Email (there are only two emails so far).
- TanStack Query is deferred to Phase 3 (real-time), since RSC plus server actions are enough here.
- Avatar upload is deferred to Phase 4 (GCS). Phase 1 shows the Google photo or initials.
- Account deletion and data export are deferred to the Phase 6 plan.
- Phase 2 will add the zero-balance checks to leave/remove member, and will block base-currency
  changes once a group has expenses.

## Review Focus

1. **A signed-out person opens an invite link.** They should go to sign-in → onboarding (if new) →
   back to the same join page, and can join with one tap. → e2e in Task 13.
2. **Someone taps the invite link twice, or joins a group they're already in.** This should be
   idempotent, with no duplicate member row, and land them on the group. → test in Task 11.
3. **Someone opens a magic link that's expired or already used.** They should see a friendly "send a
   new link" message on the sign-in page, never a raw error. → test in Task 6, e2e in Task 13.
4. **The owner tries to leave, or an admin tries to remove the owner.** This is refused with a clear
   message, ownership transfer works, and a group never ends up ownerless. → tests in Task 11.
5. **Someone tries to join, claim, or edit inside an archived group.** This is refused with "This group
   is archived.", while reads still work. → tests in Tasks 9 and 11.

---

## File Map

```
hisaab/
├─ .github/workflows/ci.yml            # check job (lint/typecheck/vitest/build/e2e) + deploy job
├─ Dockerfile, .dockerignore           # targets: web (standalone) and migrate
├─ docker-compose.yml                  # local Postgres 16 (+ hisaab_test DB)
├─ infra/setup.sh, infra/config.env    # idempotent GCP provisioning; non-secret IDs
├─ prisma/schema.prisma, prisma/migrations/, prisma.config.ts
├─ playwright.config.ts, e2e/{helpers.ts, onboarding.spec.ts, groups.spec.ts}
├─ vitest.config.ts, test/{setup.ts, global-setup.ts, db.ts, factories.ts, outbox.ts}
└─ src/
   ├─ proxy.ts                         # signed-out redirect with callbackURL
   ├─ app/
   │  ├─ layout.tsx, providers.tsx, globals.css, page.tsx (placeholder landing)
   │  ├─ api/health/route.ts, api/auth/[...all]/route.ts
   │  ├─ (auth)/sign-in/page.tsx, (auth)/onboarding/page.tsx
   │  ├─ (app)/layout.tsx, dashboard/page.tsx, groups/page.tsx,
   │  │        groups/[groupId]/page.tsx, groups/[groupId]/settings/page.tsx, account/page.tsx
   │  ├─ join/[inviteCode]/page.tsx, claim/[token]/page.tsx
   ├─ lib/{env.ts, db.ts, email.ts, auth.ts, auth-client.ts, safe-redirect.ts, validation.ts, tokens.ts}
   ├─ emails/{magic-link.ts, invite.ts}
   ├─ server/{errors.ts, action.ts, session.ts, authz.ts, profile.ts, groups.ts, members.ts}
   ├─ server/actions/{profile.ts, groups.ts, members.ts}
   └─ components/{ui/* (shadcn), app-shell/*, user-avatar.tsx, group-form.tsx, invite-sheet.tsx, ...}
```

---

# Phase 0 — Foundations (on `main`)

### Task 1: Scaffold, env validation, Vitest

**Files:**
- Create (via generator): Next.js app at project root.
- Create: `src/lib/env.ts`, `vitest.config.ts`, `test/setup.ts`, `test/env.test.ts`, `.env.example`.
- Modify: `package.json` (scripts, engines), `next.config.ts` (`output: "standalone"`), `.gitignore`.

**Interfaces:**
- Produces: `parseEnv(source: Record<string, string | undefined>): Env` and `env: Env` (parsed eagerly
  from `process.env`). In this task, `Env` = `{ DATABASE_URL: string; NODE_ENV: "development" | "test" | "production" }`.
  Later tasks extend this schema.
- Produces scripts: `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`).

- [ ] **Step 1: Init git and scaffold**

Run in the project root (only `docs/` exists, which create-next-app allows):
`git init -b main && pnpm create next-app@16.4 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes`
Then `pnpm dlx shadcn@latest init` (base colour: neutral, CSS variables: yes). Add `vitest@5` and
`zod@4`.
Expected: `pnpm dev` serves the default page at http://localhost:3000.

- [ ] **Step 2: Write the failing test** `test/env.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("names the missing variable", () => {
    expect(() => parseEnv({ NODE_ENV: "test" })).toThrow(/DATABASE_URL/);
  });
  it("accepts a postgres URL", () => {
    const e = parseEnv({ NODE_ENV: "test", DATABASE_URL: "postgresql://u:p@localhost:5432/db" });
    expect(e.DATABASE_URL).toBe("postgresql://u:p@localhost:5432/db");
  });
});
```

`vitest.config.ts`: environment `node`, alias `@` → `./src`, `setupFiles: ["test/setup.ts"]`,
`fileParallelism: false`, and include `test/**/*.test.ts` plus `src/**/*.test.ts`. `test/setup.ts`
sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://hisaab:hisaab@localhost:5432/hisaab_test"`.

- [ ] **Step 3: Run it** — `pnpm test`. Expected: FAIL (`@/lib/env` not found).

- [ ] **Step 4: Implement `parseEnv` in `src/lib/env.ts`**

Use a Zod object schema. On failure, throw an `Error` whose message lists every invalid key. Export
`env = parseEnv(process.env)`.

- [ ] **Step 5: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm build`. Expected: all pass.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "chore: scaffold Next.js app with env validation and vitest"`

---

### Task 2: Local Postgres, Prisma, health route

**Files:**
- Create: `docker-compose.yml`, `prisma/schema.prisma`, `prisma.config.ts`, `src/lib/db.ts`,
  `src/app/api/health/route.ts`, `test/global-setup.ts`, `test/db.ts`, `test/health.test.ts`.
- Modify: `vitest.config.ts` (`globalSetup`), `package.json` (`postinstall: prisma generate`,
  `db:migrate: prisma migrate dev`), `.env.example`.

**Interfaces:**
- Produces: `db: PrismaClient` from `@/lib/db`. It's a global singleton in dev, built as
  `new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 5 }) })`.
- Produces: `resetDb(): Promise<void>` in `test/db.ts`, which truncates every table in the `public`
  schema except `_prisma_migrations` with `RESTART IDENTITY CASCADE`.
- Produces: `GET /api/health` → `200 {"status":"ok"}` or `503 {"status":"error"}`.

- [ ] **Step 1: Local DB**

`docker-compose.yml`: service `db`, image `postgres:16-alpine`, port `5432:5432`, user/password/db
`hisaab`, plus an init SQL that runs `CREATE DATABASE hisaab_test;`. Add to `.env.example`:
`DATABASE_URL=postgresql://hisaab:hisaab@localhost:5432/hisaab` and
`TEST_DATABASE_URL=postgresql://hisaab:hisaab@localhost:5432/hisaab_test`.
Run: `docker compose up -d`. Expected: `docker compose ps` shows `db` healthy.

- [ ] **Step 2: Prisma 7 setup**

- Add `prisma@7.10`, `@prisma/client@7.10`, `@prisma/adapter-pg@7.10`.
- `schema.prisma`: `generator client { provider = "prisma-client"; output = "../src/generated/prisma" }`
  and a `postgresql` datasource with no `url`. There are no models yet.
- `prisma.config.ts` reads `DATABASE_URL` and points at `prisma/migrations`.
- `test/global-setup.ts` runs `prisma migrate deploy` against `TEST_DATABASE_URL`.

- [ ] **Step 3: Write the failing test** `test/health.test.ts`

```ts
import { it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

it("reports ok when the database answers", async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});
```

- [ ] **Step 4: Run** `pnpm test`. Expected: FAIL (route module missing).

- [ ] **Step 5: Implement `db` and `GET`**

The route runs ``db.$queryRaw`SELECT 1` `` and sets `export const dynamic = "force-dynamic"`. On
failure it returns 503 and logs the error.

- [ ] **Step 6: Run** `pnpm test`. Expected: PASS. Then `docker compose stop db && pnpm test`.
  Expected: FAIL. Restart the DB afterwards.

- [ ] **Step 7: Commit** — `git commit -am "feat: prisma + postgres with health route"` (include new files).

---

### Task 3: Dockerfile and CI check job

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`.

**Interfaces:**
- Produces Docker targets `web` (CMD `node server.js`, port 8080, user `node`) and `migrate`
  (CMD `pnpm prisma migrate deploy`).
- Produces CI job `check`, which later tasks extend with e2e.

- [ ] **Step 1: Dockerfile** (multi-stage, `node:24-slim`, corepack pnpm)

- `deps`: copy `package.json`, `pnpm-lock.yaml`, `prisma/`, `prisma.config.ts`, then
  `pnpm install --frozen-lockfile`. This stage sets
  `ENV DATABASE_URL=postgresql://build:build@localhost:5432/build` (dummy, so `prisma generate` and
  config loading work).
- `builder` (FROM deps): copy the source and run `pnpm build`. Later tasks add more dummy envs here.
- `web` (FROM `node:24-slim`, fresh): `NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0`. Copy
  `.next/standalone`, `.next/static`, `public`. `USER node`.
- `migrate` (FROM deps): copy `prisma/` and `prisma.config.ts`. `CMD ["pnpm","prisma","migrate","deploy"]`.

`.dockerignore` excludes `node_modules`, `.next`, `.git`, `.env*`, `e2e`, `test`, `docs`.

- [ ] **Step 2: Verify the image locally**

Run: `docker build --target web -t hisaab-web . && docker run --rm -p 8080:8080 -e DATABASE_URL=postgresql://hisaab:hisaab@host.docker.internal:5432/hisaab hisaab-web`
Then `curl -fsS localhost:8080/api/health`. Expected: `{"status":"ok"}`.
Run: `docker build --target migrate -t hisaab-migrate . && docker run --rm -e DATABASE_URL=postgresql://hisaab:hisaab@host.docker.internal:5432/hisaab hisaab-migrate`.
Expected: exits 0 ("No pending migrations" or migrations applied).

- [ ] **Step 3: CI `check` job** in `.github/workflows/ci.yml`

Triggers: `pull_request` and `push` to `main`. Use a `postgres:16` service with user/password
`hisaab` and DB `hisaab_test`, with a health check. Steps:
1. checkout
2. pnpm/action-setup
3. setup-node 24 with pnpm cache
4. `pnpm install --frozen-lockfile`
5. `pnpm lint`
6. `pnpm typecheck`
7. `pnpm test` with `TEST_DATABASE_URL`
8. `pnpm build` with the same dummy env as the Docker builder

Use each action's current major version.

- [ ] **Step 4: Commit** — `git add Dockerfile .dockerignore .github && git commit -m "build: dockerfile with web/migrate targets and CI checks"`

---

### Task 4: GitHub repo, GCP infra, deploy pipeline

**Requires Sumit first (stop and ask if any is missing):**
- (a) `gh auth status` shows the active account is `sumittripathi07`.
- (b) He confirms the billing account to link. Show him `gcloud billing accounts list` and the
  ~$10–15/month estimate.

**Files:**
- Create: `infra/setup.sh`, `infra/config.env`.
- Modify: `.github/workflows/ci.yml` (add the `deploy` job).

**Interfaces:**
- Produces GitHub repo variables, which are non-secret and set by `setup.sh` with `gh variable set`:
  `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`, `GCP_RUNTIME_SA`, `GCP_SQL_INSTANCE`
  (`<project>:asia-south1:hisaab-db`).
- Produces the Secret Manager secrets `DATABASE_URL` and `BETTER_AUTH_SECRET`. Phase 1 adds more in
  Task 14.

- [ ] **Step 1: Write `infra/setup.sh`**

The script is idempotent: every create first checks `describe` and skips if the resource exists. It
runs under `set -euo pipefail`, sources `infra/config.env` (or creates it with
`PROJECT_ID=hisaab-$(openssl rand -hex 3)` and `REGION=asia-south1`), and requires `BILLING_ACCOUNT`
in the environment. Resources and the flags that matter:

- Project create + `gcloud billing projects link`.
- Enable APIs: `run sqladmin artifactregistry secretmanager iam iamcredentials sts cloudresourcemanager`.
- Artifact Registry: docker repo `hisaab` in `$REGION`.
- Cloud SQL: `gcloud sql instances create hisaab-db --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-f1-micro --region=$REGION --storage-type=SSD --storage-size=10 --backup-start-time=20:30 --enable-point-in-time-recovery`.
  Then database `hisaab` and user `hisaab`, with a password from `openssl rand -base64 24 | tr -d '/+='`.
- Secret `DATABASE_URL` = `postgresql://hisaab:<pw>@localhost/hisaab?host=/cloudsql/$PROJECT_ID:$REGION:hisaab-db`.
  Only add a version when the secret has none, so re-runs don't rotate it. Secret
  `BETTER_AUTH_SECRET` = `openssl rand -base64 32`, with the same rule.
- Service account `hisaab-run`: `roles/cloudsql.client`, `roles/secretmanager.secretAccessor`.
- Service account `hisaab-deployer`: `roles/run.admin`, `roles/artifactregistry.writer`, plus
  `roles/iam.serviceAccountUser` on `hisaab-run`.
- Workload Identity pool `github` with OIDC provider `github`: issuer
  `https://token.actions.githubusercontent.com`, mapping
  `google.subject=assertion.sub,attribute.repository=assertion.repository`, condition
  `assertion.repository=='sumittripathi07/hisaab'`. Grant `roles/iam.workloadIdentityUser` on
  `hisaab-deployer` to `principalSet://iam.googleapis.com/projects/<num>/locations/global/workloadIdentityPools/github/attribute.repository/sumittripathi07/hisaab`.
- `gh variable set` for every variable listed under Interfaces.

- [ ] **Step 2: Create the repo and run the setup**

1. `gh repo create sumittripathi07/hisaab --public --source . --remote origin --description "Group expense settlement — split, settle, smile."`
2. `BILLING_ACCOUNT=<confirmed id> bash infra/setup.sh`
3. Run it a **second time**. Expected: completes with every step reporting "exists, skipping".
4. Commit `infra/`.

- [ ] **Step 3: `deploy` job in `ci.yml`**

`needs: check`, `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`,
`permissions: { contents: read, id-token: write }`. Steps:
1. checkout
2. google-github-actions/auth (WIF provider and service account from vars)
3. setup-gcloud
4. `gcloud auth configure-docker $REGION-docker.pkg.dev`
5. Build and push both targets, tagged `$REGION-docker.pkg.dev/$PROJECT/hisaab/{web,migrate}:$GITHUB_SHA`
6. Migrate, then deploy, then smoke-check:

```bash
gcloud run jobs deploy hisaab-migrate --image .../migrate:$SHA --region $REGION \
  --service-account $GCP_RUNTIME_SA --set-cloudsql-instances $GCP_SQL_INSTANCE \
  --set-secrets DATABASE_URL=DATABASE_URL:latest
gcloud run jobs execute hisaab-migrate --region $REGION --wait
gcloud run deploy hisaab-web --image .../web:$SHA --region $REGION \
  --service-account $GCP_RUNTIME_SA --add-cloudsql-instances $GCP_SQL_INSTANCE \
  --set-secrets DATABASE_URL=DATABASE_URL:latest \
  --min-instances 0 --max-instances 3 --concurrency 500 --timeout 3600 \
  --cpu 1 --memory 512Mi --port 8080 --allow-unauthenticated
URL=$(gcloud run services describe hisaab-web --region $REGION --format 'value(status.url)')
curl -fsS "$URL/api/health"
```

- [ ] **Step 4: Push and verify**

`git push -u origin main`, then `gh run watch`. Expected: `check` and `deploy` pass, and the final
curl prints `{"status":"ok"}`. Record the run.app URL as repo variable `APP_URL` (`gh variable set
APP_URL`). Open the URL in the browser pane: the placeholder page renders. **Phase 0 done.**

---

# Phase 1 — Auth, profiles, groups (on `feat/phase-1`)

Start with: `git switch -c feat/phase-1`.

### Task 5: Email delivery with rate limits

**Files:**
- Create: `src/lib/email.ts`, `test/outbox.ts`, `test/email.test.ts`.
- Modify: `prisma/schema.prisma` (+`EmailLog`), `src/lib/env.ts` (+`SMTP_URL`, `EMAIL_FROM`),
  `test/setup.ts` (sets `SMTP_URL=file://./.test-outbox`), `Dockerfile` builder stage and the
  `ci.yml` build step (dummy `SMTP_URL=file:///tmp/outbox`), `.gitignore` (`.test-outbox/`,
  `.e2e-outbox/`), `.env.example`.

**Interfaces:**
- Produces: `type EmailKind = "magic_link" | "invite"`.
- Produces: `sendEmail(input: { to: string; subject: string; html: string; text: string; kind: EmailKind; senderUserId?: string }): Promise<void>`.
- Produces: `class EmailRateLimitError extends Error { name = "EmailRateLimitError"; reason: "recipient" | "sender" | "global" }`.
- Produces: `readOutbox(): Promise<OutboxEmail[]>`, `lastEmailTo(email: string): Promise<OutboxEmail>`,
  and `clearOutbox()` in `test/outbox.ts`. These read the dir from `SMTP_URL` and are reused by e2e.
- Model: `EmailLog { id cuid, kind String, toEmail String, senderUserId String?, createdAt DateTime @default(now()) }`
  with indexes `(kind, toEmail, createdAt)`, `(kind, senderUserId, createdAt)` and `(createdAt)`.
- Env: `SMTP_URL` (string; `file://<dir>` writes JSON files, anything else goes to
  `nodemailer.createTransport`). `EMAIL_FROM` (default `"Hisaab <no-reply@hisaab.local>"`).

- [ ] **Step 1: Write the failing tests** `test/email.test.ts`

```ts
const mail = (kind: EmailKind, to: string, senderUserId?: string) =>
  ({ to, kind, senderUserId, subject: "s", html: "<p>h</p>", text: "h" });

beforeEach(async () => { await resetDb(); await clearOutbox(); });

it("writes to the file outbox and lowercases the recipient", async () => {
  await sendEmail(mail("magic_link", "Asha@Example.TEST"));
  expect((await lastEmailTo("asha@example.test")).subject).toBe("s");
});
it("refuses the 6th magic link to one address within an hour", async () => {
  for (let i = 0; i < 5; i++) await sendEmail(mail("magic_link", "a@x.test"));
  await expect(sendEmail(mail("magic_link", "a@x.test")))
    .rejects.toMatchObject({ name: "EmailRateLimitError", reason: "recipient" });
});
it("ignores sends older than an hour", async () => {
  const old = new Date(Date.now() - 61 * 60_000);
  await db.emailLog.createMany({ data: Array.from({ length: 5 }, () => ({ kind: "magic_link", toEmail: "a@x.test", createdAt: old })) });
  await expect(sendEmail(mail("magic_link", "a@x.test"))).resolves.toBeUndefined();
});
it("refuses the 21st invite from one sender within an hour", async () => {
  for (let i = 0; i < 20; i++) await sendEmail(mail("invite", `p${i}@x.test`, "u1"));
  await expect(sendEmail(mail("invite", "p20@x.test", "u1"))).rejects.toMatchObject({ reason: "sender" });
});
it("stops everything at 450 emails in 24 hours", async () => {
  await db.emailLog.createMany({ data: Array.from({ length: 450 }, (_, i) => ({ kind: "invite", toEmail: `g${i}@x.test` })) });
  await expect(sendEmail(mail("magic_link", "new@x.test"))).rejects.toMatchObject({ reason: "global" });
});
```

- [ ] **Step 2: Run** `pnpm prisma migrate dev --name email_log && pnpm test`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `sendEmail`**

Use constants `MAGIC_LINKS_PER_RECIPIENT_PER_HOUR = 5`, `INVITES_PER_SENDER_PER_HOUR = 20` and
`EMAILS_PER_DAY = 450`. Check the limits in the order global → recipient (magic_link) → sender
(invite), then insert the `EmailLog` row, then send. A failed send still counts, which is the safe
direction. File transport writes `{to, subject, html, text, kind, createdAt}` to
`<dir>/<Date.now()>-<random>.json`.

- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: rate-limited email delivery with file outbox for tests"` (include files).

---

### Task 6: Better Auth (Google + magic link) and sign-in page

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`,
  `src/lib/safe-redirect.ts`, `src/emails/magic-link.ts`, `src/app/(auth)/sign-in/page.tsx`
  (+ client form component), `test/auth.test.ts`, `src/lib/safe-redirect.test.ts`.
- Modify: `prisma/schema.prisma` (Better Auth models), `src/lib/env.ts` (+`BETTER_AUTH_SECRET` min
  32 chars, `BETTER_AUTH_URL` url, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), `Dockerfile` +
  `ci.yml` (dummy build values for the new vars), `.env.example`.

**Interfaces:**
- Consumes: `sendEmail`, `EmailRateLimitError` (Task 5).
- Produces: `auth` (Better Auth instance) and `authClient` (with `magicLinkClient()`).
- Produces: `safeCallback(url: string | null | undefined, fallback = "/dashboard"): string`. It returns
  `url` only when it starts with `/` and not `//` or `/\`.
- Produces: `magicLinkEmail(url: string): { subject: "Your Hisaab sign-in link"; html: string; text: string }`.
- Prisma models from Better Auth's documented schema: `User`, `Session`, `Account`, `Verification`,
  `RateLimit`. `User` adds `defaultCurrency String @default("INR")`, `upiId String?`,
  `timezone String @default("Asia/Kolkata")` and `onboardedAt DateTime?`. All four are declared in
  Better Auth `user.additionalFields` with `input: false`.

Auth config values the spec pins:
- `socialProviders.google` with `prompt: "select_account"`
- `magicLink({ expiresIn: 600, sendMagicLink })`, which sends with `kind: "magic_link"`
- `account.accountLinking: { enabled: true, trustedProviders: ["google"] }`, so the same email via
  magic link and via Google is one user
- `session: { expiresIn: 60*60*24*30, updateAge: 60*60*24 }`
- `rateLimit: { enabled: true, storage: "database" }`
- the `nextCookies()` plugin last

- [ ] **Step 1: Write the failing tests**

`src/lib/safe-redirect.test.ts`:
```ts
it.each([
  ["/join/abc?x=1", "/join/abc?x=1"],
  ["//evil.com", "/dashboard"],
  ["/\\evil.com", "/dashboard"],
  ["https://evil.com", "/dashboard"],
  [undefined, "/dashboard"],
])("safeCallback(%s) -> %s", (input, out) => expect(safeCallback(input)).toBe(out));
```

`test/auth.test.ts`:
```ts
it("emails a magic link that signs a new user in", async () => {
  await auth.api.signInMagicLink({ body: { email: "asha@example.test", callbackURL: "/dashboard" }, headers: new Headers() });
  const m = await lastEmailTo("asha@example.test");
  expect(m.subject).toBe("Your Hisaab sign-in link");
  const link = new URL(m.text.match(/https?:\/\/\S+/)![0]);
  const res = await auth.api.magicLinkVerify({ query: { token: link.searchParams.get("token")! }, headers: new Headers(), asResponse: true });
  expect(res.headers.get("set-cookie")).toMatch(/session_token/);
  expect(await db.user.count({ where: { email: "asha@example.test" } })).toBe(1);
});
it("does not sign in with a used token", async () => {
  // request + verify once as above, then verify the same token again
  // expect: no set-cookie session, redirect Location contains "error="
});
```
(Use the API names from the better-auth 1.7 docs if they differ. The assertions stay the same.)

- [ ] **Step 2: Run** — generate the Better Auth models into `schema.prisma` (Better Auth CLI or
  hand-copy the documented schema), run `pnpm prisma migrate dev --name auth`, then `pnpm test`.
  Expected: FAIL.

- [ ] **Step 3: Implement** `auth.ts`, the route (`toNextJsHandler(auth)`), `auth-client.ts`,
  `safe-redirect.ts` and `magic-link.ts`. The email is a centred card: "Sign in to Hisaab" button,
  link valid for 10 minutes, and "If you didn't ask for this, ignore this email".

- [ ] **Step 4: Sign-in page**

`/sign-in` reads `callbackURL` (through `safeCallback`) and `error` from the search params. Layout:
- Wordmark, plus the tagline "Split expenses. Settle up. Stay friends."
- Big "Continue with Google" button.
- Divider, then an email field with a "Email me a sign-in link" button. On success, swap to a
  "Check your inbox" state showing the address and a "Use a different email" link.
- `error` present → banner "That sign-in link has expired or was already used. Send yourself a new
  one below."
- Rate-limit error → "Too many links requested. Try again in an hour, or continue with Google."

Pass `errorCallbackURL: "/sign-in"`, and `newUserCallbackURL: "/onboarding?callbackURL=<cb>"`, to
the magic-link call.

- [ ] **Step 5: Run** `pnpm test && pnpm build`. Expected: PASS. Then manually: `pnpm dev`, request a
  link, open the newest file in the outbox dir, follow the link. Expected: you end up at
  `/onboarding` (the page is built in Task 8, so a 404 is fine here) with a session cookie set.

- [ ] **Step 6: Commit** — `git commit -m "feat: better-auth with google and magic link sign-in"` (include files).

---

### Task 7: Validation, errors, defineAction, session helpers, profile service

**Files:**
- Create: `src/lib/validation.ts`, `src/lib/validation.test.ts`, `src/server/errors.ts`,
  `src/server/action.ts`, `test/action.test.ts`, `src/server/session.ts`, `src/server/profile.ts`,
  `test/profile.test.ts`, `test/factories.ts`, `src/server/actions/profile.ts`.

**Interfaces:**
- Produces validation exports (all Zod):
  - `displayNameSchema`: trimmed, 1–40 chars.
  - `currencySchema`: uppercased, must be in `Intl.supportedValuesOf("currency")`.
  - `upiIdSchema`: trimmed + lowercased, matches `^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,63}$`, and `""`
    becomes `null`.
  - `timezoneSchema`: in `Intl.supportedValuesOf("timeZone")` or `"UTC"`.
  - `profileSchema = z.object({ name: displayNameSchema, defaultCurrency: currencySchema, upiId: upiIdSchema, timezone: timezoneSchema })`.
  - Type `ProfileInput`.
- Produces `errors.ts`: `UserError(message)`, `ForbiddenError()`, `NotFoundError(message = "Not found.")`.
- Produces `action.ts`:
  `type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }` and
  `defineAction<S extends z.ZodType, R>(schema: S, handler: (input: z.output<S>, user: SessionUser) => Promise<R>): (input: z.input<S>) => Promise<ActionResult<R>>`.
  Error mapping:
  - `ZodError` → its first issue's message
  - `UserError` and `NotFoundError` → their message
  - `ForbiddenError` → `"You don't have access to this group."`
  - anything else → `console.error` plus `"Something went wrong. Please try again."`
  - Next's redirect/notFound errors are re-thrown untouched.
- Produces `session.ts`:
  - `type SessionUser = { id; name; email; image: string | null; defaultCurrency; upiId: string | null; timezone; onboardedAt: Date | null }`
  - `getSessionUser(): Promise<SessionUser | null>`
  - `requireUser(): Promise<SessionUser>` → redirects to `/sign-in`
  - `requireOnboardedUser(returnTo?: string): Promise<SessionUser>` → redirects to
    `/onboarding?callbackURL=<returnTo>` when `onboardedAt` is null
- Produces `profile.ts`: `completeOnboarding(userId: string, input: ProfileInput): Promise<void>` (also
  sets `onboardedAt = now()`) and `updateProfile(userId: string, input: ProfileInput): Promise<void>`.
- Produces `factories.ts`: `createUser(overrides?: Partial<User>): Promise<User>` (onboarded by default,
  unique email).

- [ ] **Step 1: Write the failing tests**

`src/lib/validation.test.ts`:
```ts
it("trims and lowercases UPI IDs", () => expect(upiIdSchema.parse("  Sumit.T@OkAxis ")).toBe("sumit.t@okaxis"));
it("treats an empty UPI ID as none", () => expect(upiIdSchema.parse("")).toBeNull());
it("rejects a UPI ID without a handle", () => expect(() => upiIdSchema.parse("sumit")).toThrow());
it("uppercases known currencies", () => expect(currencySchema.parse("inr")).toBe("INR"));
it("rejects unknown currencies", () => expect(() => currencySchema.parse("QQQ")).toThrow());
it("rejects whitespace-only names", () => expect(() => displayNameSchema.parse("   ")).toThrow());
it("rejects names over 40 characters", () => expect(() => displayNameSchema.parse("a".repeat(41))).toThrow());
it("accepts emoji names", () => expect(displayNameSchema.parse(" Priya 🌸 ")).toBe("Priya 🌸"));
```

`test/action.test.ts` (with `vi.mock("@/server/session", () => ({ requireUser: async () => fakeUser }))`):
```ts
it("returns data on success", async () => expect(await defineAction(z.object({}), async () => 7)({})).toEqual({ ok: true, data: 7 }));
it("maps UserError to its message", async () => expect(await defineAction(z.object({}), async () => { throw new UserError("Nope"); })({})).toEqual({ ok: false, error: "Nope" }));
it("maps ForbiddenError to a generic message", ...)   // error: "You don't have access to this group."
it("returns the first validation issue", ...)         // defineAction(z.object({ name: displayNameSchema }), ...)({ name: " " }) -> ok:false
it("hides unexpected errors", ...)                    // error: "Something went wrong. Please try again."
```

`test/profile.test.ts`:
```ts
it("saves the profile and marks the user onboarded", async () => {
  const u = await createUser({ onboardedAt: null });
  await completeOnboarding(u.id, { name: "Asha", defaultCurrency: "INR", upiId: "asha@okicici", timezone: "Asia/Kolkata" });
  const saved = await db.user.findUniqueOrThrow({ where: { id: u.id } });
  expect(saved).toMatchObject({ name: "Asha", defaultCurrency: "INR", upiId: "asha@okicici", timezone: "Asia/Kolkata" });
  expect(saved.onboardedAt).toBeInstanceOf(Date);
});
```

- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.

- [ ] **Step 3: Implement** the files listed under Interfaces. `actions/profile.ts` exports
  `completeOnboardingAction` and `updateProfileAction` = `defineAction(profileSchema, …)`, then calls
  `revalidatePath("/", "layout")`.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: validation, action wrapper, session helpers, profile service"` (include files).

---

### Task 8: Proxy, onboarding and account UI, Playwright

**Files:**
- Create: `src/proxy.ts`, `src/app/providers.tsx`, `src/components/user-avatar.tsx`,
  `src/app/(auth)/onboarding/page.tsx` (+ client stepper), `src/app/(app)/layout.tsx` (minimal for
  now), `src/app/(app)/dashboard/page.tsx` (placeholder), `src/app/(app)/account/page.tsx`
  (+ client parts), `playwright.config.ts`, `e2e/helpers.ts`, `e2e/onboarding.spec.ts`.
- Modify: `src/app/layout.tsx` (providers, fonts), `src/app/globals.css` (tokens), `ci.yml` (e2e step).

**Interfaces:**
- Consumes: `requireUser`, `requireOnboardedUser`, `completeOnboardingAction`, `updateProfileAction`,
  `authClient`, `safeCallback`.
- Produces: `UserAvatar({ name, image, size?: "sm" | "md" | "lg" })`. It falls back to initials on a
  colour derived from a hash of `name` (8 fixed hues).
- Produces e2e helper `signInWithMagicLink(page: Page, email: string): Promise<void>` (fills
  `/sign-in`, reads `lastEmailTo`, follows the link).
- Proxy matcher: `/dashboard/:path*`, `/groups/:path*`, `/account/:path*`, `/onboarding`,
  `/join/:path*`, `/claim/:path*`. With no Better Auth session cookie (`getSessionCookie`), it
  redirects to `/sign-in?callbackURL=<pathname+search>`.

Design tokens (`globals.css`, light/dark):
- `--primary`: emerald (600 light / 400 dark)
- `--positive`: emerald
- `--negative`: rose
- `--radius`: `0.875rem`
- Font: Geist (scaffold default). Theme via `next-themes` (`attribute="class"`, default `system`).
- `sonner` `<Toaster richColors position="top-center" />` in providers.

- [ ] **Step 1: Write the failing e2e** `e2e/onboarding.spec.ts`

```ts
test("new user signs in, onboards, lands on dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fdashboard/);
  await signInWithMagicLink(page, "neha@example.test");
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Your name").fill("Neha");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("UPI ID (optional)").fill("neha@okhdfc");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Go to dashboard" }).click();
  await expect(page.getByRole("heading", { name: /Hi, Neha/ })).toBeVisible();
});
test("expired or used magic link shows a friendly message", async ({ page }) => {
  await page.goto("/sign-in?error=INVALID_TOKEN");
  await expect(page.getByText("That sign-in link has expired or was already used.")).toBeVisible();
});
```

`playwright.config.ts`: chromium only. Global setup runs `prisma migrate reset --force` on
`TEST_DATABASE_URL` and clears the outbox. `webServer` = `pnpm build && pnpm start` on port 3100,
with env `DATABASE_URL=$TEST_DATABASE_URL`, `SMTP_URL=file://./.e2e-outbox`,
`BETTER_AUTH_URL=http://localhost:3100`, and dummy Google values. Add the script
`test:e2e: playwright test`.

- [ ] **Step 2: Run** `pnpm test:e2e`. Expected: FAIL (onboarding page missing).

- [ ] **Step 3: Implement**

- **Proxy.**
- **Onboarding** (3 steps with a progress dots header and `motion` slide transitions, responsive and
  centred, max-width 28rem):
  1. "Your name" (prefilled from Google) + avatar preview
  2. "Default currency" select (prefilled from `Intl.NumberFormat().resolvedOptions().locale`'s
     region; INR for IN), "UPI ID (optional)" with helper text "So friends can pay you in one tap",
     and timezone auto-filled from `Intl.DateTimeFormat().resolvedOptions().timeZone` (hidden)
  3. "You're all set" with buttons "Create a group" (→ `/dashboard?new=1`), "Join with a link"
     (paste field that accepts a full invite URL or a code → `/join/<code>`) and "Go to dashboard"

  Completing step 2 calls `completeOnboardingAction`. After step 3, go to `safeCallback(callbackURL)`
  when present.
- **`(app)/layout.tsx`** calls `requireOnboardedUser()`.
- **Dashboard placeholder**: heading "Hi, {firstName}".
- **Account page**:
  - profile form (same fields)
  - theme toggle (System/Light/Dark segmented)
  - "Signed-in devices" list (`auth.api.listSessions`) with a "Sign out other devices" button
    (`authClient.revokeOtherSessions`)
  - "Sign out"

  Toasts on save.
- **CI**: add `pnpm exec playwright install --with-deps chromium` and `pnpm test:e2e` to the `check`
  job, after the build.

- [ ] **Step 4: Run** `pnpm test:e2e && pnpm test`. Expected: PASS. Then check `/onboarding` at 375px
  and 1280px widths in the browser pane, in light and dark mode.

- [ ] **Step 5: Commit** — `git commit -m "feat: route protection, onboarding, account settings, e2e harness"` (include files).

---

### Task 9: Group and member models, authorisation

**Files:**
- Create: `src/server/authz.ts`, `test/authz.test.ts`, `src/lib/tokens.ts`.
- Modify: `prisma/schema.prisma`, `test/factories.ts`.

**Interfaces:**
- Models:
  - `enum GroupType { TRIP HOME COUPLE EVENT OTHER DIRECT }`
  - `enum MemberRole { OWNER ADMIN MEMBER }`
  - `Group { id cuid, name, emoji, color, type GroupType, baseCurrency String, simplifyDebts Boolean @default(true), inviteCode String @unique, archivedAt DateTime?, createdById → User, createdAt, updatedAt @updatedAt }`
  - `GroupMember { id cuid, groupId → Group (cascade), userId String? → User, displayName, email String?, role MemberRole @default(MEMBER), claimToken String? @unique, joinedAt DateTime @default(now()), leftAt DateTime?, createdAt }`
    with `@@unique([groupId, userId])` and `@@index([userId])`
- Produces `tokens.ts`: `newInviteCode(): string` (`randomBytes(8).toString("base64url")`, 11 chars) and
  `newClaimToken(): string` (`randomBytes(24).toString("base64url")`).
- Produces `authz.ts`:
  `requireMember(userId: string, groupId: string, opts?: { write?: boolean; role?: "admin" | "owner" }): Promise<{ member: GroupMember; group: Group }>`.
  Behaviour:
  - Looks only at the active row (`leftAt: null`). A missing row or missing group → `ForbiddenError`,
    so a group's existence never leaks.
  - `write` on an archived group → `UserError("This group is archived.")`.
  - `role: "admin"` needs ADMIN or OWNER, and `"owner"` needs OWNER. Otherwise → `ForbiddenError`.
- Produces factories: `createGroup(ownerId: string, overrides?: Partial<Group>): Promise<Group>` (also
  creates the OWNER member) and `addMember(groupId: string, data: { userId?: string; role?: MemberRole; leftAt?: Date; displayName?: string; email?: string; claimToken?: string }): Promise<GroupMember>`.

- [ ] **Step 1: Write the failing tests** `test/authz.test.ts`

```ts
it("returns member and group for an active member", async () => { /* owner → member.role === "OWNER" */ });
it("forbids a non-member", async () => { await expect(requireMember(stranger.id, g.id)).rejects.toBeInstanceOf(ForbiddenError); });
it("forbids a member who left", async () => { /* addMember(..., { leftAt: new Date() }) → ForbiddenError */ });
it("forbids a group that does not exist", async () => { await expect(requireMember(owner.id, "nope")).rejects.toBeInstanceOf(ForbiddenError); });
it("refuses writes to an archived group", async () => {
  await db.group.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
  await expect(requireMember(owner.id, g.id, { write: true })).rejects.toThrow("This group is archived.");
});
it("allows reads of an archived group", async () => { /* no opts → resolves */ });
it("requires ADMIN or OWNER for role admin", async () => { /* MEMBER → ForbiddenError; ADMIN → ok */ });
it("requires OWNER for role owner", async () => { /* ADMIN → ForbiddenError */ });
```

- [ ] **Step 2: Run** `pnpm prisma migrate dev --name groups && pnpm test`. Expected: FAIL.

- [ ] **Step 3: Implement** `tokens.ts`, `authz.ts` and the factories.

- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: group and member models with authorisation guard"` (include files).

---

### Task 10: Group service and actions

**Files:**
- Create: `src/server/groups.ts`, `src/server/actions/groups.ts`, `test/groups.test.ts`.
- Modify: `src/lib/validation.ts` (+ group schemas), `src/lib/validation.test.ts`.

**Interfaces:**
- Consumes: `requireMember`, `newInviteCode`, `displayNameSchema`, `currencySchema`, `defineAction`.
- Produces in `validation.ts`:
  - `GROUP_COLORS = ["emerald","sky","violet","rose","amber","teal","indigo","orange"] as const`
  - `groupInputSchema = z.object({ name: trimmed 1–60, emoji: string 1–16 chars default "👥", color: z.enum(GROUP_COLORS) default "emerald", type: z.enum(["TRIP","HOME","COUPLE","EVENT","OTHER"]), baseCurrency: currencySchema, simplifyDebts: z.boolean().default(true) })`
  - Type `GroupInput`
- Produces in `groups.ts`:
  - `createGroup(userId, input: GroupInput): Promise<Group>`: one transaction that creates the group
    and its OWNER member (displayName = user's name).
  - `updateGroup(userId, groupId, input: GroupInput): Promise<Group>`: admin + write.
  - `archiveGroup(userId, groupId): Promise<void>`: admin + write.
  - `unarchiveGroup(userId, groupId): Promise<void>`: admin, no write check.
  - `listGroupsForUser(userId): Promise<{ active: GroupListItem[]; archived: GroupListItem[] }>`:
    active memberships only, excludes DIRECT, ordered by `updatedAt` desc.
    `GroupListItem = { id; name; emoji; color; type; baseCurrency; memberCount: number; previewMembers: { displayName; image: string | null }[] /* ≤5 */ }`.
  - `getGroupDetail(userId, groupId): Promise<{ group: Group; me: GroupMember; members: (GroupMember & { image: string | null; isPlaceholder: boolean })[] }>`:
    active members only, ordered OWNER, ADMIN, MEMBER, then `joinedAt`.
- Produces actions: `createGroupAction`, `updateGroupAction`, `archiveGroupAction` and
  `unarchiveGroupAction`, each calling `revalidatePath`.

- [ ] **Step 1: Write the failing tests** `test/groups.test.ts` (+ schema cases in `validation.test.ts`)

```ts
it("creates the group with the creator as OWNER and an 11-char invite code", async () => {
  const g = await createGroup(asha.id, input({ name: "  Goa Trip " }));
  expect(g.name).toBe("Goa Trip");
  expect(g.inviteCode).toHaveLength(11);
  const m = await db.groupMember.findFirstOrThrow({ where: { groupId: g.id } });
  expect(m).toMatchObject({ userId: asha.id, role: "OWNER", displayName: "Asha" });
});
it("rejects the DIRECT type from user input", () => expect(() => groupInputSchema.parse({ ...valid, type: "DIRECT" })).toThrow());
it("lets only admins update a group", async () => { /* MEMBER → ForbiddenError; ADMIN → updated */ });
it("moves archived groups to the archived list and back", async () => { /* archive → in archived; unarchive → in active */ });
it("leaves out groups the user has left", async () => { /* leftAt set → not in active or archived */ });
it("lists only active members, owner first, with placeholder flag", async () => { /* placeholder → isPlaceholder true */ });
```

- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.

- [ ] **Step 3: Implement** `groups.ts` and the actions.

- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: group service and actions"` (include files).

---

### Task 11: Members, invites, joining, claiming

**Files:**
- Create: `src/server/members.ts`, `src/server/actions/members.ts`, `src/emails/invite.ts`,
  `test/members.test.ts`.
- Modify: `src/lib/validation.ts` (+ `placeholderSchema`).

**Interfaces:**
- Consumes: `requireMember`, `newInviteCode`, `newClaimToken`, `sendEmail`, `env.BETTER_AUTH_URL`.
- Produces `placeholderSchema = z.object({ displayName: displayNameSchema, email: z.email().transform(lowercase).optional().or(z.literal("").transform(() => undefined)) })`.
- Produces `inviteEmail({ inviterName, groupName, claimUrl }): { subject: \`${inviterName} added you to ${groupName} on Hisaab\`; html; text }`.
- Produces in `members.ts` (all return plain data, and all throw `UserError`/`ForbiddenError`/`NotFoundError`):
  - `addPlaceholder(userId, groupId, input): Promise<GroupMember>`:
    - any member, write
    - if the email belongs to an active member (by user email or placeholder email) →
      `UserError("They're already in this group.")`
    - with an email: send an invite email (`kind: "invite"`, `senderUserId: userId`) containing
      `${BETTER_AUTH_URL}/claim/${claimToken}`
  - `joinByInviteCode(userId, code): Promise<{ groupId: string }>`:
    - unknown code or DIRECT group → `NotFoundError("This invite link is invalid or has been reset.")`
    - archived → `UserError("This group is archived.")`
    - already an active member → return as-is (idempotent)
    - has a left row → reactivate it (`leftAt: null`, `joinedAt: now`)
    - an unclaimed placeholder with the same email exists → claim that one instead
    - otherwise → create a MEMBER with displayName = user's name
  - `rotateInviteCode(userId, groupId): Promise<string>`: admin + write.
  - `claimPlaceholder(userId, token): Promise<{ groupId: string }>`:
    - no unclaimed member with this token → `NotFoundError("This link was already used or has been reset.")`
    - archived → `UserError("This group is archived.")`
    - placeholder email set and ≠ user email → `UserError("This invite was sent to a different email address.")`
    - user is an active member → `UserError("You're already in this group.")`
    - user has a left row → `UserError("You were in this group before. Use the group's invite link to rejoin.")`
    - success → set `userId`, `claimToken: null`, displayName = user's name, `joinedAt: now`
  - `regenerateClaimToken(userId, memberId): Promise<string>`: admin. Placeholders only, otherwise
    `UserError`.
  - `removeMember(userId, memberId): Promise<void>`:
    - admin + write
    - target OWNER → `UserError("The owner can't be removed.")`
    - an ADMIN target needs the actor to be OWNER
    - sets `leftAt`
  - `setMemberRole(userId, memberId, role: "ADMIN" | "MEMBER"): Promise<void>`: owner only. The target
    must be a non-placeholder active member who isn't the OWNER.
  - `transferOwnership(userId, memberId): Promise<void>`: owner only. The target must be a
    non-placeholder active member. Target → OWNER, actor → ADMIN, in one transaction.
  - `leaveGroup(userId, groupId): Promise<void>`: an OWNER gets
    `UserError("Transfer ownership before leaving.")`. Otherwise sets `leftAt`.
- Produces actions wrapping each of the above, with matching `…Action` names.

- [ ] **Step 1: Write the failing tests** `test/members.test.ts`

```ts
it("joining twice keeps a single member row", async () => {
  await joinByInviteCode(ravi.id, g.inviteCode); await joinByInviteCode(ravi.id, g.inviteCode);
  expect(await db.groupMember.count({ where: { groupId: g.id, userId: ravi.id } })).toBe(1);
});
it("rejoining after leaving reactivates the old row", async () => { /* leave → join → same member id, leftAt null */ });
it("joining claims a placeholder invited with the same email (case-insensitive)", async () => {
  const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "rahul@example.test" });
  const rahul = await createUser({ email: "rahul@example.test", name: "Rahul K" });
  await joinByInviteCode(rahul.id, g.inviteCode);
  expect(await db.groupMember.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ userId: rahul.id, claimToken: null, displayName: "Rahul K" });
});
it("refuses joining an archived group", async () => { /* → "This group is archived." */ });
it("refuses an unknown or rotated invite code", async () => { /* rotate, old code → "This invite link is invalid or has been reset." */ });
it("sends an invite email with a claim link", async () => {
  const p = await addPlaceholder(asha.id, g.id, { displayName: "Rahul", email: "Rahul@Example.test" });
  const m = await lastEmailTo("rahul@example.test");
  expect(m.subject).toBe("Asha added you to Goa Trip on Hisaab");
  expect(m.text).toContain(`/claim/${p.claimToken}`);
});
it("claim links work once", async () => { /* second claim → "This link was already used or has been reset." */ });
it("claim refuses a different email", async () => { /* → "This invite was sent to a different email address." */ });
it("claim refuses someone already in the group", async () => { /* → "You're already in this group." */ });
it("the owner cannot leave or be removed", async () => {
  await expect(leaveGroup(asha.id, g.id)).rejects.toThrow("Transfer ownership before leaving.");
  await expect(removeMember(adminUser.id, ownerMember.id)).rejects.toThrow("The owner can't be removed.");
});
it("transferring ownership swaps roles atomically", async () => { /* new OWNER, old → ADMIN, exactly one OWNER */ });
it("an admin cannot remove another admin", async () => { /* → ForbiddenError */ });
```

- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.

- [ ] **Step 3: Implement** `members.ts`, `invite.ts` and the actions. Every multi-row change goes in
  a `db.$transaction`.

- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: invites, joining, placeholder claims, roles"` (include files).

---

### Task 12: App shell, dashboard, create-group flow

**Files:**
- Create: `src/components/app-shell/{bottom-nav.tsx, sidebar.tsx, fab.tsx}`,
  `src/components/group-form.tsx`, `src/components/create-group-sheet.tsx`,
  `src/components/group-card.tsx`, `src/app/(app)/groups/page.tsx`, `e2e/groups.spec.ts` (first test).
- Modify: `src/app/(app)/layout.tsx`, `src/app/(app)/dashboard/page.tsx`.
- shadcn add: button, input, label, card, avatar, badge, dropdown-menu, sheet, drawer, dialog, tabs,
  select, switch, toggle-group, skeleton, separator, sonner.

**Interfaces:**
- Consumes: `listGroupsForUser`, `createGroupAction`, `requireOnboardedUser`, `UserAvatar`, `GROUP_COLORS`.
- Produces: `GroupForm({ defaultValues?: Partial<GroupInput>; submitLabel: string; onSubmit(values: GroupInput): Promise<ActionResult<unknown>> })`,
  reused by settings in Task 13.

Layout and behaviour:
- **Mobile (<768px):** fixed bottom nav with Home (`/dashboard`), Groups (`/groups`) and Account
  (`/account`). Only built sections appear, and later phases add Friends and Activity. Bottom-right
  FAB "+" opens the create-group sheet; Phase 2 repurposes it to "Add expense". Safe-area padding
  (`env(safe-area-inset-bottom)`).
- **Desktop (≥768px):** left sidebar with the same items, the user card at the bottom, and a
  "New group" button.
- **Dashboard:** "Hi, {firstName}" + date, then the group cards grid.
  - Card: emoji in a soft tile tinted with the group colour, name, a type badge, a stack of up to 5
    `UserAvatar`s plus "+N", and the base currency.
  - Empty state: a large 👋 + "No groups yet", the copy "Create a group for your next trip, your flat,
    or anything you split.", and buttons "Create a group" / "Join with a link".
  - `?new=1` opens the sheet on load.
- **Create-group sheet:** vaul drawer on mobile, dialog on desktop. Fields:
  - Name (autofocus)
  - Type as a toggle group, with icons for Trip ✈️ / Home 🏠 / Couple 💑 / Event 🎉 / Other 👥
  - Emoji grid of 24 curated emojis, whose default follows the type
  - Colour swatches
  - Currency select (user's default first, then INR USD EUR GBP AED SGD THB, then the rest)
  - "Simplify debts" switch with a one-line explainer

  On success: toast "Group created", navigate to `/groups/<id>`, `navigator.vibrate?.(10)`.
- **`/groups`:** tabs Active / Archived using the same cards.
- Every interactive element is reachable by keyboard and has visible focus rings.

- [ ] **Step 1: Write the failing e2e** (in `e2e/groups.spec.ts`)

```ts
test("create a group from the empty dashboard", async ({ page }) => {
  await signInAndOnboard(page, "asha@example.test", "Asha"); // helper wrapping Task 8 steps
  await expect(page.getByText("No groups yet")).toBeVisible();
  await page.getByRole("button", { name: "Create a group" }).click();
  await page.getByLabel("Group name").fill("Goa Trip");
  await page.getByRole("radio", { name: "Trip" }).click();
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/groups\/c/);
  await expect(page.getByRole("heading", { name: "Goa Trip" })).toBeVisible();
});
```

- [ ] **Step 2: Run** `pnpm test:e2e`. Expected: FAIL.

- [ ] **Step 3: Implement** the shell, dashboard, sheet and `/groups`. Add a minimal
  `/groups/[groupId]` page showing the heading, which Task 13 fills in.

- [ ] **Step 4: Run** `pnpm test:e2e`. Expected: PASS. Then check the dashboard (empty and with 3
  groups) at 375px and 1280px, in light and dark mode, in the browser pane.

- [ ] **Step 5: Commit** — `git commit -m "feat: app shell, dashboard and create-group flow"` (include files).

---

### Task 13: Group page, invites, join/claim pages, settings

**Files:**
- Create: `src/components/invite-sheet.tsx`, `src/components/member-list.tsx`,
  `src/app/(app)/groups/[groupId]/settings/page.tsx`, `src/app/join/[inviteCode]/page.tsx`,
  `src/app/claim/[token]/page.tsx`.
- Modify: `src/app/(app)/groups/[groupId]/page.tsx`, `e2e/groups.spec.ts`.

**Interfaces:**
- Consumes: `getGroupDetail`, every member action from Task 11, `updateGroupAction`,
  `archiveGroupAction`, `unarchiveGroupAction`, `GroupForm`, the `qrcode` package
  (`QRCode.toDataURL`, rendered on the server).

Behaviour:
- **Group page:**
  - Header: emoji tile, name, type badge, currency, member count, and a settings cog (admins only).
  - Archived → a banner "This group is archived" plus an "Unarchive" button for admins.
  - Member list: avatar, name, role badge (Owner/Admin), and a "Not joined yet" badge with a
    "Copy invite link" action for placeholders (copies their claim URL).
  - "Invite people" button opens the invite sheet.
  - Phase 2 adds the expenses and balances tabs.
- **Invite sheet:**
  1. Group link: a read-only input labelled "Invite link" with a Copy button (toast "Link copied"),
     a "Share" button when `navigator.share` exists (text: "Join {group} on Hisaab"), and the QR code.
  2. "Invite by email": name + email, then "Send invite".
  3. "Add someone without an account": name only, then "Add".

  The rate-limit error shows the action's message.
- **`/join/[inviteCode]`:**
  - Calls `requireOnboardedUser(\`/join/${code}\`)`.
  - Already a member → redirect to the group.
  - Otherwise a centred card: emoji, group name, "{n} members: Asha, Ravi and 2 others", and a
    "Join group" button (POST via the action, never on GET), then redirect.
  - Invalid code or archived → the error card with the action's message and a "Go to dashboard"
    link.
- **`/claim/[token]`:** the same pattern. Card "Join {group} as {placeholder name}" with a
  "Join group" button. Errors show the messages from Task 11.
- **Settings (admins):**
  - `GroupForm` for editing.
  - Members with a row menu: Make admin / Remove admin (owner), Transfer ownership (owner, behind a
    confirm dialog), Remove (behind a confirm dialog), and New claim link (placeholders).
  - "Reset invite link" (confirm: "The old link will stop working.").
  - Archive / Unarchive.
- **Everyone:** a "Leave group" section. The owner sees the transfer hint instead.

- [ ] **Step 1: Write the failing e2e** (append to `e2e/groups.spec.ts`)

```ts
test("signed-out friend opens the invite link, signs up, and joins", async ({ browser }) => {
  const a = await browser.newPage();
  await signInAndOnboard(a, "asha@example.test", "Asha");
  const groupUrl = await createGroupViaUi(a, "Goa Trip");
  await a.getByRole("button", { name: "Invite people" }).click();
  const invite = await a.getByLabel("Invite link").inputValue();

  const b = await (await browser.newContext()).newPage();
  await b.goto(invite);
  await expect(b).toHaveURL(/\/sign-in\?callbackURL=%2Fjoin%2F/);
  await signInWithMagicLink(b, "ravi@example.test");
  await completeOnboardingUi(b, "Ravi");
  await expect(b).toHaveURL(new RegExp(new URL(invite).pathname));
  await b.getByRole("button", { name: "Join group" }).click();
  await expect(b.getByText("Asha")).toBeVisible();

  await a.goto(groupUrl);
  await expect(a.getByText("Ravi")).toBeVisible();
});

test("placeholder invited by email claims their spot once", async ({ browser }) => {
  // Asha invites "Rahul" <rahul@example.test> by email → read the claim URL from lastEmailTo
  // new context: open the claim URL → sign in as rahul@example.test → onboard → "Join group"
  // → member list shows Rahul without the "Not joined yet" badge
  // reopen the claim URL → "This link was already used or has been reset."
});

test("non-admins do not see group settings", async ({ browser }) => { /* Ravi sees no settings cog; /groups/<id>/settings → 403 page */ });
```

Move `signInAndOnboard`, `createGroupViaUi` and `completeOnboardingUi` into `e2e/helpers.ts`.

- [ ] **Step 2: Run** `pnpm test:e2e`. Expected: FAIL.

- [ ] **Step 3: Implement** the pages and components above. The settings page calls
  `requireMember(user.id, groupId, { role: "admin" })`, and its `ForbiddenError` renders a "You don't
  have access" page.

- [ ] **Step 4: Run** `pnpm test && pnpm test:e2e && pnpm lint && pnpm typecheck`. Expected: all pass.
  Then walk through the invite flow at 375px in the browser pane: QR renders, copy works, dark mode
  is legible.

- [ ] **Step 5: Commit** — `git commit -m "feat: group page, invites, join and claim pages, settings"` (include files).

---

### Task 14: Production rollout of Phase 1

**Requires Sumit (stop and hand him these exact steps):**
1. In Google Cloud Console for the Hisaab project, go to **APIs & Services → OAuth consent screen**:
   External, app name "Hisaab", your support email, scopes openid/email/profile, publish to
   production.
2. Go to **Clients → Create client → Web application**:
   - Authorized JavaScript origins: `<APP_URL>` and `http://localhost:3000`
   - Redirect URIs: `<APP_URL>/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`
3. Create a Gmail app password (myaccount.google.com → Security → App passwords).
4. Add the secrets yourself, so their values never pass through chat:
   ```bash
   printf '%s' '<client id>'     | gcloud secrets create GOOGLE_CLIENT_ID --data-file=- --project <PROJECT_ID>
   printf '%s' '<client secret>' | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=- --project <PROJECT_ID>
   printf '%s' 'smtps://<you>%40gmail.com:<app password>@smtp.gmail.com:465' | gcloud secrets create SMTP_URL --data-file=- --project <PROJECT_ID>
   ```
5. Put the same values in a local `.env` for `pnpm dev`.

**Files:**
- Modify: `.github/workflows/ci.yml` (deploy flags), `infra/setup.sh` (record the new secret names so
  the script grants access idempotently), `README.md`.

- [ ] **Step 1: Wire the deploy**

Add the following to `gcloud run deploy`:
- `--set-secrets DATABASE_URL=DATABASE_URL:latest,BETTER_AUTH_SECRET=BETTER_AUTH_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,SMTP_URL=SMTP_URL:latest`
- `--set-env-vars BETTER_AUTH_URL=${{ vars.APP_URL }},EMAIL_FROM=Hisaab <your gmail>`

- [ ] **Step 2: Write `README.md`**

Include: what Hisaab is, the feature list for Phase 1, local setup (`docker compose up -d`,
`cp .env.example .env`, `pnpm i`, `pnpm db:migrate`, `pnpm dev`), the test commands, the deploy
overview, and the infra script usage.

- [ ] **Step 3: Open the PR and merge**

`git push -u origin feat/phase-1 && gh pr create --fill --base main`. Expected: CI `check` passes on
the PR. Merge after Sumit confirms. Expected: `deploy` passes and `/api/health` is ok.

- [ ] **Step 4: Verify on real devices (with Sumit)**

- On a phone: sign in with Google → onboarding → create "Test Group" → share the invite via
  WhatsApp.
- On a second account (laptop, magic link): open the invite → join.
- Both see each other in the member list.
- Check that the magic-link email arrives from Gmail within a minute.

**Phase 1 done.**

---

## Next plans (not in this document)

- Phase 2 (Money core) gets its own plan before coding starts. It extends `requireMember` with
  `requireMemberFor(entity, id)` and adds the zero-balance checks to `leaveGroup` and `removeMember`.
- Phases 3–6 follow the spec's Build Phases, one plan each.
