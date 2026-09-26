local _, SpokenBooks = ...

-- Russian interface strings for Spoken Books.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "ruRU" then
	return
end
L.OPT_NOTE = "Книги, письма и заметки читаются вслух через плеер Spoken. Для озвучки нужен пакет Spoken Books Audio."
L.OPT_SECTION_READING = "Чтение"
L.OPT_AUTOPLAY = "Читать книгу при открытии"
L.OPT_AUTOPLAY_TIP = "Когда выключено, ничего не начинается само, а книга читается, только если нажать «Слушать» или ввести /spb read."
L.OPT_WHOLE_BOOK = "Читать всю книгу, а не только видимую страницу"
L.OPT_WHOLE_BOOK_TIP = "Открытие первой страницы ставит в очередь остальные, и журнал читается дальше, пока вы листаете страницы."
L.OPT_READ_ONCE = "Читать каждую книгу только один раз"
L.OPT_READ_ONCE_TIP = "Книга, уже услышанная этим персонажем, при открытии больше не читается. Слушать по-прежнему работает, а прочитанное запоминается для каждого персонажа."
L.OPT_SECTION_READ = "Что прочитал этот персонаж"
L.OPT_FORGET = "Забыть прочитанное"
L.OPT_FORGET_DONE_FMT = "забыто: %1$d; всё будет прочитано снова"
L.OPT_FORGET_TIP = "Очищает запись этого персонажа, и каждая книга снова станет новой. Важно, только пока включено «Читать каждую книгу только один раз»."
L.PLAY = "Слушать"
L.STOP = "Стоп"
L.PLAY_TIP = "Прочитать эту книгу вслух"
L.STOP_TIP = "Перестать читать эту книгу"
L.CONTRIBUTE = "Помочь"
L.REPORT = "Жалоба"
L.NO_LINE = "Нет строки для этой страницы"
L.NO_LINE_TIP = "Отправьте текст из вашего клиента, чтобы её добавить."
L.MENU_READ_BOOK = "Прочитать эту книгу"
L.MENU_BOOK_SETTINGS = "Настройки Spoken Books"
L.OPT_SECTION_LANGUAGE = "Язык"
L.OPT_VOICE_LANGUAGE = "Язык озвучки"
L.OPT_VOICE_LANGUAGE_TIP = "Пакет на каком языке читает вам. «Авто» использует язык вашей игры. Язык слышен, только если установлен записанный на нём пакет."
L.OPT_LANG_AUTO_FMT = "Авто (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "Запасной язык"
L.OPT_FALLBACK_LANGUAGE_TIP = "Что читать, когда ни у одного пакета на вашем языке нет страницы. «Нет» оставит тишину вместо чтения на языке, о котором не просили."
L.OPT_FALLBACK_NONE = "Нет (тишина)"
L.OPT_NO_PACK_AUDIO = "В установленном звуковом пакете пока нет озвучки для этой страницы."
L.OPT_NO_PACK_INSTALLED = "Звуковой пакет Spoken Books не установлен."
L.OPT_PAGE_COUNT_FMT = "Страница %1$d из %2$d"
