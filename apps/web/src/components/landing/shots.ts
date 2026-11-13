export type GalleryItem = {
  title: string;
  text: string;
  /** The picture, a file under public/landing/gallery. */
  src: string;
  /** A small copy for the row of buttons. */
  thumb: string;
  alt: string;
};

/** What the gallery shows. To add a shot, drop the files into public/landing/gallery and add an item. */
export const GALLERY: GalleryItem[] = [
  {
    title: "Place story",
    text: "The Place Story panel beside the map, here for Go'Shek Farm, with its picture and story. Buttons open the Compendium, play the story and report it.",
    src: "/landing/gallery/place-story-map.webp",
    thumb: "/landing/gallery/place-story-map-thumb.png",
    alt: "The world map open on Go'Shek Farm, with its Place Story panel beside it",
  },
  {
    title: "Zones on the map",
    text: "A zone has a story and a picture too. Arathi Highlands also shows how many of its 19 places have been discovered.",
    src: "/landing/gallery/map-and-story.webp",
    thumb: "/landing/gallery/map-and-story-thumb.png",
    alt: "The Arathi Highlands map with the Place Story panel showing its picture and lore",
  },
  {
    title: "Dark look",
    text: "The Place Story panel in the dark look, telling the story of Azeroth beside the world map.",
    src: "/landing/gallery/world-map-dark.webp",
    thumb: "/landing/gallery/world-map-dark-thumb.png",
    alt: "The world map with a dark Place Story panel telling the story of Azeroth",
  },
  {
    title: "Narrator on parchment",
    text: "A place story in the narrator window, with its picture. The word being read is marked in red, with Stop, Skip and Report buttons.",
    src: "/landing/gallery/place-story.webp",
    thumb: "/landing/gallery/place-story-thumb.png",
    alt: "A parchment panel for Teldrassil showing a picture and the first lines of its story",
  },
  {
    title: "Compendium: Places",
    text: "Azeroth's Compendium lists places by continent and zone, with how many are discovered, and plays any story without going there.",
    src: "/landing/gallery/compendium-places.webp",
    thumb: "/landing/gallery/compendium-places-thumb.png",
    alt: "The Compendium's Places tab showing the story of Shadowglen with its picture",
  },
  {
    title: "Compendium: Quests",
    text: "A quest with the text of its description and its completion, and a Play button for each.",
    src: "/landing/gallery/compendium-quests.webp",
    thumb: "/landing/gallery/compendium-quests-thumb.png",
    alt: "The Compendium's Quests tab showing the quest Rescue OOX-09/HL with its text",
  },
  {
    title: "Compendium, dark look",
    text: "The Compendium in the dark look, here on the quest Jitters' Growling Gut.",
    src: "/landing/gallery/compendium-quests-dark.webp",
    thumb: "/landing/gallery/compendium-quests-dark-thumb.png",
    alt: "The Compendium in a dark look showing the quest Jitters' Growling Gut",
  },
  {
    title: "Compendium: Readables",
    text: "Books, journals, letters, notes and scrolls, listed by name and kind. Here, Lonebrow's Journal.",
    src: "/landing/gallery/compendium-readables.webp",
    thumb: "/landing/gallery/compendium-readables-thumb.png",
    alt: "The Compendium's Readables tab showing Lorenbrow's Journal",
  },
  {
    title: "DialogueUI: Parchment",
    text: "A journal page read in the DialogueUI narrator style, on its Parchment theme. The word being read is marked in red.",
    src: "/landing/gallery/journal-page.webp",
    thumb: "/landing/gallery/journal-page-thumb.png",
    alt: "A Faded Journal Page with its text and playback buttons, one word marked in red",
  },
  {
    title: "DialogueUI: Dark",
    text: "A tablet read in the DialogueUI narrator style, on its Dark theme. The word being read is marked in gold.",
    src: "/landing/gallery/tablet.webp",
    thumb: "/landing/gallery/tablet-thumb.png",
    alt: "An Ancient Tablet with its text and playback buttons, one word highlighted in gold",
  },
];
