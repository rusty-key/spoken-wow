import { Fragment } from "react";

/**
 * What the game fills in for each player: `$N` name, `$C` class, `$R` race, `$G`/`$U`
 * male:female (`$gReisender:Reisende;`), the doubled `$$N` of TBC and Forever, and the genitive
 * `$Ns`/`$Cs`. Matched loosely on purpose: this only marks them for the eye.
 */
export const PLACEHOLDER = /(\$\$?[GgUu][^;]*;|\$\$?[NnCcRr]s?(?![A-Za-z]))/g;

/**
 * A line with its placeholders marked, and optionally one span struck through and another added:
 * how a suggested fix reads ("Hallo, ~~$R~~ $N!").
 */
export default function TokenText({
  text,
  removed,
  added,
}: {
  text: string;
  /** A span of `text` the fix takes out. Only its first occurrence is marked. */
  removed?: string;
  /** What the fix puts in its place. */
  added?: string;
}) {
  if (removed && text.includes(removed)) {
    const at = text.indexOf(removed);
    return (
      <>
        <TokenText text={text.slice(0, at)} />
        <span className="bs-token-bad">{removed}</span>
        {added ? (
          <>
            {" "}
            <span className="bs-token-good">{added}</span>
          </>
        ) : null}
        <TokenText text={text.slice(at + removed.length)} />
      </>
    );
  }
  const parts = text.split(PLACEHOLDER);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="bs-token">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
