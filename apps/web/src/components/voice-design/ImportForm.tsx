"use client";

import { Loader2, Upload } from "lucide-react";
import { useState } from "react";

import Panel from "@/components/backstage/Panel";
import { useUiText } from "@/components/UiTextProvider";
import { withLang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";

import { send, useWorkbench } from "./context";

/** `<slot>-v<n>/` folders and the files of theirs the import keeps; the live takes are the site's own. */
const VERSION_DIR = /(^|\/)([a-z]+(?:-[a-z0-9]+)+-v\d+)\/(meta\.json|preview\d+\.mp3|line\d+\.mp3)$/;

type Picked = { folders: Map<string, File[]>; reviews: Record<string, unknown> };

/**
 * The version folders anywhere under the picked folder, and the reviews.json nearest its top:
 * the scratch folder holds voices/ beside reviews.json, and older copies may sit deeper.
 */
export async function pick(files: Iterable<File>): Promise<Picked> {
  const folders = new Map<string, File[]>();
  const copies = new Map<string, { dir: string }>();
  let reviewsFile: { file: File; depth: number } | null = null;
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (path === "reviews.json" || path.endsWith("/reviews.json")) {
      const depth = path.split("/").length;
      if (!reviewsFile || depth < reviewsFile.depth) reviewsFile = { file, depth };
      continue;
    }
    const match = VERSION_DIR.exec(path);
    if (!match) continue;
    // An older copy of a version deeper in the folder is not uploaded beside the real one.
    const dir = path.slice(0, path.length - match[3].length - 1);
    const seen = copies.get(match[2]);
    if (seen && seen.dir !== dir) {
      if (seen.dir.split("/").length <= dir.split("/").length) continue;
      folders.delete(match[2]);
    }
    copies.set(match[2], { dir });
    folders.set(match[2], [...(folders.get(match[2]) ?? []), file]);
  }
  const reviews = reviewsFile ? (JSON.parse(await reviewsFile.file.text()) as Record<string, unknown>) : {};
  return { folders, reviews };
}

/** The one-off import of the designs made by hand before this page, from their scratch folder. */
export default function ImportForm() {
  const t = useUiText().voiceDesign;
  const { lang } = useWorkbench();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setLog([]);
    try {
      let picked: Picked;
      try {
        picked = await pick(Array.from(files));
      } catch (err) {
        // Otherwise a reviews.json that does not parse stops the spinner with no word.
        setLog([`reviews.json: ${err instanceof Error ? err.message : String(err)}`]);
        return;
      }
      const { folders, reviews } = picked;
      if (folders.size === 0) {
        setLog([t.importNothing]);
        return;
      }
      for (const [name, folder] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
        const form = new FormData();
        for (const file of folder) form.append("files", file, `${name}/${file.name}`);
        form.append("reviews", JSON.stringify(reviews[name] ?? []));
        try {
          const result = await send<{ imported: boolean }>(withLang(lang, "/api/voices/design/import"), { body: form });
          setLog((lines) => [...lines, fill(result.imported ? t.imported : t.importSkipped, { name })]);
        } catch (err) {
          setLog((lines) => [...lines, `${name}: ${err instanceof Error ? err.message : String(err)}`]);
        }
      }
      setLog((lines) => [...lines, t.importReload]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vd-import">
      <Panel tone="neutral" quiet icon={<Upload />} title={t.importTitle} description={t.importLede}>
        <div className="vd-import-body">
          <label className="bs-btn">
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
            {t.importPick}
            <input
              type="file"
              className="sr-only"
              disabled={busy}
              // A folder, not files: the version folders and reviews.json beside them.
              {...{ webkitdirectory: "", directory: "" }}
              multiple
              onChange={(event) => void upload(event.target.files)}
            />
          </label>
          {log.length > 0 ? (
            <ul className="vd-import-log" aria-live="polite">
              {log.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
