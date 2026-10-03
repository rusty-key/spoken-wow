local _, SpokenBooks = ...

-- Spanish interface strings for Spoken Books.
-- Covers both esES and esMX: nothing in these strings varies by region.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "esES" and GetLocale() ~= "esMX" then
	return
end
L.OPT_NOTE = "Libros, cartas, notas y placas, leídos en voz alta al abrirlos."
L.OPT_SECTION_READING = "Cuándo leer"
L.OPT_AUTOPLAY = "Leer automáticamente"
L.OPT_AUTOPLAY_TIP = "Lee un libro o una carta en cuanto se abre. Desactivado, nada empieza solo: pulsa Reproducir en la página o escribe /spb read."
L.OPT_WHOLE_BOOK = "Leer el libro entero"
L.OPT_WHOLE_BOOK_TIP = "Lee todas las páginas, no solo la que está en pantalla. Al abrir la primera página se ponen en cola las demás, así la voz sigue leyendo mientras pasas las páginas."
L.OPT_READ_ONCE = "Leer solo una vez"
L.OPT_READ_ONCE_TIP = "Lo que este personaje ya ha oído no se vuelve a leer al abrirlo. Reproducir sigue funcionando."
L.OPT_SECTION_READ = "Historial de lectura"
L.OPT_FORGET = "Olvidar lo leído"
L.OPT_FORGET_DONE_FMT = "libros olvidados: %1$d; se leerán de nuevo"
L.OPT_FORGET_TIP = "Borra la lista de lo que ha oído este personaje, para que todo se vuelva a leer. Solo importa mientras «Leer solo una vez» está activado."
L.PLAY = "Reproducir"
L.STOP = "Detener"
L.PLAY_TIP = "Leer este libro en voz alta"
L.STOP_TIP = "Dejar de leer este libro"
L.CONTRIBUTE = "Contribuir"
L.REPORT = "Informar"
L.NO_LINE = "Sin línea para esta página"
L.NO_LINE_TIP = "Envía el texto de tu propio cliente para que se añada."
L.MENU_BOOK_SETTINGS = "Configuración de Lecturas"
L.OPT_SECTION_LANGUAGE = "Idioma"
L.OPT_VOICE_LANGUAGE = "Idioma de las voces"
L.OPT_VOICE_LANGUAGE_TIP = "En qué idioma lee la voz. Automático usa el idioma de tu juego. Un idioma solo se oye si su paquete de voces está instalado."
L.OPT_LANG_AUTO_FMT = "Automático (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "Si falta una página"
L.OPT_FALLBACK_LANGUAGE_TIP = "Qué leer cuando el paquete de voces de tu idioma no tiene grabada una página: la misma página en otro idioma, o nada."
L.OPT_FALLBACK_NONE = "Silencio"
L.OPT_NO_PACK_AUDIO = "El paquete de voces instalado aún no tiene narración para esta página."
L.OPT_NO_PACK_INSTALLED = "No hay ningún paquete de voces de Lecturas instalado."
L.OPT_PAGE_COUNT_FMT = "Página %1$d de %2$d"

-- Added in the settings, subtitles and Zone Lore release.

-- Settings page: module switch
L.OPT_PAGE_TITLE = "Lecturas"
L.OPT_PART_SWITCH = "Activar módulo"
L.OPT_PART_SWITCH_TIP = "Activa o desactiva la lectura de libros, cartas, notas y placas. Desactivado, el módulo sigue instalado pero no lee nada. El mismo interruptor está en la página Spoken."
L.REASON_PART_OFF = "Activa «Activar módulo», arriba en esta página, para usar esto."
L.REASON_AUTOPLAY = "Activa «Leer automáticamente» para usar esto."
L.OPT_STOP_ON_CLOSE = "Detener al cerrar el libro"
L.OPT_STOP_ON_CLOSE_TIP = "Detiene la voz en cuanto cierras el libro, la carta o la placa. Desactivado, sigue leyendo después de cerrarlo."

-- Voice packs
L.OPT_SECTION_PACKS = "Paquetes de voces"
L.OPT_PACK_NAME_FMT = "Paquete de voces (%1$s)"
L.OPT_PACK_OFFICIAL = "Lecturas"
L.OPT_PACK_INSTALLED = "Instalado"
L.OPT_DOWNLOAD = "Descargar"
L.OPT_DOWNLOAD_TIP = "Muestra la dirección para copiarla en tu navegador."
L.OPT_DOWNLOAD_ADDRESS = "Copia esta dirección en tu navegador para descargar el paquete de voces."

-- Fixing a problem
L.OPT_SECTION_TROUBLE = "Solucionar un problema"
L.OPT_TEST_LINE = "Reproducir una línea de prueba"
L.OPT_TEST_LINE_TIP = "Reproduce una página de tu paquete de voces, igual que suena una real, para comprobar que la oyes."
L.OPT_DIAGNOSTICS = "Mostrar diagnóstico"
L.OPT_DIAGNOSTICS_TIP = "Muestra en el chat los paquetes de voces, la configuración y los libros leídos con este personaje, para un informe de errores."
L.OPT_REPORT_PROBLEM = "Informar de un problema"
L.OPT_REPORT_PROBLEM_TIP = "Para todo lo que no sea sobre una sola página; cada página tiene su propio botón Informar. Te da una dirección para copiar en tu navegador."
L.OPT_REPORT_ADDRESS = "Copia esta dirección en tu navegador para contarnos el problema."

-- Starting over
L.OPT_SECTION_START_OVER = "Empezar de cero"
L.OPT_RESET_PAGE = "Restablecer configuración de Lecturas"
L.OPT_RESET_PAGE_TIP = "Devuelve todos los ajustes de esta página a su valor predeterminado. Se conserva lo que ha oído este personaje."
L.OPT_RESET_PAGE_CONFIRM = "¿Restablecer todos los ajustes de Lecturas a su valor predeterminado?"
L.OPT_RESET = "Restablecer"
L.OPT_CANCEL = "Cancelar"
