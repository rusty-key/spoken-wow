-- esES. Spanish interface strings for Spoken Zones.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, SpokenZones = ...

-- esMX shares this file: nothing in these strings varies by region. Both codes
-- register the same table, so check-strings.mjs (which reads one file per code)
-- reports esMX as untranslated -- that report is about files, not runtime.
if GetLocale() ~= "esES" and GetLocale() ~= "esMX" then
	return
end

local L = {}

L.OPT_NOTE = "Historias de las zonas y áreas que visitas, leídas en voz alta y mostradas en el mapa del mundo."
L.OPT_SECTION_MAP = "Mapa del mundo"
L.OPT_MAP_PANEL = "Historia de la zona junto al mapa"
L.OPT_MAP_PANEL_TIP = "Muestra el panel Historia de la zona, con la historia de la zona o área que estás mirando, junto al mapa del mundo. Se oculta mientras el mapa ocupa toda la pantalla, porque quedaría fuera del borde."
L.OPT_HOVER = "Historia al pasar el cursor"
L.OPT_HOVER_TIP = "Muestra la historia de un área cuando la señalas con el cursor: una zona en un mapa de continente, o un área más pequeña en un mapa de zona. No aparece mientras señalas un marcador del mapa."
L.OPT_PANEL_WIDTH = "Ancho de la historia de la zona"
L.OPT_FONT_SIZE = "Tamaño del texto"
L.OPT_SECTION_NARRATION = "Cuándo leer"
L.OPT_PLAY_BUTTON = "Leer historias en voz alta"
L.OPT_PLAY_BUTTON_TIP = "Lee las historias en voz alta: cuando descubres un lugar, y desde el botón Reproducir junto a cada historia en Historia de la zona e Historia de Azeroth. Desactivado, las historias se siguen mostrando, solo como texto."
L.OPT_AUTOPLAY = "Leer al descubrir"
L.OPT_AUTOPLAY_TIP = "Lee la historia de un área en el momento en que el juego indica que la has descubierto, como «Durotar descubierto». El juego lo hace una vez por lugar para cada personaje."
L.OPT_AUTOPLAY_SUB = "Incluir áreas más pequeñas"
L.OPT_AUTOPLAY_SUB_TIP = "Lee también las áreas más pequeñas dentro de una zona a medida que las encuentras. Un paseo por el Bosque de Elwynn encuentra varias; suenan una tras otra en lugar de interrumpirse."
L.OPT_AUTOPLAY_EXPLORED = "Incluir lugares encontrados antes"
L.OPT_AUTOPLAY_EXPLORED_TIP = "El juego solo anuncia un descubrimiento una vez, así que un personaje que ya ha explorado no oiría nada. Con esto activado, Spoken lleva su propia lista: una historia por lugar para cada personaje. «Olvidar lugares leídos», más abajo, la borra."
L.OPT_SOUND_PACK = "Lee con"
L.OPT_SOUND_PACK_TIP = "Qué paquete de voces instalado lee las historias."
L.OPT_SECTION_LANGUAGE = "Idioma"
L.OPT_LANG_ONLY_ENGLISH = "Por ahora las historias solo están escritas en inglés."
L.OPT_LANG_RELOAD = "Escribe /reload para cambiar a él."
L.OPT_LANG_COUNT_FMT = "%1$d idiomas disponibles. Un cambio se aplica después de escribir /reload."
L.OPT_LANGUAGE = "Idioma de las historias"
L.OPT_LANGUAGE_TIP = "Automático sigue el idioma de tu juego, o el inglés donde aún no hay traducción. Un idioma elegido aquí se mantiene, sea cual sea el idioma del juego."
L.OPT_LANG_AUTO_FMT = "Automático (%1$s)"
L.OPT_LANG_SET_FMT = "Las historias estarán en %1$s cuando se recargue la interfaz."
L.OPT_SECTION_TROUBLE = "Solucionar un problema"
L.OPT_REPORT_PROBLEM = "Informar de un problema"
L.OPT_REPORT_ADDRESS = "Copia esta dirección y ábrela en tu navegador para enviar comentarios sobre Spoken Zones."
L.OPT_REPORT_NOTE = "Para todo lo que no sea sobre una sola historia; cada historia tiene su propio botón Informar. Te da una dirección para copiar en tu navegador."
L.MENU_LORE_WINDOW = "Abrir Historia de Azeroth"
L.MENU_ZONE_SETTINGS = "Configuración de Zonas"

