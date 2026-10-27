local _, NPCs = ...

-- Traditional Chinese interface strings for Spoken NPCs.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = NPCs.L

if GetLocale() ~= "zhTW" then
	return
end
L.COMPENDIUM_BOSSES = "首領"
L.BOSSES_SEARCH = "搜尋首領"
L.BOSSES_NONE = "沒有符合的結果。"
L.BOSSES_FOUND_ONLY = "僅顯示已找到的"
L.BOSSES_FOUND_FMT = "已找到 %1$d / %2$d"
L.BOSS_IN_FMT = "位於%1$s"
L.BOSS_NOT_FOUND = "你還沒有遇到這名首領。在其地城或團隊副本中與之戰鬥後，即可在此閱讀其故事。"
L.GROUP_LANDS = "其他地區"
L.OPT_PAGE_TITLE = "首領"
L.OPT_RESET_PAGE_CONFIRM = "要將所有首領設定恢復為預設值嗎？"
L.OPT_FORGET_STORIES = "忘記已顯示的故事"
L.OPT_FORGET_STORIES_DONE_FMT = "已忘記 %1$d 段故事，之後會重新顯示。"
L.PART_ABOUT = "擊殺首領時，在旁白中顯示其故事。"
