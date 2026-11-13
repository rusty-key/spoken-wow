# Self-serve plan 3: invites by email

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Whoever may grant capabilities in a language can bring in somebody who has no account yet: the team page's add form sends them an invite by email, and its link lets them register or sign in and take up the capabilities it names.

**Architecture:** A new `invite` table (migration `0109`) holds one row per invite: the address, the language, the capabilities, a SHA-256 of a single-use token, and its expiry, acceptance and revocation. `PUT /api/grants` keeps granting directly to an address that has an account; for an unknown address it creates an invite and emails the link instead of answering 404. The link opens `/invite?token=…`, which sends a visitor through register or sign-in and back, then accepts with one button: the session's email must match the invite's, and the grants are applied through `addGrants` with the inviter as `grantedBy`, after re-checking `canGrant` against the inviter's current grants, in the same transaction that marks the invite used.

**Tech Stack:** Postgres 16 plain-SQL migrations (`apps/web/migrations`), node-postgres, Next.js App Router (`apps/web`), Better Auth email and password, Resend (`lib/email.ts`), Vitest.

**Spec:** [`SELF-SERVE-TEAMS.md`](SELF-SERVE-TEAMS.md), *What the translator can do* 4: "Invite people by email, whether or not they have registered. An invite names the capabilities it grants and is accepted by signing in or registering from its link." *Left to the builder* leaves storage, lifetime and the email to this plan. Plan 1 ([`self-serve-plan-1-languages.md`](self-serve-plan-1-languages.md)) is built; plan 2 (requests and approval) is written in parallel and takes migration `0108`.

## Decisions

- **The invite binds to the email address.** Accepting needs a session whose email equals the invite's (compared lower-cased and trimmed) and the token. Somebody signed in as another account is told whose invite it is and offered Sign out. *(User, through the brief.)*
- **Registering from the link pre-fills the address, read-only.** Signing in from the link pre-fills it, editable (they may own the address under another login and see the mismatch message). *(My call.)*
- **Accepting is a button, not a side effect of opening the link.** A link preview or a mail scanner opening the URL must not use it up. *(My call.)*
- **The inviter is re-checked at accept time with `canGrant`, all or none.** If the inviter may no longer grant every capability the invite names (or is banned or deleted), accepting fails with a message naming the inviter and nothing is granted; the invite stays pending, so it works again if their access comes back, and another admin can revoke it and send a new one. Only `canGrant` decides, so plan 2's `text` for request-made languages works with no change here. The inviter's `Viewer` is built by the same `viewerOf` the routes use, so whatever plan 2 adds to it reaches the re-check. *(Brief; partial acceptance is my call: no.)*
- **Lifetime 14 days.** A resend mints a new token (only the hash is stored, so the old link cannot be re-sent), renews the expiry to 14 days from the resend, and the old link stops working. An expired invite can be resent; an accepted or revoked one cannot. *(My call.)*
- **One open invite per address and language.** Inviting an address that already has an unexpired open invite in the language answers 409 "already invited; resend or revoke it". An expired one is revoked in the same transaction and replaced. *(My call.)*
- **Rate limits, by counting rows, as reports do** (`api/reports/route.ts`, no generic helper exists): at most **20 new invites per inviter per 24 hours**, and a resend at most **once per 10 minutes per invite, 5 sends per invite in all**. Site admins are exempt. A refusal is 429 with a sentence, and is logged to pm2 like a report refusal. *(My call.)*
- **The add form names the capabilities.** "Add someone to German" gets a capability choice (default `edit`, only the ones the viewer may grant). The same choice serves a direct grant and an invite. *(My call; the spec says an invite names its capabilities.)*
- **Not row-level secured.** Like `team_member` and `api_token`, an invite belongs to a person, read before any team is set. Plan 5's second team will need a `teamId` on the invite, beside the team parameter it gives `addGrants`; not added now. *(My call, YAGNI.)*
- **Invites are never deleted**, only revoked or accepted, so the team page and the log can say what happened. The app role gets select, insert, update. Deleting the inviter deletes their invites (cascade): nobody is left to vouch for them. *(My call.)*
- **Pending invites do not apply themselves** when somebody registers with the address without the link. *(Spec: "accepted by signing in or registering from its link".)*
- **Telling an admin whether an address has an account is unchanged.** Today's 404 already says so; now the reply says "added" or "invited". *(Known, accepted.)*

## Global Constraints

