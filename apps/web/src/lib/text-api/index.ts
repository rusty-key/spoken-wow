import { bosses } from "./bosses";
import { places } from "./places";
import { quests } from "./quests";
import { readables } from "./readables";
import type { Source } from "@/lib/sections";

import type { SectionApi } from "./types";

export const sections: Record<Source, SectionApi> = { places, bosses, readables, quests };
