# Hisaab Phase 3 (Real-time & Notifications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changes made on one phone show up on every other phone in the group within about a second, with a
highlight. Everyone gets a notification centre, Web Push and email for what involves them, filtered by their own
preferences. People can nudge someone who owes them. Hisaab installs as a PWA that can show the last-viewed pages
offline.

**Architecture:** Every write's transaction calls `pg_notify` through one `publish()`, so an event exists only if the
write committed. Each Cloud Run instance keeps a single `LISTEN` connection and fans events out through an in-process
hub, to one SSE stream per open tab. The stream carries hints only (ids and kinds), and the tab answers with a
debounced `router.refresh()`. `recordActivity`, Phase 2's one choke point for writes, also creates notification rows
in the same transaction. Push and email go out after the response through Next's `after()`. A hand-written service
worker shows pushes and serves the last-viewed pages when offline.

**Tech Stack:** Next.js 16.4 (`after`, route handlers, metadata `manifest.ts`, `next/og` ImageResponse) · React 19 ·
TypeScript strict · Prisma 7.10 · PostgreSQL 16 `LISTEN/NOTIFY` via `pg` 8.23.1 · `web-push` 3.6.7 · Tailwind 4 +
shadcn (Base UI) · Vitest 5 · Playwright 1.64. New dependencies: `web-push`, `pg` (already in the tree under
`@prisma/adapter-pg`, now direct), `@types/web-push`, `@types/pg`. No Serwist and no TanStack Query (see
deviations).

**Spec:** `docs/superpowers/specs/2026-10-22-hisaab-design.md`: §9 Reminders & nudges (nudges only; the digest is
Phase 5), §10 Real-time & notifications, §12 (the PWA bullet), Data Model (`Notification`, `PushSubscription`,
`Nudge`, `notificationPrefs`), GCP Architecture (connection budget), Build Phase 3. The Phase 2 plan
(`docs/superpowers/plans/2026-10-23-hisaab-phase-2.md`) defines the services, activity kinds and UI this phase
extends.

## Global Constraints

- Build on branch `feat/phase-3`, cut from `main` after this plan's PR merges. Merge it through a PR in Task 13. PRs
  run the full check, and a merge to `main` deploys straight to production (deploys are queued).
- Phase 2's rules still hold:
  - Money is `bigint` minor units. It crosses JSON and the server→client boundary only as `MinorString` or as
    formatted text, and is shown with `formatMoney`.
  - Every service starts with `requireMember`/`requireMemberFor`.
  - A write and its `Activity` row share one `db.$transaction`.
  - Actions use `defineAction` and call `revalidateGroup()` after a write.
  - Every new actions file gets rows in `test/authz-actions.test.ts` in the task that creates it.
  - User-facing strings are exactly as written here.
- **Every NOTIFY goes through `publish()` (Task 2), inside the writing transaction** when there is one, so Postgres
  delivers it only on commit. Where a write has no transaction, call `publish()` right after it succeeds.
- **Real-time payloads are hints, never data.** They carry only group, entity and user ids plus a kind. They never
  carry amounts, names or text. A tab that gets a hint refetches through the normal authorised pages.
- **Connection budget:** the Prisma pool stays at `max: 5`, plus exactly one `LISTEN` `pg.Client` per instance
  (`application_name: "hisaab-listen"`). Nothing opens another pool or client. At most 3 instances × (5 + 1), plus
  the migrate job, is about 19 of `db-f1-micro`'s ~25 connections.
- **Cloud Run** keeps `--concurrency 500 --timeout 3600`. An SSE stream ends itself after 50 minutes, sends a
  heartbeat every 25 seconds, and closes while its tab is hidden.
- **Recipients:** a notification goes only to active members (`leftAt` null) who have an account, and never to the
  person who caused it. The one exception is "added to a group", whose recipient isn't a member yet.
- **Email:** every send goes through `sendEmail`. Notification and nudge emails have their own caps (Task 5). Within
  the existing 450-a-day global cap, they always leave room for sign-in links and invites.
- **Secrets:** `HISAAB_VAPID_PUBLIC_KEY` and `HISAAB_VAPID_PRIVATE_KEY` in Secret Manager become the env vars
  `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Implementers never run `gcloud`, `infra/setup.sh` or any infra
  command, and never print a key, a secret or `.env`. Only the controller (main session) runs `bash infra/setup.sh`,
  with Sumit's approval, in Task 12.
- Never use Prisma `mode: "insensitive"`. It compiles to unescaped ILIKE. Compare lowercased values exactly, e.g.
  ``$queryRaw`… WHERE lower(email) = ${email}` ``.
- Tests never reach a push service: every test file that can send a push mocks `web-push`.
  - Outside a request (in Vitest, in scripts), `after()` throws. `scheduleDelivery` then does nothing, and tests
    call `deliverNotifications` directly.
  - `test/setup.ts` sets dummy VAPID keys so the push code paths run.
- The service worker registers only in production builds (`pnpm test:e2e` uses one), never under `next dev`.
- Before writing route handlers, `after`, metadata files (manifest, icons), pages or search params, read the matching
  guide in `node_modules/next/dist/docs/` (`04-functions/after.md`, `01-getting-started/15-route-handlers.md`,
  `03-file-conventions/01-metadata/manifest.md`, `02-guides/progressive-web-apps.md`).
- UI is mobile-first:
  - Touch targets are at least 44px (`h-11`/`size-11`), with visible focus rings.
  - Colour is never the only signal.
  - `prefers-reduced-motion` is respected.
  - New screens are checked at 375px and 1280px, light and dark (Playwright screenshots in the SDD workspace's
    `shots/` dir are fine).
- **Each `pnpm test:e2e` is a full production build** (minutes). Run only your task's spec file. Task 13 runs the
  whole suite once. Never run `docker build` (the host disk is tight); PR CI builds both images.
- Every Playwright context comes from `newPage`/`signedInPage` in `e2e/helpers.ts`, which gives it its own
  `x-forwarded-for`.

**Deliberate deviations from the spec (recorded so reviewers don't flag them):**
- **One SSE stream per tab, not one per group.** `GET /api/events` carries all of the person's groups plus their own
  inbox. The bell and the dashboard need live updates too, and moving between groups never reconnects.
- **Live updates use `router.refresh()`, not TanStack Query invalidation.** Phases 1–2 render every list with Server
  Components and never adopted TanStack Query, so invalidation would need a parallel JSON API for every list. A
  refresh re-renders the open page with fresh data, and the highlight is the same.
- **A hand-written `public/sw.js`, not Serwist.**
  - Next 16 builds with Turbopack. Serwist's Turbopack path builds the worker in a route handler with esbuild and
    pulls in `@swc/core` and `esbuild`.
  - This phase needs runtime caching of what was viewed, plus push display and click handling. That's about 100
    lines of plain JS with no build step and no dependencies.
  - Precaching an app shell (Serwist's main benefit) isn't needed for "offline read-only of the last-viewed data".
- **Push and email are sent after the response**, through `after()` with Cloud Run's `--no-cpu-throttling`
  (instance-based billing; the service still scales to zero). With request-based CPU, work after the response can
  stall, and the push would arrive late or never. **Sumit decides this when he reviews this plan, before Task 5.** If
  he says no, Task 5's `scheduleDelivery` awaits delivery inside the action instead, which adds roughly 0.3–2s to each
  save. Task 12 then drops the flag.
- **Preferences are per channel × event for push and email.** The notification centre always lists everything; it
  is the record.
  - "Added to a group" has no email switch, because the invite email already is that email.
  - Email defaults to on only for disputes, nudges and mentions, to stay within Gmail's 500-a-day limit.
- **What "added to a group" means.** It is sent when someone adds a placeholder with the email of a person who
  already has an account (the only way an existing account gets added). Joining through a link is the person's own
  act and notifies no one.
- **Deferred to later phases.** Recurring-expense notifications come in Phase 5, because there are no recurring
  expenses yet. The "Scan receipt" app shortcut comes in Phase 4.
- **What doesn't notify.** Restoring an expense, and editing, deleting or restoring a payment, notify no one. The
  spec's events are added, edited and deleted expenses, and recorded and disputed payments.
- **One `Nudge` row per pair** (`fromMemberId`, `toMemberId`, with `sentAt` updated), not one row per nudge. That
  makes the 24-hour rule a single conditional update, so two taps can't both get through; the recipient's
  notifications are the history.
  - Only the person who is owed can nudge, and only someone who currently owes them per the suggested payments.
  - The person nudged must be an active member with an account.
- **Push subscriptions belong to the session that turned them on** (`sessionId`, which cascades). Signing out, or
  being signed out from another device, ends that device's pushes. Signing out also clears that device's offline
  page cache. A device signed out remotely keeps its cache until it next signs out there.
- **Notification text is written when the notification is created**, for that recipient. Names and amounts stay as
  they were at that moment. (Activity is rendered when it is read.)
- Notifications are never suppressed while the app is open, because iOS requires every push to show one.

## Review Focus

1. **Someone who leaves or is removed keeps an app tab open.** They stop getting that group's live events at once,
   and no later notification about the group reaches them. → tests in Tasks 2 and 4.
2. **A live update arrives while someone is halfway through editing the same expense.** What they typed stays, and
   their save still gets "Ravi edited this just now — reload?". → e2e in Task 3.
3. **A shared or borrowed phone.** After signing out, the next person sees none of the last person's pages offline
   and receives none of their pushes. → tests in Tasks 5 and 7.
4. **Double-tapping Nudge, or nudging from two tabs at once.** Exactly one reminder and one notification go out; the
   second gets "You've already reminded Ravi in the last 24 hours.". → test in Task 10.
5. **A busy trip day of notification emails.** Notification emails stop at their own daily cap, so sign-in links
   keep arriving, and no one gets more than 6 notification emails an hour. → test in Task 5.

---

## File Map

```
prisma/schema.prisma, prisma/migrations/<ts>_notifications/                     # Task 1
src/lib/realtime.ts (+ .test.ts)                                                 # Task 2: hub, wire types (pure)
src/server/realtime.ts                                                           # Task 2: publish, LISTEN, subscribe
src/server/{activity,groups,members,comments}.ts                                 # Task 2 publish; Task 4 notify
src/app/api/events/route.ts, src/components/live-updates.tsx                     # Task 3
src/lib/notifications.ts (+ .test.ts), src/server/notifications.ts               # Tasks 4–6
src/server/{expenses,settlements}.ts                                             # Task 4: who to notify
src/lib/{notification-prefs,push}.ts (+ .test.ts), src/emails/notification.ts    # Task 5
src/server/push.ts, src/server/actions/{notifications,push}.ts                   # Tasks 5–6
src/app/(app)/notifications/{page.tsx,[notificationId]/route.ts}                 # Task 6
src/components/{notification-bell,notification-list}.tsx, app-shell/mobile-header.tsx
public/sw.js, src/components/pwa.tsx, src/lib/device.ts, src/app/offline/page.tsx   # Task 7
src/lib/push-client.ts (+ .test.ts), src/components/notification-settings.tsx    # Task 8
src/app/{manifest.ts,apple-icon.tsx,pwa/[asset]/route.tsx}, src/lib/{pwa-assets,install-prompt}.ts,
  src/components/install-prompt.tsx                                              # Task 9
