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
L.OPT_PAGE_TITLE = "Chefes"
L.OPT_SHOW_ABILITIES = "Mostrar habilidades dos chefes"
L.OPT_RESET_PAGE_CONFIRM = "Voltar todas as configurações de Chefes ao padrão?"
L.OPT_STORY_TRIGGER = "Mostrar a história de um chefe"
L.OPT_TRIGGER_TARGET = "Ao selecioná-lo"
L.OPT_TRIGGER_KILL = "Ao derrotá-lo"
L.OPT_FORGET_STORIES = "Esquecer histórias mostradas"
L.OPT_FORGET_STORIES_DONE_FMT = "Histórias esquecidas: %1$d. Serão mostradas de novo."
L.PART_ABOUT = "A história de um chefe, no narrador, ao selecioná-lo ou derrotá-lo."
