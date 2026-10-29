local _, SpokenReadables = ...

-- Spanish interface strings for Spoken Readables.
-- Covers both esES and esMX: nothing in these strings varies by region.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenReadables.L

if GetLocale() ~= "esES" and GetLocale() ~= "esMX" then
	return
end
L.OPT_AUTOPLAY = "Leer automáticamente"
L.OPT_WHOLE_BOOK = "Leer el libro entero"
L.OPT_ONE_LINE = "Leer el libro en una línea"
L.OPT_READ_ONCE = "Leer solo una vez"
L.OPT_FORGET = "Olvidar lecturas oídas"
L.OPT_FORGET_DONE_FMT = "Lecturas olvidadas: %1$d. Se volverán a leer."
L.PLAY = "Reproducir"
L.STOP = "Detener"
L.PLAY_TIP = "Leer esto en voz alta"
L.STOP_TIP = "Dejar de leer esto"
-- DialogueUI's book view: Play's tooltip (UI/DialogueUIBook.lua).
L.DUI_ON = "Activado"
L.DUI_OFF = "Desactivado"
L.DUI_PLAY_RIGHT_CLICK = "Clic derecho para activar o desactivar «Leer automáticamente»."
L.CONTRIBUTE = "Contribuir"
L.REPORT = "Informar"
L.REPORT_PROBLEM = "Informar de un problema"
L.REPORT_LINE_ADDRESS = "Copia esta dirección y ábrela en tu navegador para informar de un problema con esta página."
L.NO_LINE = "Sin línea para esta página"
L.NO_LINE_TIP = "Envía el texto de tu propio cliente para que se añada."
L.MENU_BOOK_SETTINGS = "Configuración de Lecturas"
L.OPT_NO_PACK_AUDIO = "El paquete de voces instalado aún no tiene narración para esta página."
L.OPT_NO_PACK_INSTALLED = "No hay ningún paquete de voces de Lecturas instalado."
L.OPT_PAGE_COUNT_FMT = "Página %1$d de %2$d"

-- Added in the settings, subtitles and Zone Lore release.

-- Settings page: module switch
L.OPT_PAGE_TITLE = "Lecturas"
L.OPT_DEV_DEBUG = "Depuración de Lecturas"
L.REASON_AUTOPLAY = "Activa «Leer automáticamente» para usar esto."
L.REASON_READ_ONCE = "Activa «Leer solo una vez» para usar esto."
L.REASON_WHOLE_BOOK = "Activa «Leer el libro entero» para usar esto."
L.OPT_STOP_ON_CLOSE = "Detener al cerrar el libro"
L.OPT_CLOSE_WHEN_READ = "Cerrar el libro al terminar"

-- Voice packs
L.OPT_DOWNLOAD_ADDRESS = "Copia esta dirección en tu navegador para descargar el paquete de voces."

-- Fixing a problem

-- Starting over
L.OPT_RESET_PAGE_CONFIRM = "¿Restablecer todos los ajustes de Lecturas a su valor predeterminado?"

-- Azeroth's Compendium: the readables' tab (UI/Readables.lua) and its settings.
L.COMPENDIUM_READABLES = "Lecturas"
L.READABLES_SEARCH = "Buscar lecturas"
L.READABLES_NONE = "No hay coincidencias."
L.READABLES_FOUND_ONLY = "Solo encontradas"
L.READABLES_VOICED_ONLY = "Solo con voz"
L.TYPE_BOOK = "Libros"
L.TYPE_JOURNAL = "Diarios"
L.TYPE_LETTER = "Cartas"
L.TYPE_NOTE = "Notas"
L.TYPE_SCROLL = "Pergaminos"
L.TYPE_TABLET = "Tablillas y runas"
L.TYPE_PLAQUE = "Placas y carteles"
L.TYPE_GRAVE = "Lápidas"
L.TYPE_EXHIBIT = "Piezas de museo"
L.TYPE_PICTURE = "Imágenes y mapas"
L.TYPE_OTHER = "Otros"
-- One readable of each kind, over its name in the windows and the subtitle.
L.READABLE_BOOK = "Libro"
L.READABLE_JOURNAL = "Diario"
L.READABLE_LETTER = "Carta"
L.READABLE_NOTE = "Nota"
L.READABLE_SCROLL = "Pergamino"
L.READABLE_TABLET = "Tablilla"
L.READABLE_PLAQUE = "Placa"
L.READABLE_GRAVE = "Lápida"
L.READABLE_EXHIBIT = "Pieza de museo"
L.READABLE_PICTURE = "Imagen"
L.READABLE_OTHER = "Otro"
L.READABLES_BY_ZONE = "Por zona"
L.READABLES_BY_TYPE = "Por tipo"
L.GROUP_EVENTS = "Festividades y eventos"
L.EVENT_WINTER_VEIL = "Festival de Invierno"
L.EVENT_HARVEST_FESTIVAL = "Festival de la Cosecha"
L.EVENT_FISHING_EXTRAVAGANZA = "Concurso de pesca de la Vega de Tuercespina"
L.EVENT_SCOURGE_INVASION = "Invasión de la Plaga"
L.GROUP_WIDE = "Por todo Azeroth"
L.GROUP_UNKNOWN = "Lugar desconocido"
L.GROUP_LANDS = "Otras tierras"
L.GROUP_BATTLEGROUNDS = "Campos de batalla"
L.GROUP_DUNGEONS = "Mazmorras y bandas"
L.READABLE_NOT_FOUND = "Aún no lo has encontrado. Ábrelo en el mundo para leerlo aquí."
L.OPEN_IN_COMPENDIUM = "Abrir en el Compendio de Azeroth"
L.FOUND_FMT = "%1$d de %2$d encontradas"
L.READABLES_IN_FMT = "Ubicación: %1$s"
L.READABLES_MORE_FMT = " y %1$d más"
L.BOOKS_TITLE_NTH_FMT = "%1$s (%2$d)"
