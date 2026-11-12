"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SECTIONS, validateFields, validateNewPack, type Section } from "@/lib/community/rules";
import type { Submission } from "@/lib/community/store";
import { cn } from "@/lib/utils";

/** The pack a new version is for, and the submission its fields start from. */
export type VersionOf = {
  id: string;
  lang: string;
  section: Section;
  from: Submission | null;
  /** What players have now, which the new version has to be above to reach them as an update. */
  liveVersion: string | null;
};

type Draft = Record<
  "id" | "lang" | "section" | "title" | "author" | "description" | "version" | "size" | "sha256" | "url" | "homepage" | "license",
  string
>;

const EMPTY: Draft = {
  id: "",
  lang: "",
  section: "",
  title: "",
  author: "",
  description: "",
  version: "",
  size: "",
  sha256: "",
  url: "",
  homepage: "",
  license: "",
};

// What describes the pack carries over; what describes one zip has to be new for the next one.
function draftOf(pack: VersionOf | null): Draft {
  if (!pack) return EMPTY;
  const from = pack.from;
  return {
    ...EMPTY,
    id: pack.id,
    lang: pack.lang,
    section: pack.section,
    title: from?.title ?? "",
    author: from?.author ?? "",
    description: from?.description ?? "",
    homepage: from?.homepage ?? "",
    license: from?.license ?? "",
  };
}

const TOC_KEY: Record<Section, string> = {
  quests: "X-SpokenQuests-Language",
  places: "X-SpokenPlaces-Language",
  readables: "X-SpokenReadables-Language",
};

const TEXTAREA =
  "border-input w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-base outline-none md:text-sm " +
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 " +
  "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

function Code({ children }: { children: ReactNode }) {
  return <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.8rem] [overflow-wrap:anywhere]">{children}</code>;
}

/**
 * A new pack, or a new version of one, sent for review.
 *
 * The rules run here first so a typo is caught without a round trip, and the server's per-field
 * errors land in the same places when it disagrees.
 */