- Migration: plain SQL, `apps/web/migrations/0109_invite.sql`, additive, one transaction, applied by `deploy/web/bin/migrate.sh`. Plan 2's `0108` may land first; numbers must not collide.
- Language code: `^[a-z]{2}[A-Z]{2}$`; capabilities: `CAPABILITIES` in `lib/permissions.ts`.
- Who may invite, resend, revoke: `canGrant(viewer, capability, lang)` for every capability the invite names. No special case for `text` anywhere.
- Tokens: `randomBytes(32).toString("base64url")`, stored as `sha256` hex only, never logged. Pages that carry one in the URL set `referrer: "no-referrer"` (as `reset-password/page.tsx`).
- Email goes through `sendEmail` (never awaited, never throws). Without `RESEND_API_KEY`/`RESEND_FROM` outside production it prints the email, link included, to the dev server's stdout.
- Activity: every act is logged inside its transaction (`lib/activity/store.ts`); new kinds go in `kinds.ts`, under the `admin` category, and get a row in `ActivityTable.tsx`.
- Tests run as `spoken_app` on `spoken_ci_pin`, never `spoken_dev`. Fixtures use `asSystem` and `testUser` from `src/lib/teams/testing.ts`. Commands in fish: `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run <file>`.
- Browser checks run on `spoken_dev` in the Paseo tab already open.

## Review Focus

1. **The link opened while signed in as somebody else** (the inviter testing their own link, a shared computer): 403 with "This invite is for a…@example.com; you are signed in as …", nothing granted, invite still pending. Tested in Task 3.
2. **The inviter lost the right to grant** between sending and accepting (their admin taken away, or the team handed over): 409 naming the inviter and the capability, nothing granted, invite still pending. Tested in Task 3.
3. **Accept pressed twice, or in two tabs:** the grants are given once, one `invite.accepted` row, the second press answers "already accepted" and the page shows the success state, not an error. Tested in Task 3.
4. **Case and whitespace in the address:** inviting `" Ana@Example.com "` stores `ana@example.com`; registering as `ana@example.com` accepts; and an address with an account in another case gets a direct grant, not an invite. Tested in Tasks 1 and 2.
5. **A resent invite's old link:** answers "this link is not valid any more" (unknown or replaced), not a crash; the new link works. Tested in Task 2.

---

### Task 1: The `invite` table and its store

**Files:**
- Create: `apps/web/migrations/0109_invite.sql`
- Create: `apps/web/src/lib/invites/store.ts`
- Test: `apps/web/src/lib/invites/store.test.ts`

**Interfaces:**
- Produces, table `invite`: `"id" uuid pk default gen_random_uuid()`, `"email" text not null check ("email" = lower(btrim("email")))`, `"lang" text not null check (~ '^[a-z]{2}[A-Z]{2}$')`, `"capabilities" text[] not null check (cardinality >= 1 and <@ array['text','edit','regenerate','configure','ignore','admin','record'])`, `"tokenHash" text not null unique`, `"invitedBy" text not null references "user" on delete cascade`, `"createdAt"`, `"sentAt" timestamptz not null default now()`, `"sendCount" integer not null default 1`, `"expiresAt" timestamptz not null`, `"acceptedAt"`, `"acceptedBy" text references "user" on delete set null`, `"revokedAt"`, `"revokedBy" text references "user" on delete set null`. Unique index `invite_open_idx` on `("lang", "email") where "acceptedAt" is null and "revokedAt" is null`; index `invite_inviter_idx` on `("invitedBy", "createdAt" desc)`. `revoke all … from spoken_app; grant select, insert, update`.
- Produces, `lib/invites/store.ts` (server-only):
  - `INVITE_DAYS = 14`, `INVITES_PER_DAY = 20`, `RESEND_GAP_MS = 10 * 60_000`, `MAX_SENDS = 5`
  - `type InviteRow = { id: string; email: string; lang: string; capabilities: Capability[]; invitedById: string; invitedByName: string | null; sentAt: string; expiresAt: string; expired: boolean }` (open invites only)
  - `type InviteLookup = { id: string; email: string; lang: string; capabilities: Capability[]; inviterName: string | null; state: "pending" | "expired" | "accepted" | "revoked" }`
  - `normalEmail(raw: string): string | null`: trimmed, lower-cased, `null` unless it matches `^[^\s@]+@[^\s@]+\.[^\s@]+$` and is at most 254 characters
  - `createInvite(args: { email: string; lang: Lang; capabilities: Capability[]; invitedBy: string; limited: boolean }): Promise<{ invite: InviteRow; token: string }>`: throws `InviteExistsError` (open, unexpired invite; also on 23505), `InviteRateError` (when `limited` and the inviter created `INVITES_PER_DAY` rows in the last 24 h). Revokes an expired open invite for the same pair first, in the same transaction.
  - `resendInvite(id: string, limited: boolean): Promise<{ invite: InviteRow; token: string }>`: new hash, `sentAt = now()`, `sendCount + 1`, `expiresAt = now() + 14 days`. Throws `InviteGoneError` (accepted, revoked, unknown) or `InviteRateError` (when `limited`: sent under 10 minutes ago, or `sendCount >= MAX_SENDS`).
  - `revokeInvite(id: string, revokedBy: string): Promise<InviteRow | null>`: null when not open.
  - `openInvite(id: string): Promise<InviteRow | null>`, `listInvites(langs?: string[]): Promise<InviteRow[]>` (open ones, newest first), `lookupInvite(token: string): Promise<InviteLookup | null>`
  - The errors `InviteExistsError`, `InviteGoneError`, `InviteRateError` (with a `message` fit to show).
