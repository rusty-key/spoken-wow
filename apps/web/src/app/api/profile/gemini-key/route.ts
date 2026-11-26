/** The signed-in user's Gemini key, for the blind comparison on /voices/design. The handlers are keyRoutes'. */
import { keyRoutes } from "@/lib/profile/key-routes";
import { verifyGeminiKey } from "@/lib/voice-design/gemini";

export const dynamic = "force-dynamic";

export const { GET, POST, DELETE } = keyRoutes("gemini", (key) => verifyGeminiKey(key));
