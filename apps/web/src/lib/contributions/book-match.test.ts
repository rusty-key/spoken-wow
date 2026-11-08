import { describe, expect, it } from "vitest";

import { bookCandidates, bookMatchOf, indexCorpus, matchBook, type BookCorpus, type BookMatchInput } from "./book-match";

function page(lineId: string, bookId: string, pageNumber: number, texts: Record<string, string>, titles: Record<string, string>, owner?: [ "object" | "item", number ]) {
  return {
    lineId, bookId, pageNumber,
    ownerKind: owner?.[0] ?? null, ownerIds: owner ? [owner[1]] : [],
    texts: new Map(Object.entries(texts)), titles: new Map(Object.entries(titles).map(([lang, title]) => [lang, [title]])),
  };
}

const corpus: BookCorpus = indexCorpus([
    page("b:38", "38", 1, { enUS: "Stoutmantle --", esES: "Stoutmantle -- Qué descaro", esMX: "Mantorrecio: Hay que tener osadía" }, { enUS: "Wiley's Note", esES: "Nota de Wiley", esMX: "Nota de Wiley" }, ["item", 1]),
    page("b:39", "38", 2, { enUS: "They have a vast network", esMX: "Han mandado construir" }, { enUS: "Wiley's Note", esES: "Nota de Wiley", esMX: "Nota de Wiley" }, ["item", 1]),
    page("b:500", "500", 1, { enUS: "Dust one." }, { enUS: "A Dusty Tome" }),
    page("b:600", "600", 1, { enUS: "Dust two." }, { enUS: "A Dusty Tome" }),
    page("b:340", "340", 1, { esMX: "Carta de reclutamiento" }, { esES: "Registro de Reclutamiento", esMX: "Registro de Reclutamiento" }, ["item", 7]),
    page("b:341", "341", 1, { esMX: "Carta de reclutamiento" }, { esES: "Registro de Reclutamiento", esMX: "Registro de Reclutamiento" }, ["item", 8]),
    page("b:342", "342", 1, { esMX: "Carta de reclutamiento" }, { esES: "Otro registro" }, ["item", 9]),
    page("b:800", "800", 1, { enUS: "Twin" }, { enUS: "Twin Book" }, ["item", 50]),
    page("b:801", "801", 1, { enUS: "Other" }, { enUS: "Twin Book Two" }, ["item", 50]),
    page("b:900", "900", 1, { enUS: "Same", esES: "Igual" }, { enUS: "Nine" }),
    page("b:901", "901", 1, { enUS: "Same", esES: "Distinto" }, { enUS: "Ten" }),
    page("b:950", "950", 1, { esES: "Linea uno\nlinea dos" }, { esES: "  Espaciado  " }),
  ]);

function row(over: Partial<BookMatchInput>): BookMatchInput {
  return { locale: "esES", text: null, meta: {}, matchLineId: null, matchBookId: null, matchPageNumber: null, matchNewBook: false, ...over };
}

describe("bookCandidates", () => {
  it("is empty for a match that is not ambiguous", () => {
    expect(bookCandidates({ kind: "known", lineId: "b:38", via: "text" }, corpus, row({}))).toEqual([]);
  });

  it("answers with the page when the words matched, and tells same-titled pages apart", () => {
    const found = bookCandidates({ kind: "ambiguous", candidates: ["b:340", "b:341"] }, corpus, row({ locale: "esMX" }));
    expect(found.map((c) => c.answer)).toEqual([{ lineId: "b:340" }, { lineId: "b:341" }]);
    expect(found.map((c) => c.owner)).toEqual([{ kind: "item", id: 7 }, { kind: "item", id: 8 }]);
    expect(found[0]).toMatchObject({ label: "Registro de Reclutamiento p.1", bookId: "340", excerpt: "Carta de reclutamiento" });
  });

  it("answers with the book and the row's page number when only the title matched", () => {
    const found = bookCandidates({ kind: "ambiguous", candidates: ["500", "600"] }, corpus, row({ locale: "enUS", meta: { number: "1" } }));
    expect(found.map((c) => c.answer)).toEqual([{ bookId: "500", pageNumber: 1 }, { bookId: "600", pageNumber: 1 }]);
    expect(found.map((c) => c.excerpt)).toEqual(["Dust one.", "Dust two."]);
  });

  it("shows the book's first page and says so when the book has no such page", () => {
    const [found] = bookCandidates({ kind: "ambiguous", candidates: ["500"] }, corpus, row({ locale: "enUS", meta: { number: "3" } }));
    expect(found).toMatchObject({ label: "A Dusty Tome p.3 (new page)", lineId: "b:500", answer: { bookId: "500", pageNumber: 3 } });
  });

  it("leaves out a candidate the corpus no longer has", () => {
    expect(bookCandidates({ kind: "ambiguous", candidates: ["b:12345", "12345"] }, corpus, row({}))).toEqual([]);
  });
});

