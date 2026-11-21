"use client";

import Link from "@/components/LocaleLink";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * What a 428 from a paid route looks like on screen.
 *
 * The refusal has to explain itself, because it is not the one people expect: the button
 * was there, the role is right, and the failure is a piece of setup nobody has mentioned
 * yet. So it says whose credits are spent and links to the page that fixes it, rather than
 * surfacing a status code next to a row.
 *
 * Shared by both sections, because the guard is: requireApiKey refuses a quests
 * regeneration exactly as it refuses a places one. Worded for either provider, because the
 * message it is handed -- requireApiKey's -- already names which key is missing.
 */
export default function ApiKeyRequiredDialog({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  if (!message) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>A key is needed</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          Generating audio spends from your own account with the generator active for this
          language on Voices — ElevenLabs or fish.audio — not from the site&apos;s. Add that key to your
          profile and this will work; it is encrypted before it is stored, and never shown
          again.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button asChild>
            <Link href="/profile">Go to profile</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
