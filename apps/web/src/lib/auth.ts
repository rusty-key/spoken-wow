/**
 * The Better Auth server instance. Everything that reads or writes a session goes through
 * this module: the catch-all route handler, and the /admin page's guard.
 *
 * Email and password only, with no verification step. Email is sent for one thing, the
 * password reset (lib/email.ts).
 */
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin } from "better-auth/plugins";

import { recordAuthEvent } from "./activity/auth-events";
import { db } from "./db";
import { sendPasswordResetEmail } from "./email";
import { ac, roles } from "./permissions";

export const auth = betterAuth({
  database: db(),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => sendPasswordResetEmail(user.email, url),
    // Someone resetting because their account was taken also throws the intruder out.
    revokeSessionsOnPasswordReset: true,
  },
  // nginx terminates TLS, so the origin Better Auth sees is http://127.0.0.1:3000 unless we
  // tell it the public one. Cookies and redirects are built from this.
  baseURL: process.env.BETTER_AUTH_URL,
  // Any localhost port, in development only.
  //
  // Better Auth refuses a sign-in whose Origin does not match baseURL, and `next dev` moves
  // to 3001 whenever something else holds 3000 -- so the login form answers "invalid origin"
  // for a port nobody chose. Production keeps the strict check: this list is what stops a
  // page on another origin posting credentials here. Its one entry is the site's old address,
  // which installed Managers still sign in through and send as their Origin.
  //
  // Wildcard strings rather than regexes: this version matches patterns with * and ?
  // (dist/auth/trusted-origins.mjs) and its options type takes string[]. A plain property
  // rather than a conditional spread, because spreading widens the object enough that the
  // admin plugin's types stop reaching the session and `session.user.role` disappears from
  // every caller.
  trustedOrigins:
    process.env.NODE_ENV === "production"
      ? ["https://spoken.rusty.one"]
      : ["http://localhost:*", "http://127.0.0.1:*"],
  plugins: [
    adminPlugin({
      ac,
      roles,
      defaultRole: "member",
      adminRoles: ["admin"],
    }),
    // Lets server actions and route handlers set the session cookie. Must stay last.
    nextCookies(),
  ],
  // Role changes, bans, removals and impersonation reach the activity log from here: they
  // are the admin plugin's endpoints, not this app's, so no store of ours sees them.
  hooks: {
    after: recordAuthEvent,
  },
});
