/** The amber every audio column gives a take made from text that has since changed. */
import { cn } from "@/lib/utils";

export default function OutdatedNote({ className }: { className?: string }) {
  return (
    <span className={cn("text-amber-300", className)} title="Made from text that has since changed">
      audio outdated
    </span>
  );
}