export default function PackForm({
  pack,
  onClose,
  onSent,
}: {
  /** Null for a new pack. */
  pack: VersionOf | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(pack));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // An edit clears that field's error: it answered a value that is no longer there.
  const set = (field: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _answered, ...rest }) => rest);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const { id: _id, lang: _lang, section: _section, ...fields } = draft;
    const body = pack ? fields : draft;
    const checked = pack ? validateFields(body) : validateNewPack(body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }

    setBusy(true);
    setErrors({});
    const response = await fetch(pack ? `/api/packs/${encodeURIComponent(pack.id)}/submissions` : "/api/packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);

    if (!response) return setErrors({ form: "Could not reach the server. Try again." });
    if (response.ok) return onSent();
    const answer = (await response.json().catch(() => ({}))) as { error?: string; errors?: Record<string, string> };
    setErrors(answer.errors ?? { form: answer.error ?? "Something went wrong." });
  }

  const field = (name: keyof Draft, label: string, input: ReactNode, help?: ReactNode) => (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={`pack-${name}`}>{label}</Label>
      {input}
      {errors[name] && (
        <p id={`pack-${name}-error`} className="text-destructive text-xs">
          {errors[name]}
        </p>
      )}
      {help && <div className="text-muted-foreground space-y-1 text-xs">{help}</div>}
    </div>
  );

  const text = (name: keyof Draft, props: React.ComponentProps<"input"> = {}) => (
    <Input
      id={`pack-${name}`}
      value={draft[name]}
      onChange={(event) => set(name)(event.target.value)}
      aria-invalid={Boolean(errors[name])}
      aria-describedby={errors[name] ? `pack-${name}-error` : undefined}
      disabled={busy}
      {...props}
    />
  );

  const folder = `SpokenCommunity_${draft.id || "<id>"}`;
  const zip = `${folder}.zip`;
  const tocKey = (SECTIONS as readonly string[]).includes(draft.section)
    ? TOC_KEY[draft.section as Section]
    : "X-SpokenQuests-Language";

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pack ? "Submit new version" : "New pack"}</DialogTitle>
          <DialogDescription>
            {pack
              ? `${pack.id} · ${pack.lang} · ${pack.section}. An admin reviews it before players get it.`
              : "An admin reviews it before players can install it from the Spoken Manager."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="grid gap-5">
          {!pack && (
            <div className="grid gap-4 sm:grid-cols-[1fr_7rem_9rem]">
              {field(
                "id",
                "Pack id",
                text("id", { placeholder: "elune-quests-de", autoComplete: "off", spellCheck: false }),
                <p>Lower-case letters, digits and hyphens. It names the folder and never changes.</p>,
              )}
              {field("lang", "Language", text("lang", { placeholder: "deDE", maxLength: 4, autoComplete: "off" }))}
              {field(
                "section",
                "Section",
                <Select value={draft.section} onValueChange={set("section")} disabled={busy}>
                  <SelectTrigger id="pack-section" aria-invalid={Boolean(errors.section)} className="w-full">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTIONS.map((section) => (
                      <SelectItem key={section} value={section}>
                        {section}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>,
              )}
            </div>
          )}

          <p className="text-muted-foreground -mt-2 text-xs">
            The pack&apos;s <Code>.toc</Code> names its language with{" "}
            <Code>
              ## {tocKey}: {draft.lang || "deDE"}
            </Code>
            .
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {field("title", "Title", text("title", { maxLength: 80 }))}
            {field("author", "Author", text("author", { maxLength: 80 }))}
          </div>
          {field(
            "description",
            "Description",
            <textarea
              id="pack-description"
              rows={3}
              maxLength={400}
              value={draft.description}
              onChange={(event) => set("description")(event.target.value)}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? "pack-description-error" : undefined}
              disabled={busy}
              className={TEXTAREA}
            />,
            <p>What it covers: how much of the section, and who voiced it.</p>,
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {field("version", "Version", text("version", { placeholder: "1.0.0", autoComplete: "off" }), (
              <p>
                {pack?.liveVersion ? `Higher than ${pack.liveVersion}` : "Raise it for every new zip"}, so installed copies
                see an update.
              </p>
            ))}
            {field("size", "Size in bytes", text("size", { inputMode: "numeric", placeholder: "734003200", autoComplete: "off" }))}
            <div className="text-muted-foreground -mt-2 space-y-1 text-xs sm:col-span-2">
              <p>
                Size on Windows (PowerShell): <Code>(Get-Item {zip}).Length</Code>
              </p>
              <p>
                On macOS: <Code>stat -f %z {zip}</Code>, on Linux: <Code>stat -c %s {zip}</Code>
              </p>
            </div>
          </div>
          {field(
            "sha256",
            "SHA-256 checksum",
            text("sha256", { autoComplete: "off", spellCheck: false, className: "font-mono" }),
            <>
              <p>
                Windows: <Code>certutil -hashfile {zip} SHA256</Code>
              </p>
              <p>
                macOS or Linux: <Code>sha256sum {zip}</Code>
              </p>
            </>,
          )}
          {field(
            "url",
            "Zip link",
            text("url", {
              type: "url",
              placeholder: `https://github.com/you/your-pack/releases/download/v1.0.0/${zip}`,
              autoComplete: "off",
            }),
            <p>
              A GitHub release asset. The zip holds one folder, <Code>{folder}</Code>, with{" "}
              <Code>{folder}.toc</Code> inside, and nothing else beside it.
            </p>,
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {field("homepage", "Homepage (optional)", text("homepage", { type: "url", placeholder: "https://" }))}
            {field("license", "License (optional)", text("license", { maxLength: 60, placeholder: "CC-BY-4.0" }))}
          </div>

          {errors.form && (
            <p role="alert" className="text-destructive text-sm">
              {errors.form}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className={cn(busy && "cursor-wait")}>
              {busy ? "Sending…" : "Send for review"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