src/server/nudges.ts, src/server/actions/nudges.ts                               # Task 10
src/lib/mentions.ts (+ .test.ts)                                                 # Task 11
infra/setup.sh, .github/workflows/ci.yml, README.md, .env.example                # Task 12
test/{realtime,notifications,delivery,push,nudges}.test.ts (+ env, email, comments, authz-actions, factories, outbox)
e2e/{realtime,notifications,pwa,phones}.spec.ts (+ settle, expenses, helpers)
```

---

### Task 1: Schema, environment, dependencies

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/env.ts`, `test/env.test.ts`, `test/setup.ts`, `test/factories.ts`,
  `package.json`, `pnpm-lock.yaml`, `.env.example`.
- Create: migration `notifications`.

**Interfaces:**
- Models (`id String @id @default(cuid())`, `createdAt DateTime @default(now())`):
  - `Notification { userId → User (cascade), groupId String? → Group (cascade), actorUserId String? (no relation: the account may be deleted later), kind String, payload Json, readAt DateTime?, deliveredAt DateTime? }`, with `@@index([userId, createdAt])` and `@@index([userId, readAt])`.
    Doc comment: `kind`/`payload` follow `NotificationKind`/`NotificationPayload` in `src/lib/notifications.ts`;
    `deliveredAt` is set when push and email delivery is claimed, so nothing is sent twice.
  - `PushSubscription { userId → User (cascade), sessionId → Session (cascade), endpoint String @unique, p256dh String, auth String, updatedAt @updatedAt }`, with `@@index([userId])` and `@@index([sessionId])`.
    Doc comment: one browser's subscription, tied to the session that turned it on.
  - `Nudge { groupId → Group (cascade), fromMemberId → GroupMember ("NudgeFrom"), toMemberId → GroupMember ("NudgeTo"), sentAt DateTime @default(now()) }`, with `@@unique([fromMemberId, toMemberId])`.
    Doc comment: the last reminder `fromMember` sent `toMember`.
  - `User` gains `notificationPrefs Json @default("{}")` (not in Better Auth's `additionalFields`, so it never enters
    the session), plus the back-relations. `Session`, `Group` and `GroupMember` gain their back-relations.
- `env.ts` gains `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, each `z.string().min(1).optional()`. They must be set
  together: with only one, `parseEnv` throws, naming the missing one in its usual message.
- `test/setup.ts` sets `VAPID_PUBLIC_KEY = "test-vapid-public"` and `VAPID_PRIVATE_KEY = "test-vapid-private"`.
- `test/factories.ts` gains:
  - `createSessionRow(userId: string, overrides?: { expiresAt?: Date }): Promise<Session>`: a unique token, expiring in 30 days by default.
  - `createPushSubscriptionRow(userId: string, sessionId: string, endpoint?: string): Promise<PushSubscription>`:
    the default endpoint is `https://fcm.googleapis.com/fcm/send/<uuid>`, with 87-char `p256dh` and 22-char `auth`
    base64url strings.
  - `createNotificationRow(userId: string, data?: { groupId?: string; kind?: NotificationKind; text?: string; readAt?: Date; createdAt?: Date }): Promise<Notification>`
- Dependencies: `pnpm add web-push@3.6.7 pg@8.23.1`, then `pnpm add -D @types/web-push@3.6.4` plus `@types/pg` at
  the version already in `pnpm-lock.yaml`.
- `.env.example` gains a commented block: "Web Push (optional locally). Generate a pair with `pnpm exec web-push
  generate-vapid-keys`", followed by empty `VAPID_PUBLIC_KEY=` and `VAPID_PRIVATE_KEY=`.

- [ ] **Step 1: Write the failing test** (`test/env.test.ts`, append)

```ts
it("takes both VAPID keys or neither", () => {
  expect(parseEnv(valid)).toMatchObject({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined });
  expect(parseEnv({ ...valid, VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })).toMatchObject({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" });
  expect(() => parseEnv({ ...valid, VAPID_PUBLIC_KEY: "pub" })).toThrow("Invalid environment variables: VAPID_PRIVATE_KEY");
  expect(() => parseEnv({ ...valid, VAPID_PRIVATE_KEY: "priv" })).toThrow("Invalid environment variables: VAPID_PUBLIC_KEY");
});
```

- [ ] **Step 2: Run** `pnpm test test/env.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the schema, then run `pnpm prisma migrate dev --name notifications && pnpm prisma generate`
  (Prisma 7's `migrate dev` doesn't generate). Then implement env, factories, dependencies and `.env.example`.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS (the migration applies to `hisaab_test`).

- [ ] **Step 5: Commit**: `git commit -m "feat(notify): notification, push subscription and nudge models; VAPID env"` (include files).

---

### Task 2: Real-time core (publish, LISTEN, hub) and wiring every write

**Files:**
- Create: `src/lib/realtime.ts`, `src/lib/realtime.test.ts`, `src/server/realtime.ts`, `test/realtime.test.ts`.
- Modify: `src/server/activity.ts`, `src/server/groups.ts`, `src/server/members.ts`, `src/server/comments.ts`.

**Interfaces:**
- Produces in `src/lib/realtime.ts` (pure; client components import it):
  ```ts
  export type RealtimeKind = ActivityKind | "group.updated" | "member.updated" | "comment.deleted";
  /** What travels through NOTIFY, between instances. */
  export type WireEvent =
    | { type: "group"; groupId: string; kind: RealtimeKind; entityId: string; actorUserId: string | null; joinedUserId?: string; leftUserId?: string }
    | { type: "inbox"; userIds: string[] };
  /** What a tab receives. `mine`: the person in this tab made the change. */
  export type ClientEvent =
    | { type: "group"; groupId: string; kind: RealtimeKind; entityId: string; mine: boolean }
    | { type: "inbox" }
    | { type: "resync" };
  export class Hub {
    subscribe(userId: string, groupIds: Iterable<string>, send: (e: ClientEvent) => void): () => void;  // returns unsubscribe
    dispatch(e: WireEvent): void;
    resync(): void;
    get size(): number;
  }
  export const sseFrame = (e: ClientEvent): string => `data: ${JSON.stringify(e)}\n\n`;
  export function shouldRefresh(pathname: string, e: ClientEvent): boolean;
  ```
- Produces in `src/server/realtime.ts`:
  ```ts
  export const CHANNEL = "hisaab_events";
  export async function publish(client: Pick<Prisma.TransactionClient, "$executeRaw">, event: WireEvent): Promise<void>;
  export async function subscribe(userId: string, groupIds: string[], send: (e: ClientEvent) => void): Promise<() => void>;
  export async function stopListening(): Promise<void>;   // for tests
  ```

Rules:
- **Hub dispatch of a group event:**
  1. With `joinedUserId`: add `groupId` to every subscriber of that user.
  2. Send `{ type: "group", groupId, kind, entityId, mine: actorUserId === subscriber.userId }` to every subscriber
     whose set holds `groupId`.
  3. With `leftUserId`: remove `groupId` from that user's subscribers. The leaving event itself still reaches them.
- **Hub, other events:**
  - `inbox` sends `{ type: "inbox" }` to every subscriber whose `userId` is listed.
  - `resync()` sends `{ type: "resync" }` to all.
  - A `send` that throws drops that subscriber.
- **`shouldRefresh`:**
  - `inbox` and `resync` → true.
  - `group` → true when `pathname` is `/groups/${groupId}`, starts with `/groups/${groupId}/`, or is one of
    `/dashboard`, `/groups`, `/activity` or `/notifications`.
  - Otherwise false.
- **`publish`:** runs ``client.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(event)})` ``. An `inbox`
  event with more than 100 `userIds` is split into several NOTIFYs, because Postgres caps a payload at 8,000 bytes.
- **Listener:**
  - One `pg.Client` per process, kept on `globalThis` so dev reloads reuse it, with
    `{ connectionString: env.DATABASE_URL, application_name: "hisaab-listen", keepAlive: true }`. It then runs
    `LISTEN hisaab_events`.
  - It starts on the first `subscribe`, never on `publish`. `subscribe` awaits the connection and throws if it
    can't connect.
  - Payloads that aren't valid JSON are ignored.
  - On `error` or `end`, drop the client and reconnect after 1s, 2s, 5s, 10s, then every 30s. After a reconnect, call
    `hub.resync()`, since events may have been missed.
- **Wiring** (publish in the write's transaction where there is one; otherwise right after the write succeeds):

  | Where | Event |
  |---|---|
  | `recordActivity`, every kind | `{ type: "group", groupId, kind, entityId, actorUserId }`. Also `joinedUserId` for `member.joined`, and `leftUserId` for `member.left` and `member.removed`: the entity member's `userId`, when it has one. |
  | `createGroup` | `group.updated`, `entityId` = groupId, `joinedUserId` = the creator, so their open tab follows the new group without reconnecting |
  | `updateGroup`, `archiveGroup`, `unarchiveGroup` | `group.updated`, `entityId` = groupId |
  | `setMemberRole` (when the count is 1), `transferOwnership` (in its transaction) | `member.updated`, `entityId` = the target member |
  | `deleteComment` (in its transaction) | `comment.deleted`, `entityId` = the comment |

  `recordActivity` finds the actor's and the entity's `userId` with one `tx.groupMember.findMany` over
  `[actorMemberId, entityId]`. For non-member kinds, the entity id simply matches no row.

- [ ] **Step 1: Write the failing tests**

`src/lib/realtime.test.ts`:
```ts
const ev = (over: Partial<Extract<WireEvent, { type: "group" }>> = {}) =>
  ({ type: "group", groupId: "g1", kind: "expense.created", entityId: "e1", actorUserId: "asha", ...over }) as WireEvent;

it("sends a group's events only to its subscribers, marking the actor's own", () => {
  const hub = new Hub(); const got: Record<string, ClientEvent[]> = { asha: [], ravi: [], mira: [] };
  for (const [u, groups] of [["asha", ["g1"]], ["ravi", ["g1"]], ["mira", ["g2"]]] as const) hub.subscribe(u, groups, (e) => got[u].push(e));
  hub.dispatch(ev());
  expect(got.asha).toEqual([{ type: "group", groupId: "g1", kind: "expense.created", entityId: "e1", mine: true }]);
  expect(got.ravi[0]).toMatchObject({ mine: false });
  expect(got.mira).toEqual([]);
});
it("reaches every tab of the people in an inbox event", () => { /* ravi has two subscriptions, asha one; inbox [ravi] → both ravi tabs get { type: "inbox" }, asha nothing */ });
it("follows someone joining and leaving", () => {
  // ravi subscribed with no groups. dispatch(ev({ kind: "member.joined", joinedUserId: "ravi" })) → ravi gets it;
  // a following expense event → ravi gets it; dispatch(ev({ kind: "member.left", leftUserId: "ravi" })) → ravi gets it;
  // the next expense event → ravi gets nothing more
});
it("drops a subscriber whose send throws, and counts the rest", () => { /* size 2 → a throwing send → after dispatch size 1 */ });
it("unsubscribes", () => {});
it.each([
  ["/groups/g1", true], ["/groups/g1/expenses/e1", true], ["/groups/g10", false], ["/dashboard", true],
  ["/groups", true], ["/activity", true], ["/notifications", true], ["/account", false],
])("refreshes %s for a g1 event: %s", (path, out) =>
  expect(shouldRefresh(path, { type: "group", groupId: "g1", kind: "expense.created", entityId: "e1", mine: false })).toBe(out));
