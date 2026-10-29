-- zhTW. Traditional Chinese interface strings for Spoken Places.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, SpokenPlaces = ...

if GetLocale() ~= "zhTW" then
	return
end

local L = {}

L.OPT_SECTION_MAP = "故事"
L.OPT_MAP_PANEL = "在地圖旁顯示故事"
L.OPT_PICTURES = "顯示圖片"
L.OPT_MAP_HIGHLIGHT = "區域醒目顯示"
L.OPT_PANEL_WIDTH = "故事面板寬度"
L.OPT_PLAY_BUTTON = "朗讀故事"
L.OPT_AUTOPLAY = "自動朗讀"
L.OPT_AUTOPLAY_SUB = "包含較小區域"
L.OPT_AUTOPLAY_EXPLORED = "包含先前找到的地方"
L.OPT_LANG_RELOAD = "輸入 /reload 即可切換。"
L.OPT_LANGUAGE = "文字語言"
L.OPT_LANG_AUTO_FMT = "自動（%1$s）"
L.OPT_LANG_SET_FMT = "介面重新載入後，故事將以%1$s顯示。"
L.OPT_LANG_PROFILE_FMT = "此設定檔將以%1$s朗讀故事。輸入 /reload 即可切換。"
L.OPT_REPORT_PROBLEM = "回報問題"
L.MENU_LORE_WINDOW = "開啟艾澤拉斯百科"
L.MENU_ZONE_SETTINGS = "地點設定"

L.OPT_REPORT_LINE_ADDRESS = "複製此位址並在瀏覽器中開啟，以回報該條目的問題。"

L.REPORT_BUTTON = "回報"
L.IN_ZONE_FMT = "位於%1$s"
L.DISCOVERED_FMT = "已發現 %1$d / %2$d"
L.ZONE_COUNT_FMT = "%1$d 個地區"
L.ZONE_COUNT_ONE = "1 個地區"
L.CONTINENT_COUNT_FMT = "%1$d 塊大陸"
L.CONTINENT_COUNT_ONE = "1 塊大陸"

L.QUEUE_HELD_COMBAT = "等待戰鬥結束。"
L.QUEUE_HELD_CINEMATIC = "等待過場動畫結束。"
L.QUEUE_HELD_OFF = "旁白已關閉。"
L.NOT_DISCOVERED = "你還沒有發現這個地點。前往那裡即可閱讀它的故事。"
L.MAP_LORE_FOR_FMT = "%1$s的故事"
L.CMD_HEADING = "命令（/spokenplaces 或 /spp）："
L.CMD_STATUS = "  /spp            -- 目前地區和區域狀態"
L.CMD_DIAGNOSTICS = "  /spp diagnostics -- 顯示診斷"
L.CMD_OPTIONS = "  /spp settings   -- 設定中的「地點」頁面"
L.CMD_WINDOW = "  /spp window     -- 開啟艾澤拉斯百科"
L.CMD_PANEL = "  /spp panel      -- 「在地圖旁顯示故事」開/關"
L.CMD_PLAY = "  /spp play       -- 朗讀你所在地方的故事"
L.CMD_STOP = "  /spp stop       -- 停止朗讀"
L.CMD_VOICE = "  /spp voice      -- 「朗讀故事」開/關"
L.CMD_AUTOPLAY = "  /spp autoplay   -- 「自動朗讀」開/關"
L.CMD_AUDIO = "  /spp audio      -- 已安裝的語音包"
L.CMD_LANG = "  /spp lang       -- 文字語言：列出，或用 /spp lang <代碼> 或 auto 切換"
L.CMD_FORGET = "  /spp forget     -- 忘記已聽過的地方"


-- Added in this release: subtitles, profiles, module pages and windows.
L.REASON_VOICE = "開啟「朗讀故事」才能使用。"
L.OPT_FORGET_PLACES = "忘記已聽過的地方"
L.OPT_FORGET_PLACES_DONE = "已清除此角色已聽過的地方清單。"
L.OPT_DOWNLOAD_ADDRESS = "將此位址複製到網頁瀏覽器以下載語音包。"
L.OTHER_LANDS = "其他地區"
L.BATTLEGROUNDS = "戰場"
L.DUNGEONS = "地城與團隊副本"
L.COMPENDIUM_PLACES = "地點"
L.LORE_PANEL_TITLE = "地點故事"
L.MAP_PANEL_EXPAND = "顯示地點故事"
L.PANEL_SHOWN = "在地圖旁顯示故事：開啟"
L.PANEL_HIDDEN = "在地圖旁顯示故事：關閉"
L.LORE_SEARCH = "搜尋地點"
L.LORE_DISCOVERED_ONLY = "僅顯示已發現的"
L.LORE_VOICED_ONLY = "僅顯示有語音的"
L.LORE_SEARCH_NONE = "沒有符合的結果。"
L.REASON_DISCOVERY = "開啟「自動朗讀」才能使用。"
L.REASON_MAP_PANEL = "開啟「在地圖旁顯示故事」才能使用。"
L.OPT_RESET_PAGE_CONFIRM = "要將所有地點設定恢復為預設值嗎？"
L.OPT_RELOAD_NOW = "立即重新載入"
L.OPT_LATER = "稍後"
L.OPT_PAGE_TITLE = "地點"
L.OPT_DEV_DEBUG = "地點除錯訊息"
L.OPT_DEV_PREVIEW = "提供未完成的翻譯"

L.OPEN_IN_COMPENDIUM = "在艾澤拉斯百科中開啟"

SpokenPlaces:RegisterStrings("zhTW", L)
