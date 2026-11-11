/** A sentence with one `{link}` in it, around the element that stands for it. */
export default function WithLink({ text, link }: { text: string; link: React.ReactNode }) {
  const [before, after = ""] = text.split("{link}");
  return (
    <>
      {before}
      {link}
      {after}
    </>
  );
}