describe("matchBook", () => {
  it("finds a page by another language's exact words, as a correction where this language differs", () => {
    expect(matchBook(row({ text: "Mantorrecio: Hay que tener osadía", meta: { book: "Nota de Wiley", number: "1" } }), corpus))
      .toEqual({ kind: "correction", lineId: "b:38", current: "Stoutmantle -- Qué descaro", via: "text" });
  });

  it("calls a page this language has with the same words known", () => {
    expect(matchBook(row({ text: "Stoutmantle -- Qué descaro" }), corpus)).toMatchObject({ kind: "known", lineId: "b:38" });
  });

  it("calls a page this language lacks a translation", () => {
    expect(matchBook(row({ text: "Han mandado construir" }), corpus)).toMatchObject({ kind: "translation", lineId: "b:39", via: "text" });
  });

  it("places by title and number when the words are new", () => {
    expect(matchBook(row({ text: "Otras palabras", meta: { book: "Nota de Wiley", number: "2" } }), corpus))
      .toMatchObject({ kind: "translation", lineId: "b:39", via: "title" });
    expect(matchBook(row({ text: "Otras palabras", meta: { book: "Nota de Wiley", number: "3" } }), corpus))
      .toEqual({ kind: "new-page", bookId: "38", pageNumber: 3, via: "title" });
  });

  it("never guesses between two books of one title", () => {
    expect(matchBook(row({ locale: "enUS", text: "Dust three.", meta: { book: "A Dusty Tome", number: "1" } }), corpus))
      .toEqual({ kind: "ambiguous", candidates: ["500", "600"] });
  });

  it("starts a new book when nothing matches", () => {
    expect(matchBook(row({ text: "Trotamundos de los elfos:", meta: { book: "Instrucciones del consejero Nazgrel", number: "1" } }), corpus))
      .toEqual({ kind: "new-book", title: "Instrucciones del consejero Nazgrel", pageNumber: 1, via: "none" });
  });

  it("matches by the item that was read before anything else", () => {
    expect(matchBook(row({ text: "Otras palabras", meta: { item: "1", number: "2" } }), corpus))
      .toMatchObject({ kind: "translation", lineId: "b:39", via: "owner" });
  });

  it("takes a moderator's answer over every guess", () => {
    expect(matchBook(row({ text: "Mantorrecio: Hay que tener osadía", matchLineId: "b:39" }), corpus))
      .toMatchObject({ kind: "translation", lineId: "b:39", via: "moderator" });
    expect(matchBook(row({ text: "x", matchBookId: "500", matchPageNumber: 4 }), corpus))
      .toEqual({ kind: "new-page", bookId: "500", pageNumber: 4, via: "moderator" });
    expect(matchBook(row({ text: "x", meta: { book: "Nota de Wiley", number: "1" }, matchNewBook: true }), corpus))
      .toEqual({ kind: "new-book", title: "Nota de Wiley", pageNumber: 1, via: "moderator" });
  });

  it("calls two pages with the same words in any language ambiguous", () => {
    const twin = indexCorpus([...corpus.pages, page("b:700", "700", 1, { enUS: "Dust one." }, { enUS: "Another" })]);
    expect(matchBook(row({ locale: "deDE", text: "Dust one." }), twin)).toEqual({ kind: "ambiguous", candidates: ["b:500", "b:700"] });
  });
  it("falls through to the words when the owner id is one the corpus does not know", () => {
    expect(matchBook(row({ text: "Han mandado construir", meta: { object: "999999", number: "2" } }), corpus))
      .toMatchObject({ kind: "translation", lineId: "b:39", via: "text" });
  });
  it("falls through when an owner id names two books", () => {
    expect(matchBook(row({ text: "Twin", meta: { item: "50", number: "1" } }), corpus))
      .toMatchObject({ kind: "translation", lineId: "b:800", via: "text" });
  });

  it("falls through a moderator's page that no longer exists", () => {
    expect(matchBook(row({ text: "Han mandado construir", matchLineId: "b:gone" }), corpus))
      .toMatchObject({ kind: "translation", lineId: "b:39", via: "text" });
  });

  it("prefers the page that has these words in this language when other languages repeat them", () => {
    expect(matchBook(row({ text: "Same", locale: "esES" }), corpus)).toEqual({ kind: "ambiguous", candidates: ["b:900", "b:901"] });
    const tie = indexCorpus([page("b:a", "a", 1, { esES: "Eco" }, {}), page("b:b", "b", 1, { enUS: "Eco" }, {})]);
    expect(matchBook(row({ text: "Eco", locale: "esES" }), tie)).toMatchObject({ kind: "known", lineId: "b:a", via: "text" });
  });

  it("calls a whitespace or line-ending difference known", () => {
    expect(matchBook(row({ text: "  Linea uno\r\nlinea dos \n" }), corpus)).toMatchObject({ kind: "known", lineId: "b:950" });
  });

  it("never matches whitespace-only words to a page", () => {
    expect(matchBook(row({ text: " \r\n " }), corpus)).toMatchObject({ kind: "new-book", via: "none" });
  });

  it("trims the corpus's titles too", () => {
    expect(matchBook(row({ text: "Otras", meta: { book: "Espaciado", number: "1" } }), corpus))
      .toMatchObject({ kind: "correction", lineId: "b:950", via: "title" });
  });

  it("narrows identical words by the contributor's title, then page number", () => {
    expect(matchBook(row({ text: "Carta de reclutamiento", meta: { book: "Otro registro", number: "1" } }), corpus))
      .toMatchObject({ kind: "translation", lineId: "b:342", via: "text" });
    const split = indexCorpus([
      page("b:1", "1", 1, { esMX: "Igual" }, { esES: "Carta" }),
      page("b:2", "1x", 2, { esMX: "Igual" }, { esES: "Carta" }),
    ]);
    expect(matchBook(row({ text: "Igual", meta: { book: "Carta", number: "2" } }), split))
      .toMatchObject({ kind: "translation", lineId: "b:2", via: "text" });
  });

  it("stays ambiguous when the title leaves none or several", () => {
    expect(matchBook(row({ text: "Carta de reclutamiento", meta: { book: "Ninguno", number: "1" } }), corpus))
      .toEqual({ kind: "ambiguous", candidates: ["b:340", "b:341", "b:342"] });
    expect(matchBook(row({ text: "Carta de reclutamiento", meta: { book: "Registro de Reclutamiento", number: "1" } }), corpus))
      .toEqual({ kind: "ambiguous", candidates: ["b:340", "b:341"] });
  });

  it("tries the contributor's title against the titles in any language when its own has no pages", () => {
    const letters = indexCorpus([
      page("b:340", "340", 1, { esMX: "Igual" }, { esMX: "Carta de reclutamiento" }),
      page("b:341", "341", 1, { esMX: "Igual" }, { esMX: "Carta de reclutamiento firmada" }),
    ]);
    expect(matchBook(row({ text: "Igual", meta: { book: "Carta de reclutamiento", number: "1" } }), letters))
      .toMatchObject({ kind: "translation", lineId: "b:340", via: "text" });
  });

  it("matches 2,000 rows against 1,200 pages quickly", () => {
    const pages = Array.from({ length: 1200 }, (_, i) =>
      page(`b:s${i}`, `s${i}`, 1, { enUS: `English words ${i}`, esMX: `Palabras ${i}` }, { enUS: `Book ${i}`, esMX: `Libro ${i}` }, ["item", 100000 + i]));
    const big = indexCorpus(pages);
    const start = performance.now();
    for (let i = 0; i < 2000; i++) {
      const n = i % 1500;
      matchBook(row({ text: `Palabras ${n}`, meta: { book: `Libro ${n}`, number: "1" } }), big);
    }
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("bookMatchOf", () => {
  it("takes a match as the table sent it back", () => {
    const match = { kind: "new-page", bookId: "n1", pageNumber: 2, via: "title" };
    expect(bookMatchOf(match)).toBe(match);
    expect(bookMatchOf({ kind: "ambiguous", candidates: ["b:1", "b:2"] })).toBeDefined();
  });

  it("drops anything else", () => {
    expect(bookMatchOf(undefined)).toBeUndefined();
    expect(bookMatchOf({ kind: "translation" })).toBeUndefined();
    expect(bookMatchOf({ kind: "new-book", title: "T", pageNumber: "2" })).toBeUndefined();
    expect(bookMatchOf({ kind: "ambiguous", candidates: [1] })).toBeUndefined();
    expect(bookMatchOf({ kind: "elsewhere", lineId: "b:1" })).toBeUndefined();
  });
});
