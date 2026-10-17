-- zhCN. Simplified Chinese interface strings for Spoken Places.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, SpokenZones = ...

if GetLocale() ~= "zhCN" then
	return
end

local L = {}

L.OPT_SECTION_MAP = "剧情"
L.OPT_MAP_PANEL = "在地图旁显示剧情"
L.OPT_PICTURES = "显示图片"
L.OPT_MAP_HIGHLIGHT = "区域高亮"
L.OPT_PANEL_WIDTH = "剧情面板宽度"
L.OPT_PLAY_BUTTON = "朗读剧情"
L.OPT_AUTOPLAY = "自动朗读"
L.OPT_AUTOPLAY_SUB = "包括次级地区"
L.OPT_AUTOPLAY_EXPLORED = "包括以前发现的地方"
L.OPT_LANG_RELOAD = "输入 /reload 即可切换。"
L.OPT_LANGUAGE = "文本语言"
L.OPT_LANG_AUTO_FMT = "自动（%1$s）"
L.OPT_LANG_SET_FMT = "界面重新载入后，剧情将使用%1$s。"
L.OPT_LANG_PROFILE_FMT = "此配置文件将以%1$s朗读剧情。输入 /reload 即可切换。"
L.OPT_REPORT_PROBLEM = "报告问题"
L.MENU_LORE_WINDOW = "打开艾泽拉斯百科"
L.MENU_ZONE_SETTINGS = "地点设置"

L.OPT_REPORT_LINE_TIP = "获取链接，报告剧情有误、朗读错误或名字念错。"
L.OPT_REPORT_LINE_ADDRESS = "复制此地址并在浏览器中打开，以报告该条目的问题。"

L.AUDIO_READ_TIP = "收听这段剧情的朗读"
L.REPORT_BUTTON = "报告"
L.CONTRIBUTE_BUTTON = "贡献"
L.CONTRIBUTE_BUTTON_TIP_TITLE = "Spoken Places 还没有这个地方的剧情"
L.CONTRIBUTE_BUTTON_TIP = "描述它来做贡献：它是什么，谁住在那里，那里发生过什么。"
L.IN_ZONE_FMT = "位于%1$s"
L.DISCOVERED_FMT = "已发现 %1$d / %2$d"

L.QUEUE_HELD_COMBAT = "等待战斗结束。"
L.QUEUE_HELD_CINEMATIC = "等待过场动画结束。"
L.QUEUE_HELD_OFF = "旁白已关闭。"
L.NO_LORE_FOR = "尚无%1$s的相关剧情。"
L.LORE_NOT_WRITTEN = "%1$s在地图上，但还没有人写下它的剧情。"
L.NOT_DISCOVERED = "你还没有发现这个地点。前往那里即可阅读它的剧情。"
L.MAP_LORE_FOR_FMT = "%1$s的剧情"
L.CMD_HEADING = "命令（/spokenplaces 或 /spp）："
L.CMD_STATUS = "  /spp            -- 当前地区和次级地区状态"
L.CMD_DIAGNOSTICS = "  /spp diagnostics -- 显示诊断"
L.CMD_OPTIONS = "  /spp settings   -- 设置中的“地点”页面"
L.CMD_WINDOW = "  /spp window     -- 打开艾泽拉斯百科"
L.CMD_PANEL = "  /spp panel      -- “在地图旁显示剧情”开/关"
L.CMD_PLAY = "  /spp play       -- 朗读你所在地方的剧情"
L.CMD_STOP = "  /spp stop       -- 停止朗读"
L.CMD_VOICE = "  /spp voice      -- “朗读剧情”开/关"
L.CMD_AUTOPLAY = "  /spp autoplay   -- “自动朗读”开/关"
L.CMD_AUDIO = "  /spp audio      -- 已安装的语音包"
L.CMD_LANG = "  /spp lang       -- 文本语言：列出，或用 /spp lang <代码> 或 auto 切换"
L.CMD_FORGET = "  /spp forget     -- 忘记已听过的地方"


-- Added in this release: new settings, profiles, module pages and windows.
L.REASON_VOICE = "开启“大声朗读剧情”后才能使用。"
L.OPT_FORGET_PLACES = "忘记已听过的地方"
L.OPT_FORGET_PLACES_DONE = "已清除此角色已听过的地方列表。"
L.OPT_DOWNLOAD_ADDRESS = "将此地址复制到浏览器中以下载语音包。"
L.OPEN_IN_LORE_TIP = "在艾泽拉斯百科中查看此地的剧情，以及其他所有地区和次级地区的剧情。"
L.OTHER_LANDS = "其他地区"
L.BATTLEGROUNDS = "战场"
L.DUNGEONS = "地下城与团队副本"
L.ZONES_PICK = "在左侧选择一个地区来阅读它的剧情。按住 Shift 点击某个区域，可将它的剧情排入队列，在正在播放的内容之后播放。"
L.DUNGEONS_PICK = "在左侧选择一个地下城或团队副本来阅读它的剧情。按住 Shift 点击，可将它的剧情排入队列，在正在播放的内容之后播放。"
L.COMPENDIUM_PLACES = "地点"
L.LORE_PANEL_TITLE = "地点传说"
L.MAP_PANEL_EXPAND = "显示地点传说"
L.PANEL_SHOWN = "在地图旁显示剧情：开启"
L.PANEL_HIDDEN = "在地图旁显示剧情：关闭"
L.LORE_SEARCH = "搜索地点"
L.LORE_DISCOVERED_ONLY = "仅显示已发现的"
L.LORE_VOICED_ONLY = "仅显示有语音的"
L.LORE_SEARCH_NONE = "没有匹配的结果。"
L.REASON_DISCOVERY = "开启“自动朗读”后才能使用。"
L.REASON_MAP_PANEL = "开启“在地图旁显示剧情”后才能使用。"
L.OPT_RESET_PAGE_CONFIRM = "将所有地点设置恢复为默认值？"
L.OPT_RELOAD_NOW = "立即重新载入"
L.OPT_LATER = "稍后"
L.OPT_PAGE_TITLE = "地点"
L.OPT_DEV_DEBUG = "地点调试信息"
L.OPT_DEV_PREVIEW = "提供未完成的翻译"

L.OPEN_IN_COMPENDIUM = "在艾泽拉斯百科中打开"

SpokenZones:RegisterStrings("zhCN", L)