- Activity is recorded by the routes (Task 2), which know the actor; the store functions take a `client` only where Task 3 needs it.

- [ ] **Step 1: Write the failing tests** in `store.test.ts` (one `testUser` as inviter, `afterAll` deletes its `invite` rows):
  - `normalEmail(" Ana@Example.com ")` is `"ana@example.com"`; `normalEmail("nope")` and a 255-character address are `null`.
  - `createInvite({ email: "ana@example.com", lang: "deDE", capabilities: ["edit", "regenerate"], … })` returns a 43-character token; the stored `tokenHash` is `sha256(token)` hex and no column holds the token; `expiresAt` is 14 days out (±1 min).
  - `lookupInvite(token)` gives `state: "pending"`, the capabilities and the inviter's name; `lookupInvite("x")` is null.
  - A second `createInvite` for the same pair throws `InviteExistsError`; after `update invite set "expiresAt" = now() - interval '1 second'` it succeeds, and the first row has `revokedAt` set.
  - `resendInvite(id, false)` returns a new token: `lookupInvite(old)` is null, `lookupInvite(new)` is pending, `sendCount` is 2. `resendInvite(id, true)` straight after throws `InviteRateError`.
  - `revokeInvite(id, inviter)` returns the row; a second call returns null; `resendInvite` then throws `InviteGoneError`; `listInvites(["deDE"])` no longer has it.
  - With `limited: true`, the 21st `createInvite` within a day throws `InviteRateError` (insert 20 rows with `asSystem` first).
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/lib/invites/store.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Write the migration** and apply it: `deploy/web/bin/migrate.sh $PWD/apps/web` with `DATABASE_URL` on `spoken_ci_pin`.
- [ ] **Step 4: Implement the store.** Hash with `createHash("sha256")`, as `lib/tokens/store.ts` does. Every write in `inTransaction` (`lib/db.ts`).
- [ ] **Step 5: Run them.** Same command. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(invites): invite table and store`

### Task 2: Adding an unknown address sends an invite; resend and revoke

**Files:**
- Modify: `apps/web/src/app/api/grants/route.ts`, `apps/web/src/lib/email.ts`, `apps/web/src/lib/activity/kinds.ts`, `apps/web/src/components/ActivityTable.tsx`, `apps/web/src/lib/grants/client.ts`
- Create: `apps/web/src/lib/invites/listing.ts`, `apps/web/src/app/api/invites/[id]/route.ts` (DELETE), `apps/web/src/app/api/invites/[id]/resend/route.ts` (POST)
- Test: `apps/web/src/app/api/grants/route.test.ts`, `apps/web/src/app/api/invites/[id]/route.test.ts`

**Interfaces:**
- Consumes: Task 1's store.
- Produces:
  - `sendInviteEmail(to: string, args: { inviterName: string; langName: string; capabilities: string[]; url: string }): void` in `email.ts`. Subject `You're invited to work on <German> on Spoken`. Body lines: `<Inviter> invited you to work on <German> on Spoken, as: edit, regenerate.` / blank / `Accept here: <url>` / blank / `If you have no account yet, register from that link with this address. The link works once and expires in 14 days. If you don't know <Inviter>, ignore this email.` Capability names through `capabilityLabel`.
  - `inviteUrl(token: string): string` in `lib/invites/store.ts`: `${(process.env.BETTER_AUTH_URL ?? "https://spoken.quest").replace(/\/$/, "")}/invite?token=${token}` (the same base as `lib/community/store.ts`).
  - `PUT /api/grants`: body as today. `normalEmail` the address (400 when null). An account → `addGrants` as today. None → `createInvite` with `limited: !isAdmin(role)`, `sendInviteEmail`, activity `invite.sent`. Answers 200 with the listing plus `invited: boolean`; 409 on `InviteExistsError`, 429 on `InviteRateError`, both `{ error: message }`.
  - The listing (`GET` and every write) becomes `{ grants: GrantRow[]; invites: InviteRow[] }`, invites in the same languages as the grants.
  - `DELETE /api/invites/[id]`: 404 when not open, 403 unless `canGrant` for each capability in its language, else revoke, activity `invite.revoked`, answer the listing.
  - `POST /api/invites/[id]/resend`: same checks, `resendInvite(id, !isAdmin(role))`, email, activity `invite.resent`, answer the listing; 409 on `InviteGoneError`, 429 on `InviteRateError`.
  - Activity kinds, subject the invite id: `"invite.sent": { email: string; capabilities: Capability[] }`, `"invite.resent": { email: string }`, `"invite.revoked": { email: string }`. `CATEGORY_OF.invite = "admin"`. Rows: `invited <email> as <caps>`, `sent the invite to <email> again`, `revoked the invite to <email>`.
  - `grants/client.ts`: `sendGrants` also returns `invites` and `invited`; `resendInvite(id)` and `revokeInvite(id)` beside `giveGrants`. The listing's response type is `{ grants: GrantRow[]; invites: InviteRow[]; invited?: boolean }`.
  - The listing helper moves out of the route file to `listingFor(viewer: Viewer): Promise<Response>` in `lib/invites/listing.ts`, so the three routes share it.

- [ ] **Step 1: Write the failing tests.** Mock `@/lib/email` with `vi.mock`, capturing `sendInviteEmail` calls. In `grants/route.test.ts`, replace nothing; add:
  - As a deDE admin, `PUT { email: "nobody-<rand>@example.invalid", lang: "deDE", capabilities: ["edit", "record"] }` answers 200 with `invited: true`, `invites` holding that address with both capabilities, one email whose `url` contains `/invite?token=`, and one `invite.sent` activity row.
  - The same `PUT` again answers 409; a `PUT` with `["text"]` for an unknown address answers 403 and sends nothing.
  - `PUT` with the existing target's email in upper case answers `invited: false` and grants directly (Review Focus 4).
  - `PUT` with `email: "not an address"` answers 400.
  - In `invites/[id]/route.test.ts`: resend as the deDE admin answers 200, sends a second email with a different token, and the first token's `lookupInvite` is null (Review Focus 5); resend again at once answers 429; as a frFR admin, resend and revoke answer 403; revoke answers 200 and the listing has no invite; revoke again 404; resend after revoke 404.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/app/api/grants/route.test.ts "src/app/api/invites/[id]/route.test.ts"`. Expected: FAIL, 404 for the unknown address and missing modules.