it("always refreshes for inbox and resync", () => {});
```

`test/realtime.test.ts` (against the test DB, with a real listener; `afterAll(stopListening)`). The helper
`nextEvent(list, predicate, ms = 3000)` polls an array until a match arrives, or fails.
```ts
it("delivers a committed expense to the group's subscribers", async () => {
  // subscribe asha and ravi to g; subscribe a stranger to another group
  // createExpense(asha) → asha gets { type: "group", kind: "expense.created", groupId: g.id, entityId: id, mine: true };
  // ravi the same with mine: false; the stranger nothing (wait 500ms)
});
it("sends nothing for a rolled-back write", async () => {
  // db.$transaction(async (tx) => { await publish(tx, groupEvent); throw new Error("rollback") }) rejects; nothing arrives in 500ms
});
it("follows people joining and leaving, through the services", async () => {
  // ravi subscribed with []: joinByInviteCode(ravi) → member.joined; createExpense(asha) → ravi gets it;
  // leaveGroup(ravi) → member.left; the next createExpense → ravi gets nothing
});
it("lets a new group's creator follow it at once", async () => { /* asha subscribed with []: createGroup → then createExpense in it → asha gets expense.created */ });
it("publishes settings, role changes and comment deletions", async () => {
  // updateGroup → group.updated; archiveGroup → group.updated; setMemberRole → member.updated (entityId = ravi's member id);
  // deleteComment → comment.deleted (entityId = comment id)
});
it("tells everyone to refetch after the listener reconnects", async () => {
  // subscribe; db.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'hisaab-listen'`
  // → { type: "resync" } within 5s; then a new createExpense is still delivered
});
```

- [ ] **Step 2: Run** `pnpm test src/lib/realtime.test.ts test/realtime.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** both modules and the wiring.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat(realtime): NOTIFY on commit, one LISTEN per instance, in-process hub"` (include files).

---

### Task 3: SSE stream and live pages

**Files:**
- Create: `src/app/api/events/route.ts`, `src/components/live-updates.tsx`, `e2e/realtime.spec.ts`.
- Modify: `src/app/(app)/layout.tsx`, `src/app/globals.css`, `src/components/expense-list.tsx`,
  `src/components/activity-feed.tsx`, `src/components/balance-panel.tsx`, `src/components/comment-thread.tsx`,
  `src/components/expense-sheet.tsx`, `src/components/settlement-sheet.tsx`.

