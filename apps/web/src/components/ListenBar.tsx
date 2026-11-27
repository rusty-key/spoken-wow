import Link from "@/components/LocaleLink";

/** The call to vote on designed voices, above every page's bar but the Listen page's own. */
export default function ListenBar({ text, cta }: { text: string; cta: string }) {
  return (
    <div className="listen-bar">
      <span>{text}</span>
      <Link href="/listen">{cta} →</Link>
    </div>
  );
}
