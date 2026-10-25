/** The signed-in user's VoiceStudio connection. The handlers, and their rules, are keyRoutes'. */
import { checkVoiceStudio } from "@/lib/generation/speakers/voicestudio";
import { decodeConnection, encodeConnection, parseConnection } from "@/lib/generation/voicestudio-connection";
import { keyRoutes } from "@/lib/profile/key-routes";

export const dynamic = "force-dynamic";

// Listing the profiles is free and needs the key a remote service asks for, so it proves both
// the address and the key before either is stored.
export const { GET, POST, DELETE } = keyRoutes(
  "voicestudio",
  async (key) => {
    await checkVoiceStudio(decodeConnection(key));
    return { tier: null };
  },
  (body) => {
    const { connection, error } = parseConnection(body);
    return connection ? { key: encodeConnection(connection), error: null } : { key: null, error };
  },
);
