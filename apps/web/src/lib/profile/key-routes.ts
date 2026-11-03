/**
 * Setting, replacing and clearing the signed-in user's key for one provider.
 *
 * One set of handlers for every provider, because the rules are the same and are the ones
 * that matter: NOTHING HERE EVER RETURNS A KEY -- not after a save, not behind a "reveal"
 * control, not to an admin. A response carries `ApiKeyStatus`, the last four characters and
 * when it was verified, which proves a key is set and is useless for spending with.
 *
 * Only somebody who spends somewhere may store one: a member has no action a key would
 * unblock, so storing their credential would be collecting a secret this app has no use for.
 */
import { apiKeyStatus, deleteApiKey, storeApiKey } from "@/lib/api-key";
import { currentSpender } from "@/lib/generation/authz";
import type { Provider } from "@/lib/generation/providers";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

/**
 * `verify` proves a key works before it is stored, by a call that costs nothing, and says
 * what plan it answered with if the provider has plans. A typo would otherwise first surface
 * as an "auth" failure in the middle of a batch, where it is fatal -- so a bad paste would
 * cost a whole regeneration pass instead of one message here.
 */
/**
 * `read` turns the posted body into the credential to verify and store, or says why it cannot.
 * A key by default; VoiceStudio's is a whole connection (voicestudio-connection.ts).
 */
export type ReadCredential = (
  body: Record<string, unknown>,
) => { key: string; error: null } | { key: null; error: string };

const readKey: ReadCredential = (body) => {
  const key = typeof body.key === "string" ? body.key.trim() : "";
  return key === "" ? { key: null, error: "a key is required" } : { key, error: null };
};

export function keyRoutes(
  provider: Provider,
  verify: (key: string) => Promise<{ tier: string | null }>,
  read: ReadCredential = readKey,
) {
  return {
    async GET() {
      const session = await currentSpender();
      if (!session) return FORBIDDEN();
      return Response.json({ status: await apiKeyStatus(session.user.id, provider) });
    },

    async POST(request: Request) {
      const session = await currentSpender();
      if (!session) return FORBIDDEN();

      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const { key, error } = read(body ?? {});
      if (key === null) return Response.json({ error }, { status: 400 });

      let tier: string | null;
      try {
        ({ tier } = await verify(key));
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 400 },
        );
      }

      return Response.json({ status: await storeApiKey(session.user.id, key, tier, provider) });
    },

    /**
     * Clears a key: the caller's own, or -- with ?userId= -- somebody else's, for admins.
     *
     * An admin can hand out regenerate, so they must be able to take back what it lets
     * someone spend with; a collaborator who leaves should not need psql to be un-keyed.
     * That is the whole of the power: an admin may remove a key and see that one exists,
     * never read one.
     */
    async DELETE(request: Request) {
      const session = await currentSession();
      if (!session) return FORBIDDEN();

      const target = new URL(request.url).searchParams.get("userId");

      if (target && target !== session.user.id) {
        if (!isAdmin(session.user.role)) return FORBIDDEN();
        await deleteApiKey(target, provider);
        return Response.json({ cleared: true });
      }

      await deleteApiKey(session.user.id, provider);
      return Response.json({ status: null });
    },
  };
}
