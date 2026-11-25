/** The amber every audio column gives a take made from text that has since changed. */
import { useUiText } from "@/components/UiTextProvider";
import { cn } from "@/lib/utils";

export default function OutdatedNote({ className }: { className?: string }) {
  const t = useUiText().catalogue.row;
  return (
    <span className={cn("text-amber-300", className)} title={t.outdatedWhy}>
      {t.outdated}
    </span>
  );
}
