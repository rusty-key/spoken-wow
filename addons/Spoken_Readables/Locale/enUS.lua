local _, SpokenReadables = ...

-- Interface strings for the Spoken Readables options, book-frame buttons and player
-- menu entries, and the key set every other language is measured against.
--
-- FORMAT ARGUMENTS ARE POSITIONAL (%1$s, %2$d), even where there is only one and
-- the position is obvious. Word order is the thing a translator most often has to
-- change and least often can.
--
-- A locale file per language overlays this table (Locale/<code>.lua), so anything
-- missing falls back to English at runtime. Chat and diagnostic prints stay
-- English everywhere, as in the other Spoken addons.

SpokenReadables.L = SpokenReadables.L or {}
local L = SpokenReadables.L

L.OPT_AUTOPLAY = "Read Automatically"
L.OPT_WHOLE_BOOK = "Read Whole Book"
L.OPT_ONE_LINE = "Read Book as One Line"
L.OPT_READ_ONCE = "Read Only Once"
L.OPT_STOP_ON_CLOSE = "Stop When Book Closes"
L.OPT_CLOSE_WHEN_READ = "Close Book When Done Reading"
L.OPT_DOWNLOAD_ADDRESS = "Copy this address into your web browser to download the voice pack."
L.OPT_FORGET = "Forget Readables Heard"
L.OPT_FORGET_DONE_FMT = "Readables forgotten: %1$d. They will be read again."
L.PLAY = "Play"
L.STOP = "Stop"
L.PLAY_TIP = "Read this aloud"
L.STOP_TIP = "Stop reading this"
-- DialogueUI's book view: Play's tooltip (UI/DialogueUIBook.lua).
L.DUI_ON = "On"
L.DUI_OFF = "Off"
L.DUI_PLAY_RIGHT_CLICK = "Right-click to turn Read Automatically on or off."
L.CONTRIBUTE = "Contribute"
L.REPORT = "Report"
L.REPORT_PROBLEM = "Report a Problem"
L.REPORT_LINE_TIP = "Get a link to report a wrong reading, a mispronounced name or narration that does not match the page."
L.REPORT_LINE_ADDRESS = "Copy this address and open it in your browser to report a problem with this page."
L.NO_LINE = "No line for this page"
L.NO_LINE_TIP = "Send your own client's text so it can be added."
L.MENU_BOOK_SETTINGS = "Readables Settings"
L.OPT_NO_PACK_AUDIO = "The installed voice pack has no narration for this page yet."
L.OPT_NO_PACK_INSTALLED = "No Readables voice pack is installed."
L.OPT_PAGE_COUNT_FMT = "Page %1$d of %2$d"

-- The page under Spoken in the game's settings.
L.OPT_PAGE_TITLE = "Readables"
L.OPT_DEV_DEBUG = "Readables Debug Messages"

L.REASON_AUTOPLAY = "Turn on Read Automatically to use this."
L.REASON_READ_ONCE = "Turn on Read Only Once to use this."
L.REASON_WHOLE_BOOK = "Turn on Read Whole Book to use this."
L.OPT_RESET_PAGE_CONFIRM = "Reset every Readables setting to its default?"


-- Azeroth's Compendium: the readables' tab (UI/Readables.lua) and its settings.
L.COMPENDIUM_READABLES = "Readables"
L.READABLES_SEARCH = "Search readables"
L.READABLES_NONE = "Nothing matches."
L.READABLES_FOUND_ONLY = "Found Only"
L.READABLES_VOICED_ONLY = "Voiced Only"
L.TYPE_BOOK = "Books"
L.TYPE_JOURNAL = "Journals and Diaries"
L.TYPE_LETTER = "Letters"
L.TYPE_NOTE = "Notes"
L.TYPE_SCROLL = "Scrolls"
L.TYPE_TABLET = "Tablets and Runes"
L.TYPE_PLAQUE = "Plaques and Signs"
L.TYPE_GRAVE = "Gravestones"
L.TYPE_EXHIBIT = "Exhibits"
L.TYPE_PICTURE = "Pictures and Maps"
L.TYPE_OTHER = "Other"
-- One readable of each kind, over its name in the windows and the subtitle.
L.READABLE_BOOK = "Book"
L.READABLE_JOURNAL = "Journal"
L.READABLE_LETTER = "Letter"
L.READABLE_NOTE = "Note"
L.READABLE_SCROLL = "Scroll"
L.READABLE_TABLET = "Tablet"
L.READABLE_PLAQUE = "Plaque"
L.READABLE_GRAVE = "Gravestone"
L.READABLE_EXHIBIT = "Exhibit"
L.READABLE_PICTURE = "Picture"
L.READABLE_OTHER = "Other"
L.READABLES_BY_ZONE = "By Zone"
L.READABLES_BY_TYPE = "By Type"
L.GROUP_EVENTS = "Holidays and Events"
L.EVENT_WINTER_VEIL = "Feast of Winter Veil"
L.EVENT_HARVEST_FESTIVAL = "Harvest Festival"
L.EVENT_FISHING_EXTRAVAGANZA = "Stranglethorn Fishing Extravaganza"
L.EVENT_SCOURGE_INVASION = "Scourge Invasion"
L.GROUP_WIDE = "Across Azeroth"
L.GROUP_UNKNOWN = "Place Unknown"
L.GROUP_LANDS = "Other Lands"
L.GROUP_BATTLEGROUNDS = "Battlegrounds"
L.GROUP_DUNGEONS = "Dungeons and Raids"
L.READABLE_NOT_FOUND = "You have not found this one yet. Open it in the world to read it here."
L.OPEN_IN_COMPENDIUM = "Open in the Azeroth Compendium"
L.FOUND_FMT = "%1$d of %2$d found"
L.READABLES_IN_FMT = "In %1$s"
L.READABLES_MORE_FMT = " and %1$d more"
L.BOOKS_TITLE_NTH_FMT = "%1$s (%2$d)"
