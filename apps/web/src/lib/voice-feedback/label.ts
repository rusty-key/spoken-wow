const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** `orc-male-shady` reads Orc · Male · Shady, on /listen and in the emails. */
export const slotLabel = (slot: string): string => slot.split("-").map(capital).join(" · ");
