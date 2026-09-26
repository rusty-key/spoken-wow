local _, SpokenBooks = ...

-- German interface strings for Spoken Books.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "deDE" then
	return
end
L.OPT_NOTE = "Bücher, Briefe und Notizen werden über den Spoken-Player vorgelesen. Die Vertonung braucht das Spoken-Books-Audio-Pack."
L.OPT_SECTION_READING = "Lesen"
L.OPT_AUTOPLAY = "Ein Buch beim Öffnen vorlesen"
L.OPT_AUTOPLAY_TIP = "Wenn aus, startet nichts von selbst und ein Buch wird nur vorgelesen, wenn du auf Abspielen klickst oder /spb read tippst."
L.OPT_WHOLE_BOOK = "Das ganze Buch vorlesen, nicht nur die sichtbare Seite"
L.OPT_WHOLE_BOOK_TIP = "Beim Öffnen der ersten Seite wird der Rest angereiht, sodass ein Tagebuch beim Umblättern weiterliest."
L.OPT_READ_ONCE = "Jedes Buch nur einmal vorlesen"
L.OPT_READ_ONCE_TIP = "Ein Buch, das du mit diesem Charakter schon gehört hast, wird beim Öffnen nicht erneut vorgelesen. Abspielen funktioniert weiterhin, und Gelesenes wird pro Charakter gemerkt."
L.OPT_SECTION_READ = "Was dieser Charakter gelesen hat"
L.OPT_FORGET = "Vergessen, was gelesen wurde"
L.OPT_FORGET_DONE_FMT = "%1$d gelesene Bücher vergessen; sie werden erneut vorgelesen"
L.OPT_FORGET_TIP = "Löscht die Aufzeichnung dieses Charakters, sodass jedes Buch wieder neu ist. Relevant nur, solange „Jedes Buch nur einmal vorlesen“ aktiv ist."
L.PLAY = "Abspielen"
L.STOP = "Stopp"
L.PLAY_TIP = "Dieses Buch laut vorlesen"
L.STOP_TIP = "Aufhören, dieses Buch vorzulesen"
L.CONTRIBUTE = "Mitwirken"
L.REPORT = "Melden"
L.NO_LINE = "Keine Zeile für diese Seite"
L.NO_LINE_TIP = "Sende den Text deines eigenen Clients, damit er hinzugefügt werden kann."
L.MENU_READ_BOOK = "Dieses Buch vorlesen"
L.MENU_BOOK_SETTINGS = "Spoken-Books-Einstellungen"
L.OPT_SECTION_LANGUAGE = "Sprache"
L.OPT_VOICE_LANGUAGE = "Vertonungssprache"
L.OPT_VOICE_LANGUAGE_TIP = "In welcher Sprache dich das Soundpack vorliest. „Automatisch“ nutzt die Sprache deines Spiels. Eine Sprache ist nur zu hören, wenn ein Soundpack darin aufgenommen wurde."
L.OPT_LANG_AUTO_FMT = "Automatisch (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "Ausweichsprache"
L.OPT_FALLBACK_LANGUAGE_TIP = "Was gelesen wird, wenn kein Pack in deiner gewählten Sprache die Seite hat. „Keine“ lässt sie stumm, statt sie in einer Sprache zu lesen, um die du nicht gebeten hast."
L.OPT_FALLBACK_NONE = "Keine (still)"
L.OPT_NO_PACK_AUDIO = "Das installierte Soundpack hat für diese Seite noch keine Vertonung."
L.OPT_NO_PACK_INSTALLED = "Es ist kein Spoken-Books-Soundpack installiert."
L.OPT_PAGE_COUNT_FMT = "Seite %1$d von %2$d"
