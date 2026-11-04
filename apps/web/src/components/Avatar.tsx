import { cn } from "@/lib/utils";

/** A person's initial in a circle, for lists of who did what. */
export default function Avatar({ name, small, className }: { name: string | null; small?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-muted text-muted-foreground inline-grid shrink-0 place-items-center rounded-full font-semibold",
        small ? "size-5 text-[10px]" : "size-6 text-xs",
        className,
      )}
    >
      {(name || "?")[0].toUpperCase()}
    </span>
  );
}