**Interfaces:**
- Consumes: `subscribe`, `sseFrame`, `shouldRefresh`, `ClientEvent` (Task 2).
- Produces `GET /api/events`:
  - With no session (`auth.api.getSession({ headers: request.headers })`) → `401`. If the listener can't start → `503`.
  - Otherwise a `text/event-stream` response with headers `Cache-Control: no-cache, no-transform` (`no-transform`
    keeps Next's compression from buffering the stream), `Connection: keep-alive` and `X-Accel-Buffering: no`.
  - Subscribes to the person's active memberships (`leftAt: null`; archived groups included).
  - The first bytes are `retry: 3000\n\n`, then a `: ping\n\n` comment every 25s.
  - The stream closes itself after `MAX_STREAM_MS = 50 * 60_000`. On `request.signal` abort or stream `cancel()` it
    unsubscribes and clears its timers. Cleanup is idempotent.
- Produces in `live-updates.tsx` (client):
  ```ts
  export function LiveUpdates({ children }: { children: React.ReactNode }): React.ReactNode;  // wraps the (app) layout
  export function useFresh(id: string): number | null;          // a timestamp while `id` was just changed by someone else
  export function Fresh({ id, className, children }: { id: string; className?: string; children: React.ReactNode }): React.ReactNode;
  export function useHoldLiveRefresh(active: boolean): void;    // defers live refreshes while `active` (an open form)
  ```

Behaviour:
- **Connection lifecycle:**
  - An `EventSource("/api/events")` is open only while `document.visibilityState === "visible"`. On `hidden` it
    closes; on `visible` it reopens and calls `router.refresh()` once.
  - After an error, the `open` that follows calls `router.refresh()` once (events may have been missed).
  - `document.documentElement.dataset.live` is `"open"` or `"closed"`. The e2e tests read it.
- **On each event:**
  - When `shouldRefresh(pathname, e)` is true, call `router.refresh()` inside `startTransition`, debounced to 200ms.
  - While any `useHoldLiveRefresh(true)` is active, the refresh is held, and runs once when the last hold ends.
  - A `group` event with `mine: false` marks `entityId` fresh for 2.5s.
- **Highlights:**
  - `Fresh` renders `<div data-fresh>` while its id is fresh, keyed by the stamp so the animation restarts.
  - In `globals.css`, `[data-fresh]` plays a 2s `live-flash` background fade from `primary` at 14% to transparent.
    Under `prefers-reduced-motion: reduce` it shows that tint statically instead of animating.
  - Wrapped in `Fresh`:
    - expense rows, keyed by the expense id
    - activity rows, keyed by `entityId`
    - "Recent payments" rows, keyed by the settlement id
    - comments, keyed by the comment id
- **Holds:** `ExpenseSheet` and `SettlementSheet` call `useHoldLiveRefresh(open)`. The edit form is keyed by
  `version`, so a refresh landing mid-edit would otherwise reset it.

- [ ] **Step 1: Write the failing e2e** `e2e/realtime.spec.ts`

```ts
test("an expense added in one tab shows up in the other without a reload", async ({ browser }) => {
  const asha = await signedInPage(browser, "asha.live@example.test", "Asha");
  const groupUrl = await createGroupViaUi(asha, "Goa Trip");
  const ravi = await inviteAndJoin(asha, browser, "ravi.live@example.test", "Ravi");
  await ravi.goto(groupUrl);
  await expect(ravi.locator("html")).toHaveAttribute("data-live", "open");
  await addExpenseViaUi(asha, { amount: "1200", description: "Dinner at Thalassa" });
  await expect(ravi.getByRole("link", { name: /Dinner at Thalassa/ })).toBeVisible({ timeout: 3000 });
  await expect(ravi.locator("[data-fresh]").first()).toBeVisible();
});
test("a hidden tab drops the stream and catches up when it's back", async ({ browser }) => {
  // ravi on the group page; fake hidden: Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
  // + dispatch "visibilitychange" → data-live "closed"; asha adds "Cab"; fake visible → data-live "open" and "Cab" visible within 3s
});
test("a live update doesn't wipe an edit in progress", async ({ browser }) => {
  // Ravi adds "Lunch" (so he, the creator, and Asha, the owner, may both edit it). Asha opens it → "Edit" → description "Lunch at Leela" (unsaved).
  // Ravi edits the amount and saves. Asha's description field still reads "Lunch at Leela";
  // Asha saves → toast "Ravi edited this just now — reload?"
});
```

- [ ] **Step 2: Run** `pnpm test:e2e e2e/realtime.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the route, the provider, the `Fresh` wrappers and the holds.

- [ ] **Step 4: Run** the same command, plus `pnpm test`. Expected: PASS. Check the highlight at 375px, in light and
  dark.

- [ ] **Step 5: Commit**: `git commit -m "feat(realtime): one SSE stream per tab, live refresh with highlight, held while editing"` (include files).

---

### Task 4: Creating notifications (who is told, and what they read)

**Files:**
- Create: `src/lib/notifications.ts`, `src/lib/notifications.test.ts`, `src/server/notifications.ts`,
  `test/notifications.test.ts`.
- Modify: `src/server/activity.ts`, `src/server/expenses.ts`, `src/server/settlements.ts`, `src/server/members.ts`.

**Interfaces:**
- Produces in `src/lib/notifications.ts` (pure):
  ```ts
  /** In the settings table's order. A tuple, so `z.enum(NOTIFICATION_KINDS)` works. */
  export const NOTIFICATION_KINDS = ["group.added", "expense.added", "expense.changed", "settlement.recorded", "settlement.disputed", "nudge", "comment.mention"] as const;
  export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
  export type NotificationPayload = { groupName: string; text: string; detail?: string; href: string; disputeHref?: string };
  export type Notice = { kind: NotificationKind; payload: NotificationPayload };
  /** What the activity tells `viewerMemberId` (the recipient), or null for kinds that notify no one. */
  export function noticeFor(a: ActivityView & { groupId: string; groupName: string; entityId: string }): Notice | null;
  export function addedNotice(i: { actorName: string; groupName: string; claimToken: string }): Notice;
  export function nudgeNotice(i: { actorName: string; amount: bigint; currency: string; groupName: string; groupId: string }): Notice;
  ```
- Produces in `src/server/notifications.ts`:
  ```ts
  export type NewNotification = Notice & { userId: string; groupId: string | null; actorUserId: string | null };
  /** Inserts the rows and publishes one inbox event for their recipients. Task 5 adds delivery. */
  export async function createNotifications(tx: Prisma.TransactionClient, rows: NewNotification[]): Promise<void>;
  ```
- Changes `recordActivity`'s input to add `notify?: string[]` (the member ids the activity concerns).

Text rules for `noticeFor`:
- Names come from `names[id] ?? "Someone"`; amounts from `formatMoney(…, currency)`.
- `money(net)` is ` — you owe ₹X` when the recipient's net is below zero, ` — you get back ₹X` above zero, and empty
  at zero.

| Activity | Kind | `text` | `href` |
|---|---|---|---|
| `expense.created` | `expense.added` | `${actor} added “${description}”${money(net)}` | `/groups/${groupId}/expenses/${entityId}` |
| `expense.updated` | `expense.changed` | `${actor} edited “${description}”${money(net)}` | same |
| `expense.deleted` | `expense.changed` | `${actor} deleted “${description}”` | `/groups/${groupId}` |
| `settlement.created`, recipient is the payee | `settlement.recorded` | `${from} paid you ${amount}`; also `disputeHref` = `${href}?dispute=1` | `/groups/${groupId}/settlements/${entityId}` |
| `settlement.created`, recipient is the payer | `settlement.recorded` | `${to} recorded your payment of ${amount}` | same |
| `settlement.disputed` | `settlement.disputed` | `${to} didn't receive ${amount} from you` | same |
| `comment.created` | `comment.mention` | `${actor} mentioned you on “${targetLabel}”`; `detail` = the excerpt | `/groups/${groupId}/${targetKind}s/${targetId}` |
| anything else | — | `null` | |

- `addedNotice` → `group.added`: `${actorName} added you to ${groupName}`, with `href` `/claim/${claimToken}`.
- `nudgeNotice` → `nudge`: `${actorName} reminded you about ${formatMoney(amount, currency)} in ${groupName}`, with
  `href` `/groups/${groupId}/settle`.
- `groupName` is always set.

`recordActivity` with `notify`:
1. Recipients are the `notify` members who are active and have an account, deduplicated by user. The actor's own
   account is never among them.
2. One `tx.groupMember.findMany` over `[actorMemberId, entityId, ...notify]` gives user ids and `names`. The group's
   name and currency come from the `group.update` it already does (add a `select`).
3. Each recipient gets `noticeFor({ …activity, viewerMemberId: recipient.id, … })`. The non-null results go to one
   `createNotifications` call, with `actorUserId` = the actor's user.

Who services notify:

| Service | `notify` |
|---|---|
| `createExpense` | payers ∪ shares |
| `updateExpense` | the old payers and shares (`alreadyOn`) ∪ the new ones |
| `deleteExpense` | the payers and shares |
| `restoreExpense` | none |
| `recordSettlement` | `[from, to]` |
| `disputeSettlement` | `[from]` |
| `updateSettlement`, `deleteSettlement`, `restoreSettlement` | none |
| `addComment` | mentions, added in Task 11 |

`addPlaceholder` with an email: inside its transaction, look for an account with that email,
``tx.$queryRaw`SELECT id FROM "user" WHERE lower(email) = ${email} LIMIT 1` ``. If one exists, create a
`group.added` notification for it with `addedNotice({ actorName: actor.displayName, groupName: group.name, claimToken })`
and `actorUserId` = the caller.

- [ ] **Step 1: Write the failing tests**

`src/lib/notifications.test.ts`:
```ts
const names = { p: "Priya", a: "Asha", r: "Ravi" };
const base = { actorMemberId: "p", currency: "INR", names, groupId: "g", groupName: "Goa Trip", entityId: "e" };
const added = (viewer: string, net: Record<string, string>) => noticeFor({ ...base, kind: "expense.created", viewerMemberId: viewer,
  payload: { description: "Dinner at Thalassa", amount: "222000", currency: "INR", net } });
it("tells a person in the expense what they owe", () =>
  expect(added("a", { p: "148000", a: "-74000", r: "-74000" })).toEqual({ kind: "expense.added",
    payload: { groupName: "Goa Trip", text: "Priya added “Dinner at Thalassa” — you owe ₹740", href: "/groups/g/expenses/e" } }));
it("says nothing about money when they're even", () => expect(added("r", { p: "1000", a: "-1000" })?.payload.text).toBe("Priya added “Dinner at Thalassa”"));
it("describes edits and deletions", () => { /* updated with net a:+50000 → "Priya edited “…” — you get back ₹500"; deleted → "Priya deleted “…”", href "/groups/g" */ });
it("tells each side of a payment", () => {
  // created from r to a, actor r, viewer a → "Ravi paid you ₹850", disputeHref "/groups/g/settlements/e?dispute=1"
  // created from r to a, actor a, viewer r → "Asha recorded your payment of ₹850", no disputeHref
  // disputed, actor a, viewer r → "Asha didn't receive ₹850 from you"
});
it("tells a mentioned person, with the comment's start", () => { /* → "Priya mentioned you on “Dinner at Thalassa”", detail "@Asha can you check?" */ });
it("notifies nothing for member and restore rows", () => { /* member.joined, expense.restored, settlement.deleted → null */ });
it("words invites and nudges", () => {
  expect(addedNotice({ actorName: "Asha", groupName: "Goa Trip", claimToken: "tok" }).payload).toMatchObject({ text: "Asha added you to Goa Trip", href: "/claim/tok" });
  expect(nudgeNotice({ actorName: "Amit", amount: 85000n, currency: "INR", groupName: "Goa Trip", groupId: "g" }).payload)
    .toMatchObject({ text: "Amit reminded you about ₹850 in Goa Trip", href: "/groups/g/settle" });
});
```

`test/notifications.test.ts`. The cast: Asha is the owner, Ravi a member, Rahul a placeholder, and Dev a member who
will leave.
```ts
it("tells everyone in a new expense but the person who added it", async () => {
  // asha adds ₹1,200 split equally among asha, ravi, rahul → exactly one row, for ravi:
  // kind "expense.added", text "Asha added “Dinner” — you owe ₹400", groupId g.id, actorUserId asha.id; none for asha
});
it("tells someone taken out of an expense", async () => { /* split asha+ravi → edit to asha only → ravi gets "Asha edited “Dinner”" */ });
it("tells people about a deletion but not a restore", async () => {});
it("tells the payee who paid them, and the payer about a dispute", async () => {
  // ravi records ravi→asha ₹400 → asha "Ravi paid you ₹400" with disputeHref; asha disputes → ravi "Asha didn't receive ₹400 from you"
  // asha records ravi→asha → ravi "Asha recorded your payment of ₹400"
});
it("never tells someone who has left", async () => { /* dev on an expense via createExpenseRow; set dev's leftAt; asha edits it → no row for dev */ });
it("writes nothing when the change is refused", async () => { /* a stale updateExpense (ConflictError) → notification count unchanged */ });
it("tells someone already on Hisaab that they were added", async () => {
  // meera = createUser({ email: "Meera@Example.test" }); asha addPlaceholder("Meera", "meera@example.test")
  // → meera's row: kind "group.added", text "Asha added you to Goa Trip", href "/claim/<the placeholder's claimToken>"
  // an email nobody has → no notification row
});
it("pings the inbox of the people told", async () => { /* subscribe(ravi.id, [g.id]) → after createExpense: { type: "inbox" } arrives */ });
```

- [ ] **Step 2: Run** `pnpm test src/lib/notifications.test.ts test/notifications.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the lib, `createNotifications`, the `notify` handling in `recordActivity`, the service
  lists and `addPlaceholder`.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat(notify): create per-person notifications from activity, invites by email"` (include files).

---

### Task 5: Delivery (push, email, preferences, push subscriptions)

**Files:**
- Create: `src/lib/notification-prefs.ts` (+ `.test.ts`), `src/lib/push.ts` (+ `.test.ts`),
  `src/emails/notification.ts` (+ `.test.ts`), `src/server/push.ts`, `src/server/actions/notifications.ts`,
  `src/server/actions/push.ts`, `test/delivery.test.ts`, `test/push.test.ts`.
- Modify: `src/lib/email.ts`, `test/email.test.ts`, `src/server/notifications.ts`, `src/server/session.ts`,
  `test/outbox.ts`, `e2e/helpers.ts`, `test/authz-actions.test.ts`.

**Interfaces:**
- Produces in `notification-prefs.ts` (pure):
  ```ts
  export type Channel = "push" | "email";
  export type NotificationPrefs = Record<NotificationKind, Record<Channel, boolean>>;
  export const DEFAULT_PREFS: NotificationPrefs;   // push: all true. email: true only for settlement.disputed, nudge, comment.mention
  export const NO_EMAIL: ReadonlySet<NotificationKind>;   // { "group.added" }: the invite email is that email
  export const PREF_LABELS: Record<NotificationKind, string>;
  export function readPrefs(stored: unknown): NotificationPrefs;   // stored overrides on top of DEFAULT_PREFS; malformed entries ignored
  export function withPref(stored: unknown, kind: NotificationKind, channel: Channel, enabled: boolean): Record<string, Partial<Record<Channel, boolean>>>;
  ```
  - The stored shape is `{ [kind]: { push?: boolean; email?: boolean } }`, overrides only.
  - `readPrefs` always returns `email: false` for `NO_EMAIL` kinds.
  - `PREF_LABELS`, in `NOTIFICATION_KINDS` order:
    - "Someone adds you to a group"
    - "A new expense includes you"
    - "An expense you're in is edited or deleted"
    - "A payment to or from you is recorded"
    - "Someone says your payment didn't arrive"
    - "Someone reminds you to settle up"
    - "Someone mentions you in a comment"
- Produces in `push.ts`:
  ```ts
  export const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"] as const;
  /** https, default port, no credentials, and a host equal to or under one of PUSH_HOSTS: the server POSTs here, so nothing else is allowed. */
  export function isPushEndpoint(url: string): boolean;
  export function pushConfig(): { publicKey: string; privateKey: string; subject: string } | null;   // null without both keys; subject = "mailto:" + the address in EMAIL_FROM
  export type PushMessage = { title: string; body: string; url: string; actions?: { action: "dispute"; title: string }[] };
  export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, message: PushMessage): Promise<"sent" | "gone">;
  ```
  `sendPush` calls `webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(message), { TTL: 86_400, urgency: "high", timeout: 5_000, vapidDetails })`.
  A `WebPushError` with status 404 or 410 → `"gone"`. Any other error is rethrown.
- Produces in `src/emails/notification.ts`:
  `notificationEmail({ groupName, text, detail, url, settingsUrl }: { groupName: string; text: string; detail?: string; url: string; settingsUrl: string }): { subject: string; html: string; text: string }`.
  - `subject` = `text`.
  - The HTML uses the same shell as `invite.ts`: the group name as a small line, `text` as the heading, then `detail`,
    a button "Open in Hisaab", and a footer: "You get these emails because of your Hisaab notification settings."
    followed by the link "Change what Hisaab emails you".
  - Every value is escaped with `escapeHtml`.
- Changes in `email.ts`:
  - `EmailKind` gains `"notification" | "nudge"`.
  - New caps, checked after the existing 450-a-day global one, and only for these two kinds:
    - `NOTIFICATION_EMAILS_PER_DAY = 250` across all recipients → `"global"`
    - `NOTIFICATION_EMAILS_PER_RECIPIENT_PER_HOUR = 6` → `"recipient"`
    - `NUDGES_PER_SENDER_PER_HOUR = 10` (kind `nudge`, by `senderUserId`) → `"sender"`
- Produces in `src/server/notifications.ts`:
  ```ts
  export async function deliverNotifications(ids: string[]): Promise<void>;
  export function scheduleDelivery(ids: string[]): void;   // createNotifications now calls it with the new ids
  export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs>;
  export async function setNotificationPref(userId: string, kind: NotificationKind, channel: Channel, enabled: boolean): Promise<void>;
  ```
- Produces in `src/server/push.ts`:
  ```ts
  export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };
  export async function savePushSubscription(userId: string, sessionId: string, sub: PushSubscriptionInput): Promise<void>;   // upsert on endpoint
  export async function deletePushSubscription(userId: string, endpoint: string): Promise<void>;   // only the caller's own
  ```
- Produces in `session.ts`: `currentSessionId(): Promise<string | null>` (the session row's id, from
  `auth.api.getSession`).
- Produces actions:
  - In `actions/notifications.ts`: `updateNotificationPrefAction({ kind: z.enum(NOTIFICATION_KINDS), channel: z.enum(["push", "email"]), enabled: z.boolean() })`.
  - In `actions/push.ts`, with a module-private schema:
    - `savePushSubscriptionAction({ endpoint: z.string().max(1000).refine(isPushEndpoint, "That isn't a push service Hisaab can use."), keys: { p256dh: /^[A-Za-z0-9_-]{40,200}={0,2}$/, auth: /^[A-Za-z0-9_-]{16,100}={0,2}$/ } })`.
      With no session id → `UserError("Sign in again to turn on notifications.")`.
    - `deletePushSubscriptionAction({ endpoint: z.string().max(1000) })`
- `test/outbox.ts`: `lastEmailTo(email, kind?: EmailKind)` filters by kind when given. `signInWithMagicLink` in
  `e2e/helpers.ts` passes `"magic_link"`, so a notification email landing at the same moment can't be read as the
  sign-in link.

Delivery rules:
1. **Claim:** `db.notification.updateManyAndReturn({ where: { id: { in: ids }, deliveredAt: null }, data: { deliveredAt: new Date() } })`.
   Only claimed rows are sent, so a repeat or concurrent call sends nothing.
2. **Load** each recipient's `email`, `notificationPrefs`, and push subscriptions whose session hasn't expired
   (`session: { expiresAt: { gt: now } }`).
3. **Push**, when `pushConfig()` is set and the recipient wants push for the kind: `sendPush` to each subscription,
   with:
   - `title` = `groupName`
   - `body` = `text`, plus `"\n" + detail` when there is one
   - `url` = `/notifications/${id}`
   - `actions` = `[{ action: "dispute", title: "I didn't receive this" }]` when `disputeHref` is set

   A `"gone"` result deletes that subscription.
4. **Email**, when the recipient wants email for the kind: `sendEmail` with kind `"nudge"` (and `senderUserId` =
   `actorUserId`) for nudges, otherwise `"notification"`, plus `notificationEmail` with absolute URLs
   (`new URL(…, env.BETTER_AUTH_URL)`): `url` = `/notifications/${id}`, `settingsUrl` = `/account#notifications`.
   An `EmailRateLimitError` is skipped silently.
5. **Failures:** every send is in a `Promise.allSettled`. Failures are logged with `console.error` and never thrown,
   so one bad device or SMTP error can't stop the rest.
6. **Scheduling:** `scheduleDelivery(ids)` calls `after(() => deliverNotifications(ids))`. When `after` throws (no
   request scope: tests, scripts), it does nothing. A rolled-back transaction leaves no rows, so its callback claims
   nothing.

Other rules:
- `savePushSubscription` upserts on `endpoint`, setting `userId`, `sessionId` and the keys. A device that changes
  hands moves to whoever turned it on last.
- `setNotificationPref` with a `NO_EMAIL` kind and `email` → `UserError("Invites always arrive by email.")`.

- [ ] **Step 1: Write the failing tests**

`src/lib/notification-prefs.test.ts`:
- The defaults match the rules.
- An override flips exactly one switch.
- `null`, `"x"`, `{ nudge: { push: "yes" } }` and an unknown kind all give the defaults.
- A stored `{ "group.added": { email: true } }` still reads `false`.
- `readPrefs(withPref({}, "nudge", "email", false)).nudge.email === false`.

`src/lib/push.test.ts`:
```ts
it.each([
  "https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x",
  "https://web.push.apple.com/Qx", "https://wns2-par02p.notify.windows.com/w/?token=x",
])("accepts %s", (url) => expect(isPushEndpoint(url)).toBe(true));
it.each([
  "http://fcm.googleapis.com/fcm/send/abc", "https://fcm.googleapis.com.evil.test/x", "https://evil.test/fcm.googleapis.com",
  "https://169.254.169.254/latest", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "not a url",
])("refuses %s", (url) => expect(isPushEndpoint(url)).toBe(false));
```

`src/emails/notification.test.ts`:
- The subject is the raw text.
- `<b>&` in the text, the detail and the group name come out escaped in the HTML, and plain in the text version.
- The button and the settings link carry the URLs.

`test/email.test.ts` (append):
```ts
it("stops notification emails at 250 a day, leaving room for sign-in links", async () => {
  // 250 EmailLog rows of kind "notification" in the last day → sendEmail({ kind: "notification" }) rejects "global"; a magic_link still sends
});
it("sends one person at most 6 notification emails an hour", async () => { /* 7th to the same address → "recipient"; another address works */ });
it("lets one person send at most 10 nudge emails an hour", async () => { /* 11th with the same senderUserId → "sender" */ });
```

`test/delivery.test.ts`
(`vi.mock("web-push", () => ({ default: { sendNotification: vi.fn() }, WebPushError: class extends Error { constructor(m: string, public statusCode: number) { super(m); } } }))`):
```ts
it("pushes to each of the person's devices and emails when they want it", async () => {
  // ravi with two sessions, each with a subscription; a "nudge" notification (createNotificationRow) → deliverNotifications([id])
  // → sendNotification called twice, payload JSON { title: "Goa Trip", body: text, url: `/notifications/${id}` };
  // one email to ravi, kind "nudge", subject = text
});
it("follows the person's preferences", async () => { /* setNotificationPref(ravi, "nudge", "push", false) → no push, email still */ });
it("skips devices whose session expired, and forgets gone ones", async () => {
  // a subscription on an expired session isn't called; a sendNotification rejecting with statusCode 410 → that row deleted
});
it("sends each notification once", async () => { /* Promise.all([deliver(ids), deliver(ids)]) then deliver(ids) → one push per device */ });
it("adds the dispute button to a payee's push", async () => { /* payload with disputeHref → actions [{ action: "dispute", title: "I didn't receive this" }] */ });
it("keeps going when a device or the mail server fails", async () => {
  // first device rejects with statusCode 500 → second still called; deliverNotifications resolves
});
it("emails nothing for the kinds people haven't asked for", async () => { /* "expense.added" by default → push yes, email no */ });
```

`test/push.test.ts`:
```ts
it("saves this device's subscription against this session", async () => {});
it("moves an endpoint to whoever turns it on next", async () => { /* same endpoint saved for mira after ravi → one row, userId mira */ });
it("forgets a device when its session signs out", async () => { /* db.session.delete → the subscription row is gone (cascade) */ });
it("refuses endpoints that aren't push services", async () => {
  // savePushSubscriptionAction({ endpoint: "https://169.254.169.254/x", keys }) → { ok: false, error: "That isn't a push service Hisaab can use." }; nothing saved
});
it("deletes only your own", async () => {});
```

`test/authz-actions.test.ts`:
- Add `notifications.ts` and `push.ts`.
- The `@/server/session` mock also provides `currentSessionId: async () => session.sessionId`, where `session.sessionId`
  is the attacker's own session row (from `createSessionRow` in `beforeEach`).
- `updateNotificationPrefAction`, `savePushSubscriptionAction` and `deletePushSubscriptionAction` → `OWN`.
- `snapshot()` adds the target group's `notification` rows.

- [ ] **Step 2: Run** `pnpm test`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** everything listed under Interfaces.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat(notify): push and email delivery after the response, preferences, push subscriptions"` (include files).

---

### Task 6: Notification centre (bell, list, open, dispute from a notification)

**Files:**
- Create: `src/app/(app)/notifications/page.tsx`, `src/app/(app)/notifications/[notificationId]/route.ts`,
  `src/components/notification-bell.tsx`, `src/components/notification-list.tsx`,
  `src/components/app-shell/mobile-header.tsx`, `e2e/notifications.spec.ts`.
- Modify: `src/server/notifications.ts`, `src/server/actions/notifications.ts`, `src/app/(app)/layout.tsx`,
  `src/components/app-shell/sidebar.tsx`, `src/proxy.ts`, `src/components/settlement-actions.tsx`,
  `src/app/(app)/groups/[groupId]/settlements/[settlementId]/page.tsx`, `test/notifications.test.ts`,
  `test/authz-actions.test.ts`.

**Interfaces:**
- Produces in `src/server/notifications.ts`:
  ```ts
  export type NotificationItem = { id: string; kind: NotificationKind; groupName: string; text: string; detail: string | null;
    createdAt: Date; read: boolean; hasDispute: boolean };
  export async function listNotifications(userId: string, limit = 50): Promise<{ items: NotificationItem[]; hasMore: boolean }>;   // newest first, id tie-break, limit clamped 1–500
  export async function countUnread(userId: string): Promise<number>;
  /** Marks it read and returns where to go: `disputeHref` for "dispute" when it has one, else `href`. Null for an id that isn't the caller's. */
  export async function openNotification(userId: string, id: string, action: "dispute" | null): Promise<string | null>;
  export async function markAllRead(userId: string): Promise<void>;
  ```
  `openNotification` and `markAllRead` publish `{ type: "inbox", userIds: [userId] }` when they changed anything,
  so the person's other tabs update their bell. Returned hrefs pass through `safeCallback(href, "/notifications")`.
  Add a `ponytail:` comment on `listNotifications`: rows are kept forever; prune old read ones if the table grows.
- Produces `markAllReadAction(z.object({}))`.
- Produces `GET /notifications/[notificationId]` (route handler):
  - Signed in → `openNotification(user, id, searchParams.action === "dispute" ? "dispute" : null)`, then a `303`
    redirect to its result, or to `/notifications` when it returns null.
  - No session → a redirect to `/sign-in?callbackURL=<this path>`.
- `NotificationBell({ unread }: { unread: number })`: a link to `/notifications` (`size-11`) with a bell icon.
  - Its `aria-label` is "Notifications", or "Notifications, 3 unread".
  - A badge (`aria-hidden`) shows the count, or "9+" above 9.
  - `aria-current="page"` on `/notifications`.
- `MobileHeader({ unread })`: phones only, sticky, full width, padded for `env(safe-area-inset-top)`. The wordmark
  "Hisaab." on the left links to `/dashboard`, and the bell is on the right.
- The sidebar puts the bell beside the wordmark. The `(app)` layout reads `countUnread(user.id)` and passes it to
  both.
- `src/proxy.ts`: the matcher gains `"/notifications/:path*"`, so email links send signed-out people to sign-in and
  back.
- `SettlementActions` gains `openDispute: boolean`, and its "Mark as not received?" dialog starts open when it and
  `canDispute` are true. The payment page passes `openDispute` from the `dispute=1` search param.

Behaviour and copy:
- **`/notifications` page:**
  - h1 "Notifications". "Mark all as read" appears when anything is unread; it is disabled while pending.
  - A "Settings" link goes to `/account#notifications`.
  - Rows are plain `<a href="/notifications/<id>">`, never prefetched, because opening one marks it read.
- **Each row:**
  - An icon by kind: `UserPlus` group.added, `Receipt` expense.*, `Wallet` settlement.recorded, `TriangleAlert`
    settlement.disputed, `BellRing` nudge, `AtSign` comment.mention.
  - The text, `font-semibold` while unread, then the detail (muted, two lines at most), then
    `${groupName} · ${formatAgo(createdAt)}`.
  - An unread dot with sr-only "Unread".
  - When `hasDispute`, a second link "I didn't receive this" → `/notifications/<id>?action=dispute`.
- **Empty state:** a bell, "No notifications yet" and "When someone adds an expense with you, pays you or mentions
  you, it shows up here.".
- "Show more" uses the `?limit=` pattern (`parseLimit`).

- [ ] **Step 1: Write the failing tests**

`test/notifications.test.ts` (append):
```ts
it("lists a person's notifications, newest first, with the unread count", async () => { /* three rows, one read → items order, countUnread 2, hasMore with limit 2 */ });
it("opens one: marks it read and says where to go", async () => {
  // openNotification(ravi, id, null) → href; readAt set; countUnread drops; another user's id → null and unchanged
  // a settlement.recorded row with disputeHref: action "dispute" → disputeHref
});
it("never redirects off the site", async () => { /* a row whose payload.href is "//evil.test" → "/notifications" */ });
it("marks everything read and tells the person's other tabs", async () => { /* subscribe(ravi) → markAllRead → { type: "inbox" }; countUnread 0 */ });
```
`test/authz-actions.test.ts`: `markAllReadAction` → `OWN` (the target group's rows stay unread).

`e2e/notifications.spec.ts`:
```ts
test("the bell counts a new notification live, and opening it marks it read", async ({ browser }) => {
  // asha + ravi (inviteAndJoin) in "Goa Trip"; ravi on /dashboard
  // asha adds "Dinner" ₹1,200 split equally → ravi: link "Notifications, 1 unread" within 3s, no reload
  // ravi clicks it → /notifications shows "Asha added “Dinner” — you owe ₹600" and "Goa Trip"
  // clicks the row → on the expense page; the bell reads "Notifications"
});
test("the payee disputes straight from the notification", async ({ browser }) => {
  // ravi records Ravi→Asha ₹600 (settle page → "Record a payment" → Cash → Save)
  // asha /notifications → "Ravi paid you ₹600" → "I didn't receive this" → the payment page with "Mark as not received?" open → "Not received" → "Disputed"
  // ravi /notifications → "Asha didn't receive ₹600 from you"
});
test("mark all as read", async ({ browser }) => {
  // two unread for ravi → /notifications → "Mark all as read" → the bell reads "Notifications" and the button is gone
});
```

- [ ] **Step 2: Run** `pnpm test test/notifications.test.ts && pnpm test:e2e e2e/notifications.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the reads, the route, the page, the bell, the header and the dispute hook.

- [ ] **Step 4: Run** the same commands. Expected: PASS. Check the header and the list at 320px, 375px and 1280px in
  light and dark. The badge must not cover the icon, and long texts wrap.

- [ ] **Step 5: Commit**: `git commit -m "feat(notify): notification centre with live bell, open-to-read, dispute from a notification"` (include files).

---

### Task 7: Service worker (offline reading, showing pushes, sign-out cleanup)

**Files:**
- Create: `public/sw.js`, `src/components/pwa.tsx`, `src/lib/device.ts`, `src/app/offline/page.tsx`,
  `e2e/pwa.spec.ts`.
- Modify: `next.config.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/account/account-controls.tsx`.

**Interfaces:**
- Consumes: `savePushSubscriptionAction`, `deletePushSubscriptionAction` (Task 5), and the push message shape
  `PushMessage` (Task 5).
- Produces in `pwa.tsx` (client, mounted in the `(app)` layout):
  - `ServiceWorkerSetup()` (renders nothing). Only when `process.env.NODE_ENV === "production"`, it registers
    `navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })`.
    - Then, once per browser session (`sessionStorage["hisaab:push-linked"]`), when `Notification.permission` is
      `"granted"` and a push subscription exists, it re-saves the subscription with `savePushSubscriptionAction`.
      That re-links this session after a sign-out elsewhere or a rotated subscription.
  - `OfflineBanner()`: shown while `navigator.onLine` is false (it follows `online`/`offline` events), with
    `role="status"`. Copy: "You're offline. This is what you last opened; changes need a connection."
- Produces in `device.ts`:
  `forgetThisDevice(): Promise<void>`. It deletes this browser's subscription on the server
  (`deletePushSubscriptionAction`), then `subscription.unsubscribe()`, then every `hisaab-pages-*` cache. It never
  throws. `SignOutButton` awaits it before `authClient.signOut()`.
- Produces `/offline`: a static page (`dynamic = "force-static"`) outside `(app)`, with h1 "You're offline", the
  text "Hisaab needs a connection to open this page. Pages you opened recently still work.", and a "Try again"
  button that reloads.
- `next.config.ts` `headers()`: `/sw.js` gets `Cache-Control: no-cache, no-store, must-revalidate`,
  `Content-Type: application/javascript; charset=utf-8` and `Content-Security-Policy: default-src 'self'; script-src 'self'`.

`public/sw.js` rules (plain JS, no imports; `const VERSION = "1"`; caches `hisaab-static-1` and `hisaab-pages-1`):
- **install:** cache `/offline` into the pages cache, then `skipWaiting()`.
- **activate:** delete every cache not named above, then `clients.claim()`.
- **fetch** handles same-origin `GET` only:
  - **Static assets.** `/_next/static/*` and `/pwa/*` are cache-first, stored on a miss. The static cache is trimmed
    first-in-first-out to 200 entries.
  - **Navigations** (`request.mode === "navigate"`) are network-first, except paths under `/api/`, `/sign-in`,
    `/onboarding`, `/join/` and `/claim/`.
    - Fetch **the request itself** (`fetch(event.request)`), so a redirecting navigation reaches the browser as the
      redirect.
    - Cache only `response.ok && response.type === "basic"` responses, so redirects and opaque responses are never
      cached. The pages cache is trimmed to 50 entries.
    - When the network fails, serve the cached page, or `/offline`.
  - **Everything else isn't intercepted**, including RSC fetches and `/api/events`. When an RSC fetch fails, Next
    falls back to a full navigation, which the navigation rule then serves from the cache.
- **push:** `showNotification(data.title ?? "Hisaab", { body: data.body, icon: "/pwa/icon-192.png", badge: "/pwa/badge-96.png", data: { url: data.url }, actions: data.actions ?? [] })`.
- **notificationclick:** close the notification. The URL is `data.url + "?action=dispute"` for the `dispute`
  action, otherwise `data.url` (default `/notifications`). Focus an open window of the app and `navigate` it to the
  URL, or `clients.openWindow(url)`.

- [ ] **Step 1: Write the failing e2e** `e2e/pwa.spec.ts`

```ts
test("a group you opened stays readable offline", async ({ browser }) => {
  const page = await signedInPage(browser, "asha.offline@example.test", "Asha");
  const groupUrl = await createGroupViaUi(page, "Goa Trip");
  await addExpenseViaUi(page, { amount: "1200", description: "Dinner" });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.goto(groupUrl);                                    // now cached by the worker
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole("link", { name: /Dinner/ })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("You're offline");
  await page.goto(`${groupUrl}/settle`);                        // never opened
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
});
test("signing out forgets this device's saved pages", async ({ browser }) => {
  // visit a group page with the worker in control → caches.keys() includes "hisaab-pages-1"
  // sign out from /account → caches.keys() has no "hisaab-pages-*"
});
```
If Playwright's offline emulation turns out not to reach the service worker, assert the same with
`caches.match(groupUrl)` in the page: the cached response's text contains "Dinner". Note this in the report.

- [ ] **Step 2: Run** `pnpm test:e2e e2e/pwa.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the worker, setup, banner, offline page, headers and sign-out cleanup.

- [ ] **Step 4: Run** the same command and `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat(pwa): service worker for offline reading and pushes; sign-out forgets the device"` (include files).

---

### Task 8: Notification settings and turning on push

**Files:**
- Create: `src/lib/push-client.ts`, `src/lib/push-client.test.ts`, `src/components/notification-settings.tsx`.
- Modify: `src/app/(app)/account/page.tsx`, `e2e/notifications.spec.ts`.

**Interfaces:**
- Consumes: `getNotificationPrefs`, `updateNotificationPrefAction`, `savePushSubscriptionAction`,
  `deletePushSubscriptionAction`, `pushConfig` (for the public key), `PREF_LABELS`, `NO_EMAIL`,
  `NOTIFICATION_KINDS`.
- Produces in `push-client.ts`:
  ```ts
  export function urlBase64ToUint8Array(base64: string): Uint8Array;
  export type PushSupport = "supported" | "needs-install" | "unsupported";
  export function pushSupport(i: { hasServiceWorker: boolean; hasPushManager: boolean; isIos: boolean; standalone: boolean }): PushSupport;
  export function isIos(ua: string, platform: string, maxTouchPoints: number): boolean;   // iPhone/iPad/iPod, or iPadOS's "MacIntel" with touch
  export async function turnOnPush(publicKey: string): Promise<PushSubscriptionJSON | null>;   // null when permission isn't granted
  export async function turnOffPush(): Promise<string | null>;   // unsubscribes this browser; returns the endpoint it had
  ```
  `pushSupport` rules:
  - iOS outside the installed app → `"needs-install"`. iOS only offers push to the Home Screen app.
  - Otherwise `"supported"` when both APIs exist, else `"unsupported"`.
- Produces `NotificationSettings({ publicKey, prefs }: { publicKey: string | null; prefs: NotificationPrefs })`.
  The account page renders it in a card with `id="notifications"`, title "Notifications" and description "What
  Hisaab tells you about, and where.".

Behaviour and copy:
- **Push row**, headed "Push notifications"; hidden when `publicKey` is null. Its states:
  - Unsupported: "This browser can't show notifications from Hisaab."
  - Needs install: "On iPhone and iPad, add Hisaab to your Home Screen first (Share → Add to Home Screen), then turn
    notifications on from there."
  - Permission denied: "Notifications are blocked for Hisaab. Allow them in your browser's site settings, then come
    back."
  - Off: "Get notified on this device when something needs you.", with the button "Turn on".
  - On: "On for this device.", with the button "Turn off".

  While pending the buttons are disabled. The toasts are "Notifications are on for this device", "Notifications are
  off for this device", or "Couldn't turn on notifications. Please try again.".
- **Preferences table:**
  - A `<table>` with caption "What reaches you" and columns "Push" and "Email". There is one row per
    `NOTIFICATION_KINDS` entry, labelled with `PREF_LABELS`.
  - Each cell is a `Switch` with aria-label `${label}: push` or `${label}: email`.
  - The `NO_EMAIL` email cell shows "—", with sr-only "Invites always arrive by email".
  - A switch saves at once, optimistically. On failure it flips back and toasts the error.
  - Below the table: "The bell always lists everything. These choose what also reaches your phone and inbox."

- [ ] **Step 1: Write the failing tests**

`src/lib/push-client.test.ts`:
- `urlBase64ToUint8Array` of a known 65-byte key gives 65 bytes, with the first byte 4.
- The `pushSupport` table: iOS in Safari → `needs-install`; iOS standalone → `supported`; no PushManager →
  `unsupported`.
- `isIos` for an iPhone UA, and for an iPad that reports MacIntel with 5 touch points.

`e2e/notifications.spec.ts` (append):
```ts
test("notification preferences are saved", async ({ browser }) => {
  // /account → switch "Someone reminds you to settle up: email" is on → turn it off → reload → still off
  // "Someone adds you to a group" has no email switch
});
```

- [ ] **Step 2: Run** `pnpm test src/lib/push-client.test.ts && pnpm test:e2e e2e/notifications.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the helpers and the settings card.

- [ ] **Step 4: Run** the same commands. Expected: PASS. Check the card at 320px: the table must not scroll
  sideways (labels wrap).

- [ ] **Step 5: Commit**: `git commit -m "feat(notify): notification settings and turning on push per device"` (include files).

---

### Task 9: Installable app (manifest, icons, splash, install prompt, shortcut)

**Files:**
- Create: `src/app/manifest.ts`, `src/app/manifest.test.ts`, `src/app/apple-icon.tsx`, `src/app/pwa/[asset]/route.tsx`,
  `src/lib/pwa-assets.ts`, `src/lib/install-prompt.ts`, `src/lib/install-prompt.test.ts`,
  `src/components/install-prompt.tsx`.
- Modify: `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/add-expense-fab.tsx`, `e2e/pwa.spec.ts`.

**Interfaces:**
- Produces in `pwa-assets.ts`:
  ```ts
  export const BRAND = "#059669";
  export const SPLASH_SIZES: { width: number; height: number; deviceWidth: number; deviceHeight: number; ratio: number }[];
  export const PWA_ASSETS: string[];   // "icon-192.png", "icon-512.png", "icon-maskable-512.png", "badge-96.png", "shortcut-add-96.png", and `splash-${width}x${height}.png` for each size
  export function splashMedia(s: (typeof SPLASH_SIZES)[number]): string;
  ```
  `SPLASH_SIZES` (portrait):

  | Splash (px) | Device (pt) | Ratio | Phones |
  |---|---|---|---|
  | 750×1334 | 375×667 | 2 | iPhone SE |
  | 1170×2532 | 390×844 | 3 | iPhone 12–14 |
  | 1179×2556 | 393×852 | 3 | iPhone 15/16 |
  | 1206×2622 | 402×874 | 3 | iPhone 16 Pro |
  | 1290×2796 | 430×932 | 3 | Plus / Pro Max |
  | 1320×2868 | 440×956 | 3 | iPhone 16 Pro Max |

  `splashMedia` = `(device-width: ${deviceWidth}px) and (device-height: ${deviceHeight}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`.
  Add a `ponytail:` comment: other devices get iOS's plain background.
- Produces `GET /pwa/[asset]` with `generateStaticParams` over `PWA_ASSETS` and `dynamicParams = false`. It returns
  `next/og` `ImageResponse` PNGs:
  - `icon-*`: a `BRAND` square with a bold white "H" at about 60% height.
  - `icon-maskable-512`: the same, with the "H" inside the central 60% safe zone.
  - `badge-96`: a white "H" on transparent.
  - `shortcut-add-96`: a white "+" on a `BRAND` circle.
  - `splash-*`: a white background, a centred `BRAND` rounded square with the "H" (a quarter of the width), and the
    wordmark "Hisaab" with an emerald "." below it.
- Produces `src/app/apple-icon.tsx`: 180×180, the same art as `icon-*`.
- Produces `manifest.ts`:
  ```ts
  { name: "Hisaab", short_name: "Hisaab", description: "Split expenses with friends. Settle up over UPI.", id: "/",
    start_url: "/dashboard", scope: "/", display: "standalone", orientation: "portrait", background_color: "#ffffff", theme_color: "#ffffff",
    icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
    shortcuts: [{ name: "Add expense", short_name: "Add", url: "/dashboard?add=1", icons: [{ src: "/pwa/shortcut-add-96.png", sizes: "96x96", type: "image/png" }] }] }
  ```
- Root layout `metadata.appleWebApp`: `{ capable: true, title: "Hisaab", statusBarStyle: "default", startupImage: SPLASH_SIZES.map((s) => ({ url: `/pwa/splash-${s.width}x${s.height}.png`, media: splashMedia(s) })) }`.
- Produces in `install-prompt.ts` (pure):
  ```ts
  export function countVisit(visits: number, alreadyCounted: boolean): number;   // +1 once per browser session
  export function shouldOfferInstall(i: { visits: number; dismissedAt: number | null; now: number; standalone: boolean; canPrompt: boolean; ios: boolean }): "prompt" | "ios" | null;
  ```
  `shouldOfferInstall` returns, checking in this order:
  1. `null` when the app is already standalone.
  2. `null` when `visits < 2`.
  3. `null` when it was dismissed within 30 days.
  4. `"prompt"` when `canPrompt` (a stashed `beforeinstallprompt`).
  5. `"ios"` when on iOS.
  6. Otherwise `null`.
- `InstallPrompt()` (client, in the `(app)` layout above the page):
  - **Storage:** visits live in `localStorage["hisaab:visits"]`, dismissal in `localStorage["hisaab:install-dismissed"]`,
    and the once-per-session flag in `sessionStorage["hisaab:visit-counted"]`. All storage access is wrapped in
    `try`, for private mode.
  - **Events:** it captures `beforeinstallprompt` (`preventDefault`, then stash it) and hides on `appinstalled`.
  - **`"prompt"` card:**
    - Title "Install Hisaab", body "Open it from your home screen like an app, and get notified when friends add
      expenses or pay you."
    - Buttons "Install" (runs `prompt()`, then hides) and "Not now" (records the dismissal).
  - **`"ios"` card:** title "Add Hisaab to your Home Screen", body "Tap the Share button, then “Add to Home Screen”.
    On iPhone, that's also how notifications work.", and "Not now".
- **`AddExpenseFab`** on mount, when `location.search` has `add=1`:
  - With exactly one active group → `router.replace("/groups/<id>?add=1")`.
  - With several → open the picker, then `router.replace(pathname)`.
  - With none → only drop the parameter.

- [ ] **Step 1: Write the failing tests**

`src/app/manifest.test.ts`: `manifest()` has `display: "standalone"`, `start_url: "/dashboard"`, icons of 192 and
512 plus one maskable, and `shortcuts[0]` named "Add expense" with url `/dashboard?add=1`.

`src/lib/install-prompt.test.ts`:
```ts
it.each([
  [{ visits: 1, canPrompt: true }, null], [{ visits: 2, canPrompt: true }, "prompt"], [{ visits: 2, ios: true }, "ios"],
  [{ visits: 5, canPrompt: true, standalone: true }, null], [{ visits: 5, canPrompt: true, dismissedAt: NOW - 29 * DAY }, null],
  [{ visits: 5, canPrompt: true, dismissedAt: NOW - 31 * DAY }, "prompt"], [{ visits: 3 }, null],
])("%j → %s", (over, out) => expect(shouldOfferInstall({ visits: 0, dismissedAt: null, now: NOW, standalone: false, canPrompt: false, ios: false, ...over })).toBe(out));
it("counts a visit once per session", () => expect([countVisit(1, false), countVisit(1, true)]).toEqual([2, 1]));
```

`e2e/pwa.spec.ts` (append):
```ts
test("the app is installable", async ({ page }) => {
  // GET /manifest.webmanifest → 200 JSON with display "standalone"; every icon and shortcut icon URL → 200 image/png
  // the sign-in page head links the manifest and an apple-touch-icon, and has six apple-touch-startup-image links
});
test("the Add expense shortcut opens the add flow", async ({ browser }) => {
  // a user with one group opens /dashboard?add=1 → lands on the group with the "Add expense" sheet open
});
```

- [ ] **Step 2: Run** `pnpm test src/app/manifest.test.ts src/lib/install-prompt.test.ts && pnpm test:e2e e2e/pwa.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the assets, manifest, metadata, prompt and shortcut handling.

- [ ] **Step 4: Run** the same commands. Expected: PASS. Look at each generated PNG once (screenshot or open it in
  the browser pane). The "H" is centred and the maskable one survives a circle crop.

- [ ] **Step 5: Commit**: `git commit -m "feat(pwa): manifest, icons, iOS splash, install prompt after the second visit, Add expense shortcut"` (include files).

---

### Task 10: Nudges

**Files:**
- Create: `src/server/nudges.ts`, `src/server/actions/nudges.ts`, `test/nudges.test.ts`.
- Modify: `src/server/settlements.ts` (`getSettleUp`), `src/components/settle-card.tsx`,
  `src/app/(app)/groups/[groupId]/settle/page.tsx`, `test/authz-actions.test.ts`, `e2e/settle.spec.ts`.

**Interfaces:**
- Consumes: `getGroupBalances`, `createNotifications`, `nudgeNotice`, `requireMember`.
- Produces:
  ```ts
  export async function nudge(userId: string, groupId: string, toMemberId: string): Promise<void>;
  export const nudgeAction = defineAction(z.object({ groupId: z.string().min(1), memberId: z.string().min(1) }), …);   // then revalidateGroup()
  ```
- `SettleUpTransfer` and `SettleCardData` gain `nudge: "ready" | "sent" | null`.
  - It is non-null only when the transfer is to the viewer, the payer is an active member with an account, and the
    group isn't archived.
  - It is `"sent"` when the viewer's `Nudge` row for that payer has `sentAt` within 24 hours.

Rules for `nudge` (`requireMember(…, { write: true })`):
1. **The target** must be a member of this group with `leftAt` null, else `UserError("Choose someone in this group.")`.
   With no account → `UserError("They haven't joined Hisaab yet.")`.
2. **The debt:** `getGroupBalances` must have a transfer `{ from: target, to: me }`, else
   `` UserError(`${name} doesn't owe you anything right now.`) ``. Its `amount` is what the reminder says.
3. **Recording it, in one transaction:**
   1. `nudge.updateMany({ where: { fromMemberId: me, toMemberId: target, sentAt: { lt: dayAgo } }, data: { sentAt: now } })`.
   2. If the count is 0, `nudge.create`.
   3. Then `createNotifications` with `nudgeNotice` and `actorUserId` = me.

   A P2002 from the create, caught **outside** the transaction (the transaction is aborted by then), →
   `` UserError(`You've already reminded ${name} in the last 24 hours.`) ``. Two taps at once therefore produce
   exactly one reminder: the second either waits on the row lock and matches nothing, or loses the unique race.
4. Delivery (Task 5) sends the push and an email of kind `nudge`, so the 10-an-hour sender cap applies.

UI (`SettleCard`, role `receive`):
- `nudge === "ready"`: a secondary button "Nudge" (aria-label `Nudge ${fromName}`, `h-11`), disabled while pending.
  - On success: the toast `Reminder sent to ${fromName}`, then `router.refresh()`.
  - On an error: `toast.error(result.error)`.
- `nudge === "sent"`: the same button, disabled, reading "Nudged".

- [ ] **Step 1: Write the failing tests** `test/nudges.test.ts`

The setup: Asha paid ₹1,200, split between Asha and Ravi; Rahul is a placeholder; the group is "Goa Trip".
```ts
it("reminds someone who owes you", async () => {
  await nudge(asha.id, g.id, raviM.id);
  // ravi's notification: kind "nudge", text "Asha reminded you about ₹600 in Goa Trip", href `/groups/${g.id}/settle`, actorUserId asha.id
});
it("only once per 24 hours, even on a double tap", async () => {
  const results = await Promise.allSettled([nudge(asha.id, g.id, raviM.id), nudge(asha.id, g.id, raviM.id)]);
  // exactly one fulfilled; the other rejects "You've already reminded Ravi in the last 24 hours."; one notification
  // move sentAt back 25 hours → nudge works again (two notifications)
});
it("only for a debt to you", async () => { /* ravi nudges asha → "Asha doesn't owe you anything right now." */ });
it("not for placeholders or people who left", async () => {
  // rahul (placeholder) owing asha → "They haven't joined Hisaab yet."; a member with leftAt → "Choose someone in this group."
});
it("shows on the settle page whether you can nudge", async () => {
  // getSettleUp(asha) → the Ravi→Asha transfer has nudge "ready"; after nudge → "sent"; in ravi's view → null
});
it("refuses in an archived group", async () => { /* → "This group is archived." */ });
```
`test/authz-actions.test.ts`:
- Add `nudges.ts`.
- `nudgeAction` per member of the target → `FORBIDDEN`.
- `snapshot()` adds `nudge` rows.

`e2e/settle.spec.ts` (append):
```ts
test("nudge someone who owes you", async ({ browser }) => {
  // asha + ravi (inviteAndJoin); asha adds ₹1,200 split equally; asha /settle → "Ravi pays you ₹600" card → "Nudge"
  // → toast "Reminder sent to Ravi"; the button reads "Nudged" and is disabled
  // ravi's bell shows 1 unread; the outbox has an email to ravi with subject "Asha reminded you about ₹600 in Goa Trip"
});
```

- [ ] **Step 2: Run** `pnpm test test/nudges.test.ts && pnpm test:e2e e2e/settle.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the service, action, settle-up state and button.

