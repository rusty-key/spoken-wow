"use client";

import Link from "@/components/LocaleLink";
import { useUiText } from "@/components/UiTextProvider";

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
  const words = useUiText();
  if (!message) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{words.apiKeys.keyNeeded}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          {words.apiKeys.keyNeededBody}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {words.common.close}
          </Button>
          <Button asChild>
            <Link href="/profile">{words.apiKeys.goToProfile}</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
