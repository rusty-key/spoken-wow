export type GalleryItem = {
  /** The picture, a file under public/landing/gallery. */
  src: string;
  /** A small copy for the row of buttons. */
  thumb: string;
};

/**
 * What the gallery shows, in order. A picture's title, caption and alt text are the dictionaries'
 * gallery item at the same position, so that every language describes the same shot.
 */
export const GALLERY: GalleryItem[] = [
  { src: "/landing/gallery/place-story-map.webp", thumb: "/landing/gallery/place-story-map-thumb.png" },
  { src: "/landing/gallery/map-and-story.webp", thumb: "/landing/gallery/map-and-story-thumb.png" },
  { src: "/landing/gallery/world-map-dark.webp", thumb: "/landing/gallery/world-map-dark-thumb.png" },
  { src: "/landing/gallery/place-story.webp", thumb: "/landing/gallery/place-story-thumb.png" },
  { src: "/landing/gallery/compendium-places.webp", thumb: "/landing/gallery/compendium-places-thumb.png" },
  { src: "/landing/gallery/compendium-quests.webp", thumb: "/landing/gallery/compendium-quests-thumb.png" },
  { src: "/landing/gallery/compendium-quests-dark.webp", thumb: "/landing/gallery/compendium-quests-dark-thumb.png" },
  { src: "/landing/gallery/compendium-readables.webp", thumb: "/landing/gallery/compendium-readables-thumb.png" },
  { src: "/landing/gallery/journal-page.webp", thumb: "/landing/gallery/journal-page-thumb.png" },
  { src: "/landing/gallery/tablet.webp", thumb: "/landing/gallery/tablet-thumb.png" },
];