- [ ] **Step 4: Run** the same commands. Expected: PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat(nudge): remind someone who owes you, once a day, by push, email and the bell"` (include files).

---

### Task 11: @mentions in comments

**Files:**
- Create: `src/lib/mentions.ts`, `src/lib/mentions.test.ts`.
- Modify: `src/server/comments.ts`, `src/components/comment-thread.tsx`,
  `src/app/(app)/groups/[groupId]/expenses/[expenseId]/page.tsx`,
  `src/app/(app)/groups/[groupId]/settlements/[settlementId]/page.tsx`, `test/comments.test.ts`,
  `e2e/expenses.spec.ts`.

**Interfaces:**
- Produces in `mentions.ts`:
  ```ts
  export type Mentionable = { memberId: string; displayName: string };
  export function findMentions(body: string, people: Mentionable[]): string[];   // member ids, in order of first appearance, no repeats
  export function mentionQuery(textBeforeCaret: string): string | null;          // the partial name after an "@" being typed, else null
  ```
  `findMentions` rules:
  - A mention is `@` followed by a person's `displayName`, compared case-insensitively.
  - The character before the `@` must be the start of the text or not a letter or digit (`/[\p{L}\p{N}]/u`), so
    `ravi@x.com` is no mention.
  - The character after the name must be the end of the text or not a letter or digit.
  - Longer names are matched first, and a matched span can't be reused: with "Ravi" and "Ravi Kumar",
    `@Ravi Kumar` is only Ravi Kumar.

  `mentionQuery` matches `/(?:^|\s)@([^\s@]*)$/`.
