-- ruRU. Russian interface strings for Spoken Places.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, SpokenZones = ...

if GetLocale() ~= "ruRU" then
	return
end

local L = {}

L.OPT_SECTION_MAP = "Истории"
L.OPT_MAP_PANEL = "История у карты"
L.OPT_PICTURES = "Показывать картинки"
L.OPT_MAP_HIGHLIGHT = "Подсветка областей"
L.OPT_PANEL_WIDTH = "Ширина истории"
L.OPT_PLAY_BUTTON = "Читать истории вслух"
L.OPT_AUTOPLAY = "Читать автоматически"
L.OPT_AUTOPLAY_SUB = "Включать малые области"
L.OPT_AUTOPLAY_EXPLORED = "Включать места, открытые раньше"
L.OPT_AUTOPLAY_EXPLORED_TIP = "Читает о каждом месте один раз для каждого персонажа, даже если оно открыто раньше."
L.OPT_FLIGHT_LORE = "Читать о цели полёта"
L.OPT_FLIGHT_LORE_TIP = "Во время полёта читает историю зоны, где он закончится. При посадке она не читается повторно, а места, над которыми вы пролетаете, не читаются."
L.OPT_LANG_RELOAD = "Введите /reload, чтобы переключиться на него."
L.OPT_LANGUAGE = "Язык текста"
L.OPT_LANGUAGE_TIP = "Текст историй; голос следует языку озвучки."
L.OPT_LANG_AUTO_FMT = "Авто (%1$s)"
L.OPT_LANG_SET_FMT = "После перезагрузки интерфейса истории будут на языке: %1$s."
L.OPT_LANG_PROFILE_FMT = "Этот профиль читает истории на языке: %1$s. Введите /reload, чтобы переключиться."
L.OPT_REPORT_PROBLEM = "Сообщить о проблеме"
L.MENU_LORE_WINDOW = "Открыть Компендиум"
L.MENU_ZONE_SETTINGS = "Настройки раздела «Места»"

L.OPT_REPORT_LINE_TIP = "Получить ссылку, чтобы сообщить о неверной истории, неверном чтении или неправильно произнесённом имени."
L.OPT_REPORT_LINE_ADDRESS = "Скопируйте этот адрес и откройте его в браузере, чтобы сообщить о проблеме с этой записью."

L.AUDIO_READ_TIP = "Прослушать эту историю."
L.REPORT_BUTTON = "Сообщить"
L.IN_ZONE_FMT = "Расположение: %1$s"
L.DISCOVERED_FMT = "Открыто %1$d из %2$d"

L.QUEUE_HELD_COMBAT = "Ожидание конца боя."
L.QUEUE_HELD_CINEMATIC = "Ожидание конца ролика."
L.QUEUE_HELD_OFF = "Озвучка выключена."
L.NOT_DISCOVERED = "Вы ещё не открыли это место. Побывайте там, чтобы прочитать его историю."
L.MAP_LORE_FOR_FMT = "история: %1$s"
L.CMD_HEADING = "команды (/spokenplaces или /spp):"
L.CMD_STATUS = "  /spp            -- статус текущей зоны и области"
L.CMD_DIAGNOSTICS = "  /spp diagnostics -- Показать диагностику"
L.CMD_OPTIONS = "  /spp settings   -- страница «Места» в настройках"
L.CMD_WINDOW = "  /spp window     -- открывает «Компендиум Азерота»"
L.CMD_PANEL = "  /spp panel      -- «История у карты»: вкл. или выкл."
L.CMD_PLAY = "  /spp play       -- читает историю места, где вы находитесь"
L.CMD_STOP = "  /spp stop       -- останавливает чтение"
L.CMD_VOICE = "  /spp voice      -- «Читать истории вслух»: вкл. или выкл."
L.CMD_AUTOPLAY = "  /spp autoplay   -- «Читать автоматически»: вкл. или выкл."
L.CMD_AUDIO = "  /spp audio      -- установленные пакеты озвучки"
L.CMD_LANG = "  /spp lang       -- Язык текста: список или смена через /spp lang <code> или auto"
L.CMD_FORGET = "  /spp forget     -- Забыть услышанные места"


-- Added for Lore of Azeroth, Zone Lore, voice packs and the settings page.
L.REASON_VOICE = "Включите «Читать истории вслух», чтобы пользоваться этим."
L.OPT_FORGET_PLACES = "Забыть услышанные места"
L.OPT_FORGET_PLACES_DONE = "Список услышанных мест этого персонажа очищен."
L.OPT_DOWNLOAD_ADDRESS = "Скопируйте этот адрес в браузер, чтобы скачать пакет озвучки."
L.OPEN_IN_LORE_TIP = "История этого места в «Компендиуме Азерота», рядом с историями всех других зон и областей."
L.OTHER_LANDS = "Другие земли"
L.BATTLEGROUNDS = "Поля боя"
L.DUNGEONS = "Подземелья и рейды"
L.COMPENDIUM_PLACES = "Места"
L.LORE_PANEL_TITLE = "История места"
L.MAP_PANEL_EXPAND = "Показать историю места"
L.PANEL_SHOWN = "История у карты: вкл."
L.PANEL_HIDDEN = "История у карты: выкл."
L.LORE_SEARCH = "Поиск мест"
L.LORE_DISCOVERED_ONLY = "Только открытые"
L.LORE_VOICED_ONLY = "Только озвученные"
L.LORE_SEARCH_NONE = "Ничего не найдено."
L.REASON_DISCOVERY = "Включите «Читать автоматически», чтобы пользоваться этим."
L.REASON_MAP_PANEL = "Включите «История у карты», чтобы пользоваться этим."
L.OPT_RESET_PAGE_CONFIRM = "Вернуть все настройки мест к значениям по умолчанию?"
L.OPT_RELOAD_NOW = "Перезагрузить сейчас"
L.OPT_LATER = "Позже"
L.OPT_PAGE_TITLE = "Места"
L.OPT_DEV_DEBUG = "Отладка: Места"
L.OPT_DEV_PREVIEW = "Незаконченные переводы"

L.OPEN_IN_COMPENDIUM = "Открыть в «Компендиуме Азерота»"

SpokenZones:RegisterStrings("ruRU", L)
