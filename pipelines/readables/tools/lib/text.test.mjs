import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { normaliseText, shownText, spokenText, isGeneratable, spokenWithTitle } from "./text.mjs";

function decodeFixture(value) {
  return value.replace(/\\(n|r|t|0|\\)/g, (_, escape) => ({ n: "\n", r: "\r", t: "\t", 0: "\0", "\\": "\\" })[escape]);
}

const normaliseCases = (await readFile(new URL("./normalise-cases.tsv", import.meta.url), "utf8"))
  .trimEnd()
  .split("\n")
  .map((line) => {
    const [name, input, expected] = line.split("\t");
    return { name, input: decodeFixture(input), expected: decodeFixture(expected) };
  });

for (const { name, input, expected } of normaliseCases) {
  test(`shared normalisation case: ${name}`, () => assert.equal(normaliseText(input), expected));
}

test("CRLF becomes a newline", () => {
  assert.equal(normaliseText("Ola Morgan,\r\n\r\nOs negocios"), "Ola Morgan,\n\nOs negocios");
});

test("$B and $b are newlines, whatever their case", () => {
  assert.equal(normaliseText("Line one$BLine two$bLine three"), "Line one\nLine two\nLine three");
});

test("trailing whitespace on a line goes, blank runs collapse to one blank line", () => {
  assert.equal(normaliseText("One   \n\n\n\nTwo\n\n"), "One\n\nTwo");
});

test("spoken text drops the HTML the signed pages carry", () => {
  assert.equal(spokenText("<HTML><BODY><H1>Ledger</H1>Three crates.</BODY></HTML>"), "Ledger Three crates.");
});

test("spoken text shows an entity as its character, and never as a tag", () => {
  assert.equal(spokenText("MILITARY RANKS OF THE HORDE &amp; ALLIANCE"), "MILITARY RANKS OF THE HORDE & ALLIANCE");
  assert.equal(spokenText("<P>1 &lt;b&gt; 2</P>"), "1 <b> 2");
});

test("spoken text reads an aside, set apart by breaks", () => {
  assert.equal(
    spokenText("The Venture Company <illegible text> It would seem.\n\n<several pages appear to be torn out>"),
    "The Venture Company\nillegible text\nIt would seem.\nseveral pages appear to be torn out",
  );
});

test("a page that is only an aside is voiced", () => {
  assert.deepEqual(isGeneratable("<The rest of the book is blank>"), { generatable: true, skipReason: null });
});

test("spoken text drops esMX's <nombre> rather than saying it", () => {
  assert.equal(spokenText("Ya no somos víctimas, <nombre>. Somos"), "Ya no somos víctimas, . Somos");
});

test("shown text keeps layout, drops <nombre>, and decodes entities", () => {
  assert.equal(shownText("Ya no somos <nombre>.\n\n&amp; &lt;nombre&gt;"), "Ya no somos .\n\n& <nombre>");
});

test("a signed page is stored as lines, with no tags", () => {
  assert.equal(
    normaliseText(
      '<HTML>\n<BODY>\n<H1 align="center">RANKS</H1><BR/>\n<IMG src="Interface\\PvPRank14"/><BR/>\n' +
        '<P align="right">Grand Marshal</P><BR/><BR/>\n<P>Horde &amp; Alliance$BSecond line</P></BR>\n</BODY>\n</HTML>',
    ),
    "RANKS\n\nGrand Marshal\n\nHorde & Alliance\nSecond line",
  );
});

test("a stored signed page normalises to itself, an escaped tag included", () => {
  const once = normaliseText("<P>1 &lt;b&gt; 2</P>");
  assert.equal(once, "1 &lt;b&gt; 2");
  assert.equal(normaliseText(once), once);
});

test("a page with no markup keeps its asides in storage", () => {
  assert.equal(normaliseText("Imagine if <illegible text> Hahaha!\n\nMore."), "Imagine if <illegible text> Hahaha!\n\nMore.");
  assert.equal(normaliseText("<plusieurs pages>"), "<plusieurs pages>");
});

test("spoken text keeps ordinary prose untouched apart from newlines", () => {
  assert.equal(spokenText("Dear sir,\n\nThe rains have come."), "Dear sir, The rains have come.");
});

test("an empty page is not generatable", () => {
  assert.deepEqual(isGeneratable(""), { generatable: false, skipReason: "empty" });
});

test("a placeholder page is not generatable", () => {
  assert.deepEqual(isGeneratable("Missing Text"), { generatable: false, skipReason: "placeholder" });
});

test("a page holding a substitution token is not generatable", () => {
  assert.deepEqual(isGeneratable("Greetings, $N."), { generatable: false, skipReason: "substitution" });
});

test("ordinary prose is generatable", () => {
  assert.deepEqual(isGeneratable("The rains have come."), { generatable: true, skipReason: null });
});

test("a title is read ahead of the page, closed with a full stop and a break", () => {
  assert.equal(spokenWithTitle("Letter to Ello", "The letters\n\nflicker."), "Letter to Ello.\nThe letters flicker.");
});

test("a title that already ends a sentence gets no second stop", () => {
  assert.equal(spokenWithTitle("For the Light!", "Brothers,"), "For the Light!\nBrothers,");
});

test("a page that opens with its own title is not given it twice", () => {
  assert.equal(spokenWithTitle("Fellari Swiftarrow", "Fellari Swiftarrow\n\nRanger Captain"), "Fellari Swiftarrow Ranger Captain");
  assert.equal(
    spokenWithTitle("A Treatise on Military Ranks", '<H1 align="center">A TREATISE ON MILITARY RANKS</H1>'),
    "A TREATISE ON MILITARY RANKS",
  );
});

test("the comparison is not limited to ASCII", () => {
  assert.equal(spokenWithTitle("Записка Зама", "Записка Зама\n\nАптекарь"), "Записка Зама Аптекарь");
});

test("no title, just the spoken page", () => {
  assert.equal(spokenWithTitle("", "Dear sir,\n\nHello."), "Dear sir, Hello.");
  assert.equal(spokenWithTitle("   ", "Dear sir,"), "Dear sir,");
});
