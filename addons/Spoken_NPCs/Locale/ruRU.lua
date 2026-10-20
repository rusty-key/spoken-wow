local _, NPCs = ...

-- Russian interface strings for Spoken NPCs.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = NPCs.L

if GetLocale() ~= "ruRU" then
	return
end
L.COMPENDIUM_BOSSES = "Боссы"
L.BOSSES_SEARCH = "Поиск боссов"
L.BOSSES_NONE = "Ничего не найдено."
L.BOSSES_FOUND_ONLY = "Только найденные"
L.BOSSES_FOUND_FMT = "Найдено %1$d из %2$d"
L.BOSS_IN_FMT = "Расположение: %1$s"
L.BOSS_NOT_FOUND = "Вы ещё не встречали этого босса. Сразитесь с ним в подземелье или рейде, чтобы прочитать его историю здесь."
L.GROUP_LANDS = "Другие земли"
L.OPT_PAGE_TITLE = "Боссы"
L.OPT_SHOW_ABILITIES = "Показывать способности боссов"
L.OPT_RESET_PAGE_CONFIRM = "Вернуть все настройки раздела «Боссы» к значениям по умолчанию?"
L.OPT_STORY_TRIGGER = "Показывать историю босса"
L.OPT_TRIGGER_TARGET = "При выборе цели"
L.OPT_TRIGGER_KILL = "При убийстве"
L.OPT_FORGET_STORIES = "Забыть показанные истории"
L.OPT_FORGET_STORIES_DONE_FMT = "Забыто историй: %1$d. Они будут показаны снова."
L.PART_ABOUT = "История босса в окне рассказчика, когда вы выбираете его целью или убиваете."
