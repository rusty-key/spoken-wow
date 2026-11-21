/**
 * The browser half of Better Auth. Passing the same `ac` and `roles` as the server gives the
 * client typed role names and lets it answer permission questions without a round trip.
 */
import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

import { ac, roles } from "./permissions";

export const authClient = createAuthClient({
  plugins: [adminClient({ ac, roles })],
});

export const { signIn, signUp, signOut, useSession, requestPasswordReset, resetPassword } = authClient;