- Produces in `comments.ts`:
  `listMentionable(userId: string, groupId: string): Promise<Mentionable[]>`: active members with an account, not the
  caller, ordered by `displayName`, behind `requireMember`.
  - `addComment` passes `notify: findMentions(body, <the same list, excluding the author>)` to `recordActivity`.
- `CommentThread` gains `mentionable: Mentionable[]`. Both detail pages pass it.

Behaviour (`CommentThread`):
- While `mentionQuery(text before the caret)` is not null, a `role="listbox"` labelled "Mention someone" shows up
  to 5 people whose name starts with the query (case-insensitive), as `role="option"` items.
- Tapping or Enter on an option replaces the partial with `@${displayName} `. Arrow keys move between options and
  Escape closes the list.
- Comment bodies still render as plain text.

- [ ] **Step 1: Write the failing tests**

`src/lib/mentions.test.ts`:
```ts
const people = [{ memberId: "r", displayName: "Ravi" }, { memberId: "rk", displayName: "Ravi Kumar" }, { memberId: "a", displayName: "Asha" }];
it.each([
  ["@Ravi can you check?", ["r"]], ["@ravi kumar paid", ["rk"]], ["thanks @Asha, @Ravi!", ["a", "r"]],
  ["mail ravi@x.com", []], ["@Ravidas", []], ["@Asha @Asha", ["a"]], ["(@Asha)", ["a"]], ["@", []],
])("%j mentions %j", (body, ids) => expect(findMentions(body, people)).toEqual(ids));
it.each([["hi @As", "As"], ["@", ""], ["hi @Asha ", null], ["a@b", null]])("query of %j is %j", (t, q) => expect(mentionQuery(t)).toBe(q));
```
`test/comments.test.ts` (append):
- Asha comments "@Ravi please check" → Ravi gets "Asha mentioned you on “Dinner”", with detail "@Ravi please check".
- "@Rahul" (a placeholder) → no notification.
- Asha mentioning "@Asha" → none.
- A member who left → none.
- `listMentionable` leaves out the caller, placeholders and people who left.

