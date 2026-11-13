"use client";

/**
 * Fill a slot with a voice already in the caller's ElevenLabs account: one designed in their
 * dashboard or added from the voice library, rather than cloned here from clips.
 *
 * The voice is renamed to the slot's name (api/voices/[voice]/adopt), because the name is
 * what the generator looks voices up by.
 */
import { Library, Loader2 } from "lucide-react";
import { useState } from "react";

import { useLang } from "@/components/LangProvider";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { withLang } from "@/lib/lang";
import { cloneName } from "@/lib/voices/clone-name";

type AccountVoice = {
  voiceId: string;
  name: string;
  category: string;
  renamable: boolean;
  /** The clone name it already answers to, if it fills a slot. */
  slot: string | null;
};

export default function AccountVoicePicker({
  voice,
  exists,
  disabled,
  onAdopted,
}: {
  voice: string;
  /** Whether the slot already has a voice in the account, which adopting renames away. */
  exists: boolean;
  disabled?: boolean;
  onAdopted: () => void;
}) {
  const lang = useLang();
  const target = cloneName(voice, lang);
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<AccountVoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<AccountVoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(withLang(lang, "/api/voices/account"), { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `could not list voices (${response.status})`);
      setVoices(body.voices);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function adopt(picked: AccountVoice) {
    setPending(null);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withLang(lang, `/api/voices/${voice}/adopt`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: picked.voiceId, replace: exists }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `could not use ${picked.name} (${response.status})`);
      if (body.warning) setError(body.warning);
      // Names in the account changed, so the list read before is stale.
      setVoices(null);
      onAdopted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function pick(picked: AccountVoice) {
    setOpen(false);
    // Moving a voice out of another slot, or renaming this slot's away, is worth a second look.
    if (exists || picked.slot) setPending(picked);
    else adopt(picked);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next && voices === null) load();
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs" disabled={disabled || busy}>
            {busy || loading ? <Loader2 className="animate-spin" /> : <Library />}
            Use voice from my account
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="Search your ElevenLabs voices" className="h-8 text-xs" />
            <CommandList>
              <CommandEmpty className="py-3 text-center text-xs">
                {loading ? "Loading…" : "Nothing matches."}
              </CommandEmpty>
              <CommandGroup>
                {(voices ?? []).map((candidate) => (
                  <CommandItem
                    key={candidate.voiceId}
                    value={`${candidate.name} ${candidate.voiceId}`}
                    disabled={!candidate.renamable || candidate.name === target}
                    className="text-xs"
                    onSelect={() => pick(candidate)}
                  >
                    <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                    <span className="text-muted-foreground shrink-0">
                      {candidate.name === target
                        ? "this slot"
                        : !candidate.renamable
                          ? "premade, cannot be renamed"
                          : candidate.slot
                            ? "fills a slot"
                            : candidate.category}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {pending && (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-amber-400">
            Renames “{pending.name}” to <code>{target}</code>
            {pending.slot ? ", so it stops filling that slot" : ""}
            {exists ? `; the current ${target} becomes “${target} (replaced)”` : ""}.
          </span>
          <Button variant="destructive" size="xs" onClick={() => adopt(pending)}>
            Confirm
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setPending(null)}>
            Cancel
          </Button>
        </span>
      )}

      {error && (
        <p role="alert" className="text-destructive w-full text-xs">
          {error}
        </p>
      )}
    </>
  );
}
