local _, NPCs = ...

-- Spanish interface strings for Spoken NPCs.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = NPCs.L

if GetLocale() ~= "esES" then
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
