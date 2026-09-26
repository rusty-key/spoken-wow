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

L.OPT_NOTE = "Books, letters and notes read aloud through the Spoken player. Narration needs the Spoken Books Audio pack."
L.OPT_SECTION_READING = "Reading"
L.OPT_AUTOPLAY = "Read a book when it is opened"
L.OPT_AUTOPLAY_TIP = "Off, nothing starts by itself and a book is read only when you press Play or type /spb read."
L.OPT_WHOLE_BOOK = "Read the whole book, not just the page on screen"
L.OPT_WHOLE_BOOK_TIP = "Opening the first page queues the rest, so a journal reads on while you turn its pages."
L.OPT_READ_ONCE = "Read each book only once"
L.OPT_READ_ONCE_TIP = "A book you have already heard on this character is not read again when you open it. Play still works, and what has been read is remembered per character."
L.OPT_SECTION_LANGUAGE = "Language"
L.OPT_VOICE_LANGUAGE = "Voice language"
L.OPT_VOICE_LANGUAGE_TIP = "Which language's sound pack reads to you. Auto uses the language your game runs in. A language is only heard if a sound pack recorded in it is installed."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "Fallback language"
L.OPT_FALLBACK_LANGUAGE_TIP = "What to read when no pack in your chosen language has the page. None leaves it silent rather than reading it in a language you did not ask for."
L.OPT_FALLBACK_NONE = "None (stay silent)"
L.OPT_SECTION_READ = "What this character has read"
L.OPT_FORGET = "Forget what has been read"
L.OPT_FORGET_DONE_FMT = "forgot %1$d book%2$s; they will be read again"
L.OPT_FORGET_TIP = "Clears this character's record, so every book is new again. Only matters while \"Read each book only once\" is on."
L.PLAY = "Play"
L.STOP = "Stop"
L.PLAY_TIP = "Read this book aloud"
L.STOP_TIP = "Stop reading this book"
L.CONTRIBUTE = "Contribute"
L.REPORT = "Report"
L.NO_LINE = "No line for this page"
L.NO_LINE_TIP = "Send your own client's text so it can be added."
L.MENU_READ_BOOK = "Read this book"
L.MENU_BOOK_SETTINGS = "Spoken Books settings"
L.OPT_NO_PACK_AUDIO = "The installed sound pack has no narration for this page yet."
L.OPT_NO_PACK_INSTALLED = "No Spoken Books sound pack is installed."
L.OPT_PAGE_COUNT_FMT = "Page %1$d of %2$d"