L.OPT_REPORT_LINE_TIP = "Historia errónea, mala lectura, nombre mal pronunciado: esto te da un enlace para decirlo."
L.OPT_REPORT_LINE_ADDRESS = "Copia esta dirección y ábrela en tu navegador para informar de un problema con esta entrada."

L.AUDIO_READ_TIP = "Escuchar esta historia en voz alta"
L.REPORT_BUTTON = "Informar"
L.CONTRIBUTE_BUTTON = "Contribuir"
L.CONTRIBUTE_BUTTON_TIP_TITLE = "Spoken Zones no tiene historia para este lugar"
L.CONTRIBUTE_BUTTON_TIP = "Contribuye describiéndolo: qué es, quién vive allí, qué pasó allí."
L.IN_ZONE_FMT = "en %1$s"
L.LORE_WINDOW_EMPTY = "Elige un lugar a la izquierda para leer su historia. El número de una zona indica cuántas áreas más pequeñas tiene; haz clic en él para verlas."

L.PLAY = "Reproducir"
L.PAUSE = "Pausa"
L.PAUSE_TOOLTIP = "El juego no puede continuar un sonido a la mitad, así que volver a reproducir empieza desde el principio."
L.QUEUE_HELD_COMBAT = "Esperando que termine el combate."
L.QUEUE_HELD_CINEMATIC = "Esperando que termine la cinemática."
L.QUEUE_HELD_OFF = "La narración está desactivada."
L.BACK_TO_ZONE = "< Volver a %1$s"
L.NO_LORE_FOR = "Aún no hay historia registrada para %1$s."
L.LORE_NOT_WRITTEN = "%1$s está en el mapa, pero nadie ha escrito su historia todavía."
L.MAP_LORE_FOR_FMT = "historia de %1$s"
L.OPT_PACK_NONE_INSTALLED = "nada instalado"
L.CMD_HEADING = "comandos (/spokenzones, o /spz):"
L.CMD_STATUS = "  /spz            -- estado de la zona y el área actuales"
L.CMD_OPTIONS = "  /spz options    -- abre el panel de configuración"
L.CMD_WINDOW = "  /spz window     -- abre Historia de Azeroth"
L.CMD_PANEL = "  /spz panel      -- muestra u oculta Historia de la zona junto al mapa"
L.CMD_HOVER = "  /spz hover      -- alterna la vista previa al pasar el cursor"
L.CMD_PLAY = "  /spz play       -- lee la historia actual"
L.CMD_STOP = "  /spz stop       -- detiene la narración"
L.CMD_VOICE = "  /spz voice      -- activa o desactiva la narración"
L.CMD_AUTOPLAY = "  /spz autoplay   -- alterna narrar áreas al descubrirlas"
L.CMD_AUDIO = "  /spz audio      -- lista paquetes de voces, o cambia con /spz audio <name>"
L.CMD_LANG = "  /spz lang       -- lista idiomas, o cambia con /spz lang <code> o auto"
L.CMD_DISCOVER = "  /spz discover   -- finge descubrir un área (dev)"
L.CMD_FORGET = "  /spz forget     -- olvida lo narrado a este personaje"
L.CMD_BAR = "  /spz bar        -- mueve el reproductor al centro de la pantalla"
L.CMD_MINIMAP = "  /spz minimap    -- muestra u oculta el botón del minimapa"
L.CMD_DEBUG = "  /spz debug      -- informa nombres de zona al hacer clic"
L.CMD_VERIFY = "  /spz verify     -- verifica los datos contra este cliente"
L.CMD_DUMP = "  /spz dump       -- enumera el árbol de mapas (dev)"

L.SUBZONE_COUNT_FMT = "%1$d áreas"

-- Added in the settings, subtitles and Zone Lore release.

-- Settings page: module switch and why a setting is unavailable
L.OPT_PAGE_TITLE = "Zonas"
L.OPT_PART_SWITCH = "Activar módulo"
L.OPT_PART_SWITCH_TIP = "Activa o desactiva la lectura de historias de zonas y áreas. Desactivado, el módulo sigue instalado pero no lee nada. El mismo interruptor está en la página Spoken."
L.REASON_PART_OFF = "Activa «Activar módulo», arriba en esta página, para usar esto."
L.REASON_VOICE = "Activa «Leer historias en voz alta» para usar esto."
L.REASON_DISCOVERY = "Activa «Leer al descubrir» para usar esto."
L.REASON_MAP_PANEL = "Activa «Historia de la zona junto al mapa» para usar esto."
L.OPT_PANEL_WIDTH_TIP = "Ajusta el ancho del panel Historia de la zona junto al mapa."
L.OPT_FONT_SIZE_TIP = "Ajusta el tamaño del texto de las historias, en Historia de la zona y en Historia de Azeroth."