- [ ] **Step 3: Implement** the email, the kinds and their rows, the listing helper, the route change and the two routes.
- [ ] **Step 4: Run them**, then `pnpm --dir apps/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(invites): invite an address that has no account`

### Task 3: Accepting an invite

**Files:**
- Modify: `apps/web/src/lib/grants/store.ts`, `apps/web/src/lib/invites/store.ts`, `apps/web/src/lib/activity/kinds.ts`, `apps/web/src/components/ActivityTable.tsx`
- Create: `apps/web/src/app/api/invites/accept/route.ts`
- Test: `apps/web/src/lib/invites/accept.test.ts`, `apps/web/src/app/api/invites/accept/route.test.ts`

**Interfaces:**
- Consumes: Task 1's table and `lookupInvite`.
- Produces:
  - `addGrants(userId, lang, capabilities, grantedBy, within?: (client: ClientBase) => Promise<void>)`: `within` runs first inside the same `withTeam` transaction, so a throw from it grants nothing. Existing callers unchanged.
  - `viewerById(userId: string): Promise<Viewer | null>` in `grants/store.ts`: reads `role`, `banned`, `banExpires` from `"user"`; null for no such user or a live ban (the ban test of `findLiveToken`); otherwise `viewerOf({ user: { id, role } })`.
  - `acceptInvite(token: string, user: { id: string; email: string }): Promise<AcceptOutcome>` in `invites/store.ts`, where `type AcceptOutcome = { ok: true; lang: string; capabilities: Capability[] } | { ok: false; reason: "unknown" | "expired" | "revoked" | "accepted" | "wrong-email" | "inviter-cannot-grant"; email?: string; inviterName?: string | null; capability?: Capability }`. Order: look up; compare `normalEmail(user.email)` with the invite's; `viewerById(invitedBy)` and `canGrant` for each capability (the first refused one is `capability`); then `addGrants(user.id, lang, capabilities, invitedBy, claim)`, where `claim` runs `update "invite" set "acceptedAt" = now(), "acceptedBy" = $2 where "id" = $1 and "acceptedAt" is null and "revokedAt" is null and "expiresAt" > now()` and throws when it touched no row; that throw becomes `reason: "accepted"` (or the state found on a fresh lookup). `invite.accepted` is recorded inside `claim` on its client.
  - Activity kind `"invite.accepted": { email: string; capabilities: Capability[] }`, actor the accepting user, subject the invite id; row: `accepted the invite as <caps>`. The `grant.added` rows `addGrants` writes carry the inviter as actor.
  - `POST /api/invites/accept` body `{ token: string }`: 401 without a session; else `acceptInvite(token, session.user)`. Status by outcome: ok 200 `{ lang, capabilities }`; `unknown` 404; `expired`, `revoked` 410; `accepted` 409; `wrong-email` 403; `inviter-cannot-grant` 409. Every refusal carries `{ error, reason }` with the sentence the page shows.

