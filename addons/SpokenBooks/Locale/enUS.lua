local _, SpokenBooks = ...

-- Interface strings for the Spoken Books options, book-frame buttons and player
-- menu entries, and the key set every other language is measured against.
--
-- FORMAT ARGUMENTS ARE POSITIONAL (%1$s, %2$d), even where there is only one and
-- the position is obvious. Word order is the thing a translator most often has to
-- change and least often can.
--
-- A locale file per language overlays this table (Locale/<code>.lua), so anything
-- missing falls back to English at runtime. Chat and diagnostic prints stay
-- English everywhere, as in the other Spoken addons.

SpokenBooks.L = SpokenBooks.L or {}
local L = SpokenBooks.L

L.OPT_NOTE = "Books, letters, notes and plaques, read aloud when you open them."
L.OPT_SECTION_READING = "When to Read"
L.OPT_AUTOPLAY = "Read Automatically"
L.OPT_AUTOPLAY_TIP = "Reads a book or letter as soon as it opens. Off, nothing starts by itself: press Play on the page, or type /spb read."
L.OPT_WHOLE_BOOK = "Read Whole Book"
L.OPT_WHOLE_BOOK_TIP = "Reads every page, not only the one on screen. Opening the first page lines up the rest, so the voice reads on while you turn the pages."
L.OPT_READ_ONCE = "Read Only Once"
L.OPT_READ_ONCE_TIP = "Something this character has already heard is not read again when you open it. Play still works."
L.OPT_SECTION_LANGUAGE = "Language"
L.OPT_SECTION_PACKS = "Voice Packs"
L.OPT_SECTION_TROUBLE = "Fix a Problem"
L.OPT_TEST_LINE = "Play a Test Line"
L.OPT_TEST_LINE_TIP = "Plays a page from your voice pack, the same way a real one plays, to check that you can hear it."
L.OPT_DIAGNOSTICS = "Show Diagnostics"
L.OPT_DIAGNOSTICS_TIP = "Lists the voice packs, settings and books read on this character in chat, for a bug report."
L.OPT_REPORT_PROBLEM = "Report a Problem"
L.OPT_REPORT_PROBLEM_TIP = "For anything that isn't about one page; each page has its own Report button. Gives you an address to copy into your web browser."
L.OPT_REPORT_ADDRESS = "Copy this address into your web browser to tell us about the problem."
L.OPT_STOP_ON_CLOSE = "Stop When Book Closes"
L.OPT_STOP_ON_CLOSE_TIP = "Stops the voice as soon as you close the book, letter or plaque. Off, it reads on after you close it."
L.OPT_PACK_NAME_FMT = "Voice Pack (%1$s)"
L.OPT_PACK_OFFICIAL = "Readables"
L.OPT_PACK_INSTALLED = "Installed"
L.OPT_DOWNLOAD = "Download"
L.OPT_DOWNLOAD_TIP = "Shows the address to copy into your web browser."
L.OPT_DOWNLOAD_ADDRESS = "Copy this address into your web browser to download the voice pack."
L.OPT_VOICE_LANGUAGE = "Voice Language"
L.OPT_VOICE_LANGUAGE_TIP = "Which language the voice reads in. Auto uses your game's language. A language is only heard if its voice pack is installed."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "If a Page Is Missing"
L.OPT_FALLBACK_LANGUAGE_TIP = "What to read when the voice pack in your language has no recording of a page: the same page in another language, or nothing."
L.OPT_FALLBACK_NONE = "Stay Silent"
L.OPT_SECTION_READ = "Reading History"
L.OPT_FORGET = "Forget What Was Read"
L.OPT_FORGET_DONE_FMT = "forgot %1$d book%2$s; they will be read again"
L.OPT_FORGET_TIP = "Clears this character's list of what it has heard, so everything is read again. Only matters while Read Only Once is on."
L.PLAY = "Play"
L.STOP = "Stop"
L.PLAY_TIP = "Read this book aloud"
L.STOP_TIP = "Stop reading this book"
L.CONTRIBUTE = "Contribute"
L.REPORT = "Report"
L.NO_LINE = "No line for this page"
L.NO_LINE_TIP = "Send your own client's text so it can be added."
L.MENU_BOOK_SETTINGS = "Readables Settings"
L.OPT_NO_PACK_AUDIO = "The installed voice pack has no narration for this page yet."
L.OPT_NO_PACK_INSTALLED = "No Readables voice pack is installed."
L.OPT_PAGE_COUNT_FMT = "Page %1$d of %2$d"

-- The page under Spoken in the game's settings.
L.OPT_PAGE_TITLE = "Readables"

L.OPT_PART_SWITCH = "Enable Module"
L.OPT_PART_SWITCH_TIP = "Turns reading books, letters, notes and plaques on or off. Off, the module stays installed but reads nothing. The same switch is on the Spoken page."
L.REASON_PART_OFF = "Turn on Enable Module at the top of this page to use this."
L.REASON_AUTOPLAY = "Turn on Read Automatically to use this."
L.OPT_RESET_PAGE = "Reset Readables Settings"
L.OPT_RESET_PAGE_TIP = "Puts every setting on this page back to its default. What this character has heard is kept."
L.OPT_RESET_PAGE_CONFIRM = "Reset every Readables setting to its default?"
L.OPT_RESET = "Reset"
L.OPT_CANCEL = "Cancel"

L.OPT_SECTION_START_OVER = "Start Over"
