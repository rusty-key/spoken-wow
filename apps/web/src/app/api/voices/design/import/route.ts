/**
 * The one-off import of round one's designs, one version folder per request: `files` are the
 * folder's meta.json, previews and lines, `reviews` its entry in reviews.json. Admins only.
 */
import { isAdmin } from "@/lib/permissions";
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { importVersion, parseVersion } from "@/lib/voice-design/import";

export const dynamic = "force-dynamic";

/** A folder is three previews and three lines, about 2 MB; far past that is not one. */
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  if (!isAdmin(session.user.role)) return Response.json({ error: "not allowed" }, { status: 403 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "expected a multipart upload" }, { status: 400 });
  }
  const uploads = form.getAll("files").filter((value): value is File => value instanceof File);
  if (uploads.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) {
    return Response.json({ error: "that is more than one version folder" }, { status: 413 });
  }
  let reviews: unknown = [];
  try {
    reviews = JSON.parse(String(form.get("reviews") ?? "[]"));
  } catch {
    return Response.json({ error: "reviews is not JSON" }, { status: 400 });
  }

  try {
    const files = await Promise.all(uploads.map(async (file) => ({ name: file.name, data: Buffer.from(await file.arrayBuffer()) })));
    const result = await importVersion(parseVersion(files, reviews), { lang, userId: session.user.id });
    return Response.json({ name: result.name, imported: result.id !== null });
  } catch (error) {
    return failed(error);
  }
}
