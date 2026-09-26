local _, SpokenBooks = ...

-- Spanish interface strings for Spoken Books.
-- Covers both esES and esMX: nothing in these strings varies by region.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "esES" and GetLocale() ~= "esMX" then
	return
end
L.OPT_NOTE = "Libros, cartas y notas leídos en voz alta a través del reproductor Spoken. La narración necesita el paquete Spoken Books Audio."
L.OPT_SECTION_READING = "Lectura"
L.OPT_AUTOPLAY = "Leer un libro al abrirlo"
L.OPT_AUTOPLAY_TIP = "Desactivado, nada empieza solo y un libro solo se lee al pulsar Reproducir o escribir /spb read."
L.OPT_WHOLE_BOOK = "Leer el libro entero, no solo la página visible"
L.OPT_WHOLE_BOOK_TIP = "Abrir la primera página encola el resto, así un diario sigue leyendo mientras pasas sus páginas."
L.OPT_READ_ONCE = "Leer cada libro una sola vez"
L.OPT_READ_ONCE_TIP = "Un libro ya escuchado con este personaje no se vuelve a leer al abrirlo. Reproducir sigue funcionando, y lo leído se recuerda por personaje."
L.OPT_SECTION_READ = "Lo que ha leído este personaje"
L.OPT_FORGET = "Olvidar lo leído"
L.OPT_FORGET_DONE_FMT = "olvidado %1$d libro%2$s; se leerán de nuevo"
L.OPT_FORGET_TIP = "Borra el registro de este personaje, para que cada libro sea nuevo otra vez. Solo importa mientras «Leer cada libro una sola vez» está activado."
L.PLAY = "Reproducir"
L.STOP = "Detener"
L.PLAY_TIP = "Leer este libro en voz alta"
L.STOP_TIP = "Dejar de leer este libro"
L.CONTRIBUTE = "Contribuir"
L.REPORT = "Informar"
L.NO_LINE = "Sin línea para esta página"
L.NO_LINE_TIP = "Envía el texto de tu propio cliente para que se añada."
L.MENU_READ_BOOK = "Leer este libro"
L.MENU_BOOK_SETTINGS = "Configuración de Spoken Books"
L.OPT_SECTION_LANGUAGE = "Idioma"
L.OPT_VOICE_LANGUAGE = "Idioma de voz"
L.OPT_VOICE_LANGUAGE_TIP = "De qué idioma es el paquete de sonido que te lee. Automático usa el idioma de tu juego. Un idioma solo se escucha si hay instalado un paquete grabado en él."
L.OPT_LANG_AUTO_FMT = "Automático (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "Idioma alternativo"
L.OPT_FALLBACK_LANGUAGE_TIP = "Qué leer cuando ningún paquete en tu idioma tiene la página. Ninguno la deja en silencio en lugar de leerla en un idioma no pedido."
L.OPT_FALLBACK_NONE = "Ninguno (en silencio)"
L.OPT_NO_PACK_AUDIO = "El paquete de sonido instalado aún no tiene narración para esta página."
L.OPT_NO_PACK_INSTALLED = "No hay ningún paquete de sonido de Spoken Books instalado."
L.OPT_PAGE_COUNT_FMT = "Página %1$d de %2$d"