-- Voice packs
L.OPT_SECTION_PACKS = "Paquetes de voces"
L.OPT_PACK_NAME_FMT = "Paquete de voces (%1$s)"
L.OPT_PACK_OFFICIAL = "Zonas"
L.OPT_PACK_INSTALLED = "Instalado"
L.OPT_DOWNLOAD = "Descargar"
L.OPT_DOWNLOAD_TIP = "Muestra la dirección para copiarla en tu navegador."
L.OPT_DOWNLOAD_ADDRESS = "Copia esta dirección en tu navegador para descargar el paquete de voces."

-- Reading history
L.OPT_SECTION_HISTORY = "Historial de lectura"
L.OPT_FORGET_PLACES = "Olvidar lugares leídos"
L.OPT_FORGET_PLACES_TIP = "Borra la lista de lugares que ha oído este personaje, para que todas las áreas vuelvan a contar como no oídas. Solo importa mientras «Incluir lugares encontrados antes» está activado."
L.OPT_FORGET_PLACES_DONE = "Se ha borrado la lista de lugares leídos de este personaje."

-- Fixing a problem
L.OPT_TEST_LINE = "Reproducir una línea de prueba"
L.OPT_TEST_LINE_TIP = "Reproduce una historia, igual que suena una real, para comprobar que la oyes: la del lugar donde estás, u otra de tu paquete de voces."
L.OPT_DIAGNOSTICS = "Mostrar diagnóstico"
L.OPT_DIAGNOSTICS_TIP = "Muestra en el chat tus paquetes de voces y cómo está configurada la lectura, para un informe de errores."

-- Starting over
L.OPT_SECTION_START_OVER = "Empezar de cero"
L.OPT_RESET_PAGE = "Restablecer configuración de Zonas"
L.OPT_RESET_PAGE_TIP = "Devuelve los ajustes de esta página a su valor predeterminado. También desactiva /spz debug, vuelve a mostrar el botón de Spoken Zones en el minimapa y deja de previsualizar traducciones sin terminar. Se conservan el idioma de las historias, el paquete de voces elegido en «Lee con» y la lista de lugares ya leídos."
L.OPT_RESET_PAGE_CONFIRM = "¿Restablecer todos los ajustes de Zonas a su valor predeterminado?"
L.OPT_RESET = "Restablecer"
L.OPT_CANCEL = "Cancelar"
L.OPT_RELOAD_NOW = "Recargar ahora"
L.OPT_LATER = "Más tarde"

-- Lore of Azeroth and Zone Lore
L.LORE_WINDOW_TITLE = "Historia de Azeroth"
L.LORE_PANEL_TITLE = "Historia de la zona"
L.OPT_SECTION_LORE = "Historia de Azeroth"
L.OPT_LORE_WINDOW_TIP = "La historia de cada zona y área, para explorarla y escucharla estés donde estés."
L.OPEN_IN_LORE_TIP = "La historia de este lugar en Historia de Azeroth, junto a la de todas las demás zonas y áreas."
L.PANEL_SHOWN = "Historia de la zona junto al mapa: activado"
L.PANEL_HIDDEN = "Historia de la zona junto al mapa: desactivado"
L.MINIMAP_LEFT_CLICK = "|cff66bbffClic izquierdo:|r %1$s"
L.LORE_SEARCH = "Buscar lugares"
L.LORE_SEARCH_NONE = "Ningún lugar coincide."
L.LORE_PICK = "La historia de cada lugar"
L.SUBZONE_COUNT_ONE = "1 área"
L.ZONE_COUNT_FMT = "%1$d zonas"
L.ZONE_COUNT_ONE = "1 zona"
L.CONTINENT_COUNT_FMT = "%1$d continentes"
L.CONTINENT_COUNT_ONE = "1 continente"

SpokenZones:RegisterStrings("esES", L)
SpokenZones:RegisterStrings("esMX", L)
