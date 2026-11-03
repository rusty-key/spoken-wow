import { bosses } from "./bosses";
import { places } from "./places";
import { quests } from "./quests";
import { readables } from "./readables";
import type { Section, SectionApi } from "./types";

export { isSection, keyOf } from "./types";

export const sections: Record<Section, SectionApi> = { places, bosses, readables, quests };