`e2e/expenses.spec.ts` (append):
```ts
test("mention someone in a comment", async ({ browser }) => {
  // ravi (inviteAndJoin) on Asha's expense: type "@As" in "Add a comment" → option "Asha" → click → the textarea reads "@Asha "
  // type "can you check?" → "Post" → asha's bell shows 1 unread → /notifications shows "Ravi mentioned you on “Dinner”"
});
```

- [ ] **Step 2: Run** `pnpm test src/lib/mentions.test.ts test/comments.test.ts && pnpm test:e2e e2e/expenses.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the lib, the service changes and the autocomplete.

- [ ] **Step 4: Run** the same commands. Expected: PASS. Check the suggestion list at 375px with the on-screen
  keyboard height in mind: the list sits above the textarea, never under the keyboard.

- [ ] **Step 5: Commit**: `git commit -m "feat(comments): @mentions with suggestions, notifying the people mentioned"` (include files).

---

### Task 12: Infra and deploy config (VAPID secrets, CPU outside requests)

**Files:**
- Modify: `infra/setup.sh`, `.github/workflows/ci.yml`, `README.md`.

**Interfaces:**
- `infra/setup.sh`:
  - Add `HISAAB_VAPID_PUBLIC_KEY` and `HISAAB_VAPID_PRIVATE_KEY` to the secret-creation loop (next to
    `HISAAB_BETTER_AUTH_SECRET`).
  - Generate the pair once and never show it. Both versions come from the same pair, so they can't drift apart:
    ```bash
    # Web Push keys: one pair, generated here and never shown. Both secrets always get their versions from the same pair.
    if has_version HISAAB_VAPID_PUBLIC_KEY && has_version HISAAB_VAPID_PRIVATE_KEY; then skip "secret HISAAB_VAPID_* versions"
    else
      step "secret HISAAB_VAPID_* versions"
      vapid=$(pnpm exec web-push generate-vapid-keys --json)
      printf '%s' "$vapid" | jq -r .publicKey | tr -d '\n' | gcloud secrets versions add HISAAB_VAPID_PUBLIC_KEY --data-file=- "${P[@]}"
      printf '%s' "$vapid" | jq -r .privateKey | tr -d '\n' | gcloud secrets versions add HISAAB_VAPID_PRIVATE_KEY --data-file=- "${P[@]}"
      unset vapid
    fi
    ```
  - Grant per-secret access next to the existing grants:
    `bind secrets HISAAB_VAPID_PUBLIC_KEY "serviceAccount:$RUN_SA" roles/secretmanager.secretAccessor`, and the same
    for the private key.
- `ci.yml`, in the deploy step:
  - Append `,VAPID_PUBLIC_KEY=HISAAB_VAPID_PUBLIC_KEY:latest,VAPID_PRIVATE_KEY=HISAAB_VAPID_PRIVATE_KEY:latest` to
    `--set-secrets`.
  - Add `--no-cpu-throttling`, with a comment: "Push and email go out after the response (next/server `after`). With
    request-based CPU, that work would stall until the next request."
  - The smoke check loop also expects `200` from `/manifest.webmanifest` and `/sw.js`, plus one more line expecting
    `401` from `/api/events` (the stream route loads, and refuses strangers).
- `README.md`:
  - The feature list gains real-time updates, the notification centre, push, email notifications and preferences,
    nudges, and the installable app with offline reading.
  - The Secrets table lists the VAPID pair as "Created by `infra/setup.sh`".
  - Note: rotating the pair means adding new versions to both and redeploying, and every device has to turn
    notifications on again.
  - Local setup: push works locally once a pair from `pnpm exec web-push generate-vapid-keys` is in `.env`.

- [ ] **Step 1: Edit** the three files as above. Implementers stop here and do **not** run `infra/setup.sh` or any
  `gcloud` command.

- [ ] **Step 2: Verify** with `bash -n infra/setup.sh` (syntax only) and by reading the diff of `ci.yml`. Expected: no
  syntax errors, and the deploy command's flags read as one `gcloud run deploy` line.

- [ ] **Step 3: Commit**: `git commit -m "chore(infra): VAPID secrets, CPU after responses, smoke-check the PWA and stream routes"` (include files).

- [ ] **Step 4 (controller only, with Sumit's approval):**
  1. Show Sumit the `infra/setup.sh` and `ci.yml` diff. It carries `--no-cpu-throttling` only if he approved it when
     reviewing the plan; its cost is instance-based billing while an instance is up, and min instances stays at 0.
  2. On his yes, run `bash infra/setup.sh` **in the `feat/phase-3` worktree**. `main` doesn't have the new script
     until merge, and the worktree has `node_modules` for `web-push`.
  3. Expected: only the VAPID steps print "creating"; everything else prints "exists, skipping".
  4. This must happen before the PR merges, because the deploy reads both secrets.

---

### Task 13: Two phones end to end, full suite, rollout

**Files:**
- Create: `e2e/phones.spec.ts`.

**Interfaces:**
- Consumes: every e2e helper above. Both contexts are made with
  `newPage(browser, { ...devices["Pixel 7"], locale: "en-IN", timezoneId: "Asia/Kolkata" })`.

- [ ] **Step 1: Write the e2e** `e2e/phones.spec.ts`

This is the phase's "done when", on two phone-sized contexts:
1. Asha creates "Goa Trip", and Ravi joins. Both are on the group page, with `data-live="open"`.
2. Asha adds "Dinner at Thalassa" ₹1,200 from the FAB. Ravi's page shows it within 2s, highlighted, without a
   reload, and his bell reads "Notifications, 1 unread".
3. Asha nudges Ravi from Settle up. Ravi's bell reads "Notifications, 2 unread".
4. Ravi records his ₹600 (Record a payment → Cash). Asha's Balances tab shows "All settled up 🎉" without a reload,
   and her bell has "Ravi paid you ₹600".

- [ ] **Step 2: Run** `pnpm test:e2e e2e/phones.spec.ts`. Expected: PASS. If it fails, the bug is in an earlier task:
  fix it there, with a regression test first.

- [ ] **Step 3: Full verification.** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`.
  Expected: all pass. Take screenshots of every new screen at 375px and 1280px, light and dark: the bell and header,
  the notification centre, the settings card, the install card, the offline banner and page, and the nudge button.
  No local docker build.

