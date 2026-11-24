import { useUiText } from "@/components/UiTextProvider";
import { cn } from "@/lib/utils";

/**
 * English standing in for a translation that does not exist yet.
 *
 * Shown in italics and with a word saying so, rather than silently: a reader of the
 * Portuguese site who meets an English sentence should know it is a gap waiting to be
 * filled, not a line that is English in the game.
 */
export function Untranslated({
  missing,
  children,
  className,
}: {
  missing: boolean | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const t = useUiText().catalogue.untranslated;
  if (!missing) return <>{children}</>;
  return (
    <span
      className={cn("italic opacity-70", className)}
      title={t.title}
    >
      {children}
    </span>
  );
}

/** The marker beside a line's text, where the other facts about the text sit. */
export function UntranslatedMark() {
  const t = useUiText().catalogue.untranslated;
  return (
    <span
      className="text-muted-foreground rounded border px-1 leading-4"
      title={t.markTitle}
    >
      {t.mark}
    </span>
  );
}
