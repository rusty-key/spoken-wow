// Readables whose sources or types cannot be derived from the world database alone. The
// generator imports these tables, and tests can inspect the same inputs it uses.

// Sources the world DB cannot see, by book id: an item a spell or a machine makes, a quest whose
// giver it does not spawn, and the zones where the object's spawns do not give them. Direct quest
// rewards are retained in the generated data so an existing character's completed quests can
// backfill found readables.
export const SOURCES_BY_HAND = {
  394: [{ how: "quest", quest: 1016, zones: [1440] }], // Divined Scroll: the Divining Scroll, used in Ashenvale
  1171: [{ how: "quest", quest: 2944, zones: [1425] }], // Snapshot of Gammerita: taken in the Hinterlands
  // Gnomeregan's punch cards, each made from the one before at a Matrix Punchograph.
  1191: [{ how: "object", object: 142345 }], // 3005-A
  1192: [{ how: "object", object: 142475 }], // 3005-B
  1193: [{ how: "object", object: 142476 }], // 3005-C
  1194: [{ how: "object", object: 142696 }], // 3005-D
  2671: [{ how: "quest start", quest: 7636, zones: [1448] }], // Petrified Bark: Vartrus the Ancient, Felwood
  2859: [{ how: "quest reward", quest: 8996, zones: [1427] }], // Brazier of Invocation: Bodley, Blackrock Mountain
  2786: [{ how: "quest reward", quest: 8228, zones: [1455] }], // Fishing Tournament!: Barrus, Ironforge, whom the DB does not spawn
  ["nc0bf109d-e5d1-494d-ba1b-12a6b27352a8"]: [{ how: "quest reward", quest: 97277, zones: [1426] }], // Gozwin's Mechanic's Log
};

// Types no title, icon or first page gives away, by book id: read off the words or the wiki.
export const TYPE_BY_HAND = {
  15: "letter", // William's Shipment: "Hello Morgan, ..."
  29: "note", // Crate of Horseshoes: "A note is attached to the crate."
  58: "tablet", 62: "tablet", 285: "tablet", 324: "tablet", // the Troll Legends, from stone tablets
  358: "tablet", 359: "tablet", // The Lay and The Fall of Ameth'Aran, tablets in Darkshore's ruins
  73: "journal", // Book from Sven's Farm: Stalvan's diary
  153: "book", 161: "book", 169: "book", 177: "book", // Green Hills chapters, bound
  336: "letter", // Cloth Request: "To the Schneiders, ..."
  439: "letter", // Kravel's Scheme: "Mr. Fizzlebub, the bearer of this letter..."
  711: "letter", // Neeka's Report: "Helgrum, my compliments..."
  794: "book", // Lorgalis Manuscript: a four-page history
  1392: "letter", // Grape Manifest: "Brother Neals, ..."
  1591: "plaque", // Etched Note: a sign on Jordan Stilwell's anvil
  2271: "letter", // Cliffwatcher Longhorn Report: "Nataka, ..."
  2514: "note", // Brock's List: a list of students
  2807: "journal", // Decoded Tablet Transcription: a diary, "Day 1..."
  2838: "letter", // From the Desk of Lord Victor Nefarius: "To Whom It May Concern, ..."
  10322: "note", // Bloody Note: three pages, which would make it a book
  11007: "letter", // Advisor Nazgrel's Instructions: "Elf, As a guest of the Horde, ..."
  ["nc0bf109d-e5d1-494d-ba1b-12a6b27352a8"]: "journal", // Gozwin's Mechanic's Log
  // The soldiers' letters from the Scourge invasion, and the reports the Keeper of the Rolls
  // mails back for them.
  2882: "letter", 2883: "letter", 2884: "letter",
  2885: "letter", 2886: "letter", 2887: "letter", 2888: "letter", 2889: "letter", 2890: "letter",
};

/** The hand-authored fields the Places generator adds to one book record. */
export function handPlace(bookId, sources = SOURCES_BY_HAND[bookId] ?? [], objectZones = []) {
  return {
    kind: "carried",
    type: TYPE_BY_HAND[bookId],
    quests: sources.filter((source) => source.how === "quest reward").map((source) => source.quest),
    zones: sources.flatMap((source) => source.zones ?? (source.object ? objectZones : [])),
  };
}

/** Apply the hand-source wiring used by places.mjs, with database lookups supplied by the caller. */
export function applyHandSources({ sourcesByHand, resolveName, objectZones, add, addQuestReward, kind }) {
  const tableId = (id) => /^\d+$/.test(String(id)) ? Number(id) : id;
  for (const [book, sources] of Object.entries(sourcesByHand)) {
    const bookId = tableId(book);
    for (const source of sources) {
      if (!resolveName(source)) {
        throw new Error(`book ${book}: no ${source.quest ? `quest ${source.quest}` : `object ${source.object}`} in the world DB`);
      }
    }
    const objectZoneList = [...new Set(sources.flatMap((source) => source.object ? [...(objectZones.get(source.object) ?? [])] : []))];
    const hand = handPlace(bookId, sources, objectZoneList);
    add(bookId, hand.zones);
    for (const quest of hand.quests) addQuestReward(bookId, quest);
    if (!kind.has(bookId)) kind.set(bookId, hand.kind);
  }
}