- [ ] **Step 4: Commit, push, PR**

```bash
git add e2e/phones.spec.ts && git commit -m "test(e2e): a change on one phone shows on the other at once, with a notification"
git push -u origin feat/phase-3 && gh pr create --fill --base main
```
Expected: the PR checks pass. The controller confirms Task 12 Step 4 is done, then waits for Sumit to merge. Expected
after the merge: the deploy runs the `notifications` migration through `hisaab-migrate`, `gcloud run deploy` carries
the new flags, and the smoke check passes.

- [ ] **Step 5: Verify on real devices (with Sumit)**

- **Android Chrome:** visit twice, and the install card appears. Install, then turn on notifications in Account.
- **iPhone (iOS 16.4+):**
  - Safari shows the Home Screen card on the second visit.
  - After Add to Home Screen, the app opens on the splash, and Account → Turn on works.
- **Phone A adds an expense:**
  - Phone B, with the group open, shows it in about 1s with the highlight.
  - Lock phone B and add another: a push arrives. Tapping it opens that expense, and the bell count drops.
- **Ravi records a payment to Asha:** Asha's push has "I didn't receive this" on Android. Tapping it opens the
  dispute dialog.
- **Nudge:** the push and the email ("Asha reminded you about ₹… in …") both arrive.
- **Airplane mode on phone B:** reopen the last group, and it reads with the offline banner. An unvisited page shows
  "You're offline".
- **Sign out on phone B:** after that, no push arrives for phone B's account.
- Archive or leave the test group afterwards.

**Phase 3 done.**

---

## Next plans (not in this document)

- Phase 4 adds FX, receipts, the "Scan receipt" shortcut (and the PWA share target, later), DIRECT groups and the
  Friends tab.
- Phase 5 adds recurring expenses with their "recurring expense created" notification (a new `NotificationKind` and
  preference row), the weekly digest email, and Cloud Scheduler.
