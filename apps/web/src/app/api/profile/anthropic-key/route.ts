/** The signed-in user's Anthropic key, for Claude's opinion in What's different on /voices/design. */
import { keyRoutes } from "@/lib/profile/key-routes";
import { verifyAnthropicKey } from "@/lib/voice-design/claude";

export const dynamic = "force-dynamic";

export const { GET, POST, DELETE } = keyRoutes("anthropic", (key) => verifyAnthropicKey(key));
