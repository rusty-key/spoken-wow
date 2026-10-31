local _, Bosses = ...

-- Simplified Chinese interface strings for Spoken Bosses.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = Bosses.L

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
L.OPT_RESET_PAGE_CONFIRM = "将所有首领设置恢复为默认值？"
L.OPT_FORGET_STORIES = "忘记已显示的剧情"
L.OPT_FORGET_STORIES_DONE_FMT = "已忘记 %1$d 段剧情，之后会重新显示。"
L.OPT_DOWNLOAD_ADDRESS = "将此地址复制到浏览器中以下载语音包。"
L.PART_ABOUT = "击杀首领时，在旁白中显示其剧情。"
