local _, NPCs = ...

-- Brazilian Portuguese interface strings for Spoken NPCs.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = NPCs.L

if GetLocale() ~= "ptBR" then
	return
end
L.COMPENDIUM_BOSSES = "Chefes"
L.BOSSES_SEARCH = "Buscar chefes"
L.BOSSES_NONE = "Nada encontrado."
L.BOSSES_FOUND_ONLY = "Só encontrados"
L.BOSSES_FOUND_FMT = "%1$d de %2$d encontrados"
L.BOSS_IN_FMT = "Local: %1$s"
L.BOSS_NOT_FOUND = "Você ainda não enfrentou este chefe. Enfrente-o na masmorra ou raide dele para ler a história aqui."
L.GROUP_LANDS = "Outras terras"
