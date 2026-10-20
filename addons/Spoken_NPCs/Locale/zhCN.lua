local _, NPCs = ...

-- Simplified Chinese interface strings for Spoken NPCs.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = NPCs.L

if GetLocale() ~= "zhCN" then
	return
end
L.COMPENDIUM_BOSSES = "首领"
L.BOSSES_SEARCH = "搜索首领"
L.BOSSES_NONE = "没有匹配的结果。"
L.BOSSES_FOUND_ONLY = "仅显示已找到的"
L.BOSSES_FOUND_FMT = "已找到 %1$d / %2$d"
L.BOSS_IN_FMT = "位于%1$s"
L.BOSS_NOT_FOUND = "你还没有遇到这名首领。在其地下城或团队副本中与之战斗后，即可在此阅读其剧情。"
L.GROUP_LANDS = "其他地区"
L.OPT_PAGE_TITLE = "首领"
L.OPT_SHOW_ABILITIES = "显示首领技能"
L.OPT_RESET_PAGE_CONFIRM = "将所有首领设置恢复为默认值？"