- [ ] **Step 1: Write the failing tests** in `accept.test.ts` (inviter a `testUser` with deDE `admin` inserted into `team_member` via `asSystem`; invitee a `testUser` whose email is the invited address):
  - Accepting gives the invitee `edit` and `regenerate` in deDE (`grantsOf`), with `grantedBy` the inviter in `team_member`; the invite has `acceptedAt` and `acceptedBy`; one `invite.accepted` row and two `grant.added` rows whose actor is the inviter.
  - The invite email in another case than the account's still accepts (Review Focus 4).
  - A third `testUser` gets `reason: "wrong-email"` with the invite's email, and nothing granted (Review Focus 1).
  - After deleting the inviter's `admin` row, `reason: "inviter-cannot-grant"`, `capability: "edit"`, nothing granted, invite still `pending` (Review Focus 2). Same after banning the inviter.
  - Two `acceptInvite` calls under `Promise.all` yield one `ok` and one `reason: "accepted"`, and exactly one `invite.accepted` row (Review Focus 3).
  - Expired → `"expired"`, revoked → `"revoked"`, a random token → `"unknown"`.
  - `addGrants` with a `within` that throws leaves `grantsOf` unchanged (in `grants/store.test.ts`).
- [ ] **Step 2: Write the route test** `accept/route.test.ts` (session mocked as in `grants/route.test.ts`): 401 without a session; 200 with `{ lang: "deDE" }` for the matching user; 403 for another; 409 on a second press.
- [ ] **Step 3: Run them.** `pnpm --dir apps/web vitest run src/lib/invites/accept.test.ts src/app/api/invites/accept/route.test.ts src/lib/grants/store.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `within`, `viewerById`, `acceptInvite`, the kind and its row, and the route.
- [ ] **Step 5: Run them**, then `pnpm --dir apps/web typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(invites): accept an invite from its link`

### Task 4: The invite page, and register or sign in from it

**Files:**
- Create: `apps/web/src/app/[lang]/invite/page.tsx`, `apps/web/src/components/InviteAccept.tsx`
- Modify: `apps/web/src/components/AuthForm.tsx`, `apps/web/src/app/[lang]/register/page.tsx`, `apps/web/src/app/[lang]/login/page.tsx`
- Test: `apps/web/src/components/InviteAccept.test.tsx`

**Interfaces:**
- Consumes: Task 1's `lookupInvite`, Task 3's `POST /api/invites/accept`.
- Produces:
  - `/[lang]/invite?token=…` (server, `referrer: "no-referrer"`, `dynamic = "force-dynamic"`): `lookupInvite(token)`, `currentSession()`. States: no token or unknown → "This invite link is not valid any more. Ask whoever invited you to send it again."; expired, revoked → saying which, same advice; accepted → "This invite has been used." with a link to the language's home. Pending → "<Inviter> invited you to work on <German> as edit, regenerate." then `<InviteAccept>`.
  - `<InviteAccept token email lang capabilities signedInAs: string | null />` (client): signed out → "Register with <email>" (`/register?invite=<token>`) and "I already have an account" (`/login?invite=<token>`); signed in as another address → "This invite is for <email>. You are signed in as <other>." and Sign out (`signOut` then `router.refresh()`); signed in as the address → an Accept button posting the token, then "You're in. You can now work on German." with a link to `localeHref(lang, "/")`, and `router.refresh()` so the header gains the language. A 409 `accepted` shows the same success state. Any other refusal shows the route's `error`.
  - `AuthForm` gains `invite?: { token: string; email: string }`: prefills the email (read-only when registering), shows "You're answering an invite to <email>.", keeps `?invite=` on the switch link, and after success pushes `localeHref(lang, "/invite?token=" + token)` instead of `/`. Only the token is carried, never a free redirect path.
  - `register/page.tsx` and `login/page.tsx` read `searchParams.invite`, call `lookupInvite`, and pass `invite` to `AuthForm` only when it is pending.

- [ ] **Step 1: Write the failing tests** in `InviteAccept.test.tsx` (fetch and `next/navigation` mocked): signed out, it links to `/register?invite=tok` and `/login?invite=tok`; signed in as another address, it names both addresses and shows Sign out, not Accept; signed in as the address, Accept posts `{ token: "tok" }` and shows "You're in"; a 409 with `reason: "accepted"` also shows "You're in"; a 409 `inviter-cannot-grant` shows the route's `error`.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/components/InviteAccept.test.tsx`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the page, the component and the `AuthForm` change.
- [ ] **Step 4: Run them** and `pnpm --dir apps/web typecheck`. Expected: PASS.
- [ ] **Step 5: Check in the browser** on `spoken_dev`, dev server without `RESEND_*` set: invite a fresh address from `/admin?lang=deDE` (Task 5 adds the choice; `curl -X PUT` with the admin's cookie works before it), copy the link from the dev server's stdout (`email: RESEND_API_KEY or RESEND_FROM unset; email to …`), open it signed out, register, accept, and see the person ticked in the team page.
- [ ] **Step 6: Commit.** `feat(invites): invite page, register or sign in from the link`

### Task 5: The team page invites, lists and manages invites

**Files:**
- Modify: `apps/web/src/components/TeamMatrix.tsx`, `apps/web/src/app/[lang]/admin/page.tsx`
- Test: `apps/web/src/components/TeamMatrix.test.tsx`

**Interfaces:**
- Consumes: Task 2's listing shape and `resendInvite`/`revokeInvite` client calls; `canGrant`.
- Produces:
  - `TeamMatrix` takes `invites: InviteRow[]`; `admin/page.tsx` passes `await listInvites([team])`.
  - The add form: address, then one toggle per capability in `COLUMNS` that `canGrant(viewer, capability, lang)` allows, `edit` on by default; the button reads "Add". The hint becomes "Somebody without an account gets an email invite." On success the toast says `Added <address> to German` or `Invited <address> to German`, with the capabilities as detail.
  - Below the form, when `invites` is not empty, a "Pending invites" list: address, capability names, "invited by <name>", "sent <date>", and "expires <date>" or "expired". Resend and Revoke per row, disabled when the viewer cannot `canGrant` each of its capabilities. Revoke asks nothing and raises no undo (an undo would mean a new email); its toast says it was revoked. Every answer replaces both `grants` and `invites` from the listing.

- [ ] **Step 1: Write the failing tests** in `TeamMatrix.test.tsx` (fetch mocked): a deDE admin sees capability toggles without `text`; a site admin sees `text`; submitting with `edit` and `record` sends `capabilities: ["edit", "record"]`; an answer with `invited: true` toasts "Invited"; a listing with one invite renders its address and "Resend"; Revoke calls `DELETE /api/invites/<id>` and the row goes when the listing comes back empty; an expired invite shows "expired".
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/components/TeamMatrix.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --dir apps/web typecheck` and the whole web suite on `spoken_ci_pin`: `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web test`. Expected: PASS.
- [ ] **Step 5: Check in the browser** on `spoken_dev`: from `/admin?lang=deDE`, invite an unknown address with `edit` and `record`, see it under Pending invites, Resend (new link in stdout, old one says not valid), Revoke, invite again, accept as in Task 4, and see the `/activity` admin rows for each step.
- [ ] **Step 6: Commit.** `feat(invites): invite from the team page and manage pending invites`
