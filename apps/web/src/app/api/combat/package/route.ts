import { requireIn } from "@/lib/generation/authz";
import { BASE_LANG } from "@/lib/lang";
import { COMBAT_AUDIO_ZIP } from "@/lib/combat/audio-pack";
import { combatPackage } from "@/lib/combat/package";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;
  if (lang !== BASE_LANG) return Response.json({ error: "Combat Voice V1 is English only" }, { status: 400 });
  try {
    const bytes = await combatPackage();
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${COMBAT_AUDIO_ZIP}"`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not package combat recordings" }, { status: 409 });
  }
}
