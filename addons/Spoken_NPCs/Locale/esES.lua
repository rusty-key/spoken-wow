local _, NPCs = ...

-- Spanish interface strings for Spoken NPCs.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = NPCs.L

-- esMX shares this file: nothing in these strings varies by region.
local locale = GetLocale()
if locale ~= "esES" and locale ~= "esMX" then
	return
end
L.COMPENDIUM_BOSSES = "Jefes"
L.BOSSES_SEARCH = "Buscar jefes"
L.BOSSES_NONE = "No hay coincidencias."
L.BOSSES_FOUND_ONLY = "Solo encontrados"
L.BOSSES_FOUND_FMT = "%1$d de %2$d encontrados"
L.BOSS_IN_FMT = "Ubicación: %1$s"
L.BOSS_NOT_FOUND = "Aún no te has enfrentado a este jefe. Enfréntate a él en su mazmorra o banda para leer su historia aquí."
L.GROUP_LANDS = "Otras tierras"
L.OPT_PAGE_TITLE = "Jefes"
L.OPT_RESET_PAGE_CONFIRM = "¿Restablecer todos los ajustes de Jefes a su valor predeterminado?"
L.OPT_STORY_TRIGGER = "Mostrar la historia de un jefe"
L.OPT_TRIGGER_TARGET = "Al seleccionarlo"
L.OPT_TRIGGER_KILL = "Al derrotarlo"
L.OPT_FORGET_STORIES = "Olvidar historias mostradas"
L.OPT_FORGET_STORIES_DONE_FMT = "Historias olvidadas: %1$d. Se volverán a mostrar."
L.PART_ABOUT = "La historia de un jefe, en el narrador, al seleccionarlo o derrotarlo."
