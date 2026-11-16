/** A count after a link's label, for something waiting there. Nothing at zero. */
export default function PendingCount({ value, title }: { value: number; title: string }) {
  if (value <= 0) return null;
  return (
    <span
      title={title}
      className="bg-primary text-primary-foreground min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold tabular-nums"
    >
      <span aria-hidden>{value}</span>
      <span className="sr-only">{title}</span>
    </span>
  );
}

export const packsWaiting = (value: number) => ({
  value,
  title: `${value} pack submission${value === 1 ? "" : "s"} waiting for review`,
});
