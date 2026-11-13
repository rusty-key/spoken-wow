/**
 * The creature types (CreatureType.db2) whose creatures are read by the generic `creature`
 * type when their body names no race: animals and things, not characters. Elementals,
 * mechanicals, undead, demons, dragonkin and giants are left alone -- they often speak in
 * character, and a moderator answers for them.
 *
 * The envelope carries UnitCreatureType, which is the client's localized name, not an id.
 * So each type is listed by every name it has, from wago.tools on 2026-10-11: every locale
 * of the wow, wow_classic, wow_classic_era, wow_anniversary and wow_classic_titan branches.
 * Branches name some types differently (Era's German critter is "Tier", retail's
 * "Kleintier"), and across all of them no name belongs to two types.
 */
const GENERIC_CREATURE_TYPES: Record<string, readonly string[]> = {
  beast: ["Beast", "Bestia", "Bête", "Fera", "Wildtier", "Животное", "野兽", "野獸", "야수"],
  critter: [
    "Alimaña", "Animale", "Bestiole", "Bicho", "Critter", "Kleintier", "Tier", "Зверек", "Существо",
    "小动物", "小動物", "동물",
  ],
  totem: ["Totem", "Tótem", "Тотем", "图腾", "圖騰", "토템"],
  pet: [
    "Familier pacifique", "Haustier", "Mascota mansa", "Mascote", "Mascotte", "Mascotte pacifique",
    "Non-combat Pet", "Спутник", "非战斗宠物", "非戰鬥寵物", "애완동물",
  ],
  gasCloud: [
    "Gas Cloud", "Gaswolke", "Nuage de gaz", "Nube de gas", "Nuvem de Gás", "Nuvola di Gas",
    "Облако газа", "气体云雾", "氣體雲", "가스", "가스 구름",
  ],
  wildPet: [
    "Mascota salvaje", "Mascote Selvagem", "Mascotte Selvatica", "Mascotte sauvage", "Ungezähmtes Tier",
    "Wild Pet", "Дикий питомец", "野生宠物", "野生寵物", "야생 애완동물",
  ],
};

const GENERIC_NAMES = new Set(Object.values(GENERIC_CREATURE_TYPES).flat());

/** Whether a creature of this type, in any client's language, is read as a generic creature. */
export function isGenericCreatureType(creatureType: string | null): boolean {
  return creatureType !== null && GENERIC_NAMES.has(creatureType.trim());
}
