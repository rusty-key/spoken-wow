-- esES. Empty: nothing has been translated yet.
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

L.OPT_NOTE = "Historia de zonas y subzonas en el mapa del mundo y el minimapa. Texto de warcraft.wiki.gg, CC BY-SA 4.0."
L.OPT_SECTION_MAP = "Mapa del mundo"
L.OPT_MAP_PANEL = "Mostrar el panel de historia junto al mapa"
L.OPT_MAP_PANEL_TIP = "El panel se oculta mientras el mapa está maximizado, ya que quedaría fuera de la pantalla."
L.OPT_HOVER = "Mostrar descripción de historia al pasar el cursor"
L.OPT_HOVER_TIP = "Pasa el cursor sobre una zona en un mapa de continente o una subzona en un mapa de zona. Suprimido mientras el cursor está sobre un marcador."
L.OPT_PANEL_LEFT = "Poner el panel a la izquierda del mapa"
L.OPT_PANEL_WIDTH = "Ancho del panel"
L.OPT_FONT_SIZE = "Tamaño de fuente"
L.OPT_SECTION_MINIMAP = "Minimapa"
L.OPT_MINIMAP_BUTTON = "Mostrar el botón del minimapa"
L.OPT_MINIMAP_BUTTON_TIP = "Clic izquierdo abre la ventana de historia, clic derecho abre estos ajustes."
L.OPT_SECTION_NARRATION = "Narración"
L.OPT_PLAY_BUTTON = "Mostrar el botón de reproducir en las descripciones"
L.OPT_PLAY_BUTTON_TIP = "Lee la historia en voz alta. Necesita un addon acompañante Spoken Zones Audio; sin uno el botón no aparece."
L.OPT_AUTOPLAY = "Narrar una zona al descubrirla"
L.OPT_AUTOPLAY_TIP = "Lo activa el propio descubrimiento del juego -- el momento en que muestra «Durotar descubierto». Una vez por personaje, porque es cuando el juego lo activa."
L.OPT_AUTOPLAY_SUB = "Narrar también las subzonas que descubras"
L.OPT_AUTOPLAY_SUB_TIP = "La mayoría de descubrimientos son subzonas -- un paseo por Elwynn activa varias. Se encolan en lugar de interrumpirse, así que desactívalo solo si la narración resulta constante."
L.OPT_AUTOPLAY_EXPLORED = "Narrar también zonas exploradas antes de instalar"
L.OPT_AUTOPLAY_EXPLORED_TIP = "El juego anuncia un descubrimiento una vez por personaje, para siempre -- así que un personaje que ya exploró Azeroth nunca recibe narración. Actívalo y Spoken Zones lleva su propio registro, sigue siendo un clip por zona y personaje. /spz forget lo borra."
L.OPT_PACK_NONE = "No se narra nada. Instala Spoken Zones Audio para escuchar la historia."
L.OPT_PACK_MULTI_FMT = "%1$s. %2$d instalados; suena el del idioma que lees salvo que elijas otro."
L.OPT_SOUND_PACK = "Paquete de sonido"
L.OPT_SOUND_PACK_TIP = "Qué paquete instalado narra la historia."
L.OPT_SECTION_LANGUAGE = "Idioma"
L.OPT_LANG_ONLY_ENGLISH = "La historia solo está escrita en inglés por ahora."
L.OPT_LANG_RELOAD = "Recarga para empezar a leerlo: escribe /reload."
L.OPT_LANG_COUNT_FMT = "%1$d idiomas disponibles. Cambiar surte efecto tras /reload."
L.OPT_LANGUAGE = "Idioma"
L.OPT_LANGUAGE_TIP = "Idioma en que la historia se lee y se muestra. Automático sigue el idioma del juego (inglés hasta que esté traducido); un idioma elegido aquí se mantiene sea cual sea el idioma del juego."
L.OPT_LANG_AUTO_FMT = "Automático (%1$s)"
L.OPT_LANG_SET_FMT = "idioma cambiado a %1$s -- |cffffcc00/reload para aplicar|r"
L.OPT_SECTION_TROUBLE = "Solución de problemas"
L.OPT_DEBUG_MAP_CLICK = "Informar nombres de zona al hacer clic en el mapa"
L.OPT_DEBUG_MAP_CLICK_TIP = "Muestra el nombre de zona en bruto que informa el cliente, la clave a la que se normaliza y si se encontró historia. Úsalo para detectar una subzona que necesite un alias."
L.OPT_SECTION_FEEDBACK = "Comentarios"
L.OPT_REPORT_PROBLEM = "Informar de un problema"
L.OPT_REPORT_ADDRESS = "Copia esta dirección y ábrela en tu navegador para enviar comentarios sobre Spoken Zones."
L.OPT_REPORT_NOTE = "Cada entrada de historia tiene un botón de informe para problemas con esa entrada. Este es para todo lo demás. El juego no puede abrir un enlace, así que ambos te dan una dirección para copiar."
L.MENU_LORE_WINDOW = "Abrir ventana de historia"
L.MENU_ZONE_SETTINGS = "Configuración de Spoken Zones"

L.OPT_REPORT_LINE_TIP = "Historia errónea, mala lectura, nombre mal pronunciado: esto te da un enlace para decirlo."
L.OPT_REPORT_LINE_ADDRESS = "Copia esta dirección y ábrela en tu navegador para informar de un problema con esta entrada."

L.STOP = "Detener"
L.AUDIO_STOP_TIP = "Detener la narración"
L.AUDIO_READ_TIP = "Leer esta historia en voz alta"
L.REPORT_BUTTON = "Informar"
L.CONTRIBUTE_BUTTON = "Contribuir"
L.CONTRIBUTE_BUTTON_TIP_TITLE = "Spoken Zones no tiene historia para este lugar"
L.CONTRIBUTE_BUTTON_TIP = "Contribuye describiéndolo: qué es, quién vive allí, qué pasó allí."
L.IN_ZONE_FMT = "en %1$s"
L.LORE_WINDOW_EMPTY = "Elige una zona a la izquierda. Las zonas con subzonas muestran un conteo; haz clic en una para expandirla."

L.PLAY = "Reproducir"
L.PAUSE = "Pausa"
L.PLAY_TOOLTIP = "Vuelve a empezar esta historia desde el principio."
L.PAUSE_TOOLTIP = "El juego no puede continuar un sonido a la mitad, así que volver a reproducir empieza desde el principio."
L.QUEUE_TITLE = "A continuación"
L.QUEUE_COUNT = "%1$d en espera"
L.QUEUE_REMOVE_TOOLTIP = "Haz clic para quitarlo."
L.QUEUE_DRAG_HINT = "Arrastra esta lista para moverla."
L.QUEUE_HELD_COMBAT = "Esperando que termine el combate."
L.QUEUE_HELD_CINEMATIC = "Esperando que termine la cinemática."
L.QUEUE_HELD_OFF = "La narración está desactivada."
L.BACK_TO_ZONE = "< Volver a %1$s"
L.NO_LORE_FOR = "Aún no hay historia registrada para %1$s."
L.LORE_NOT_WRITTEN = "%1$s está en el mapa, pero nadie ha escrito su historia todavía."
L.MAP_LORE_FOR_FMT = "historia de %1$s"
L.MAP_SUBZONE_MORE = "haz clic en una subzona del mapa para más"
L.OPT_PACK_NONE_INSTALLED = "nada instalado"
L.CMD_HEADING = "comandos (/spokenzones, o /spz):"
L.CMD_STATUS = "  /spz            -- estado de la zona y subzona actuales"
L.CMD_OPTIONS = "  /spz options    -- abre el panel de configuración"
L.CMD_WINDOW = "  /spz window     -- abre la ventana de historia explorable"
L.CMD_PANEL = "  /spz panel      -- alterna el panel del mapa del mundo"
L.CMD_HOVER = "  /spz hover      -- alterna la vista previa al pasar el cursor"
L.CMD_PLAY = "  /spz play       -- lee la historia actual"
L.CMD_STOP = "  /spz stop       -- detiene la narración"
L.CMD_VOICE = "  /spz voice      -- activa o desactiva la narración"
L.CMD_AUTOPLAY = "  /spz autoplay   -- alterna narrar áreas al descubrirlas"
L.CMD_AUDIO = "  /spz audio      -- lista paquetes de sonido, o cambia con /spz audio <name>"
L.CMD_LANG = "  /spz lang       -- lista idiomas, o cambia con /spz lang <code> o auto"
L.CMD_DISCOVER = "  /spz discover   -- finge descubrir un área (dev)"
L.CMD_FORGET = "  /spz forget     -- olvida lo narrado a este personaje"
L.CMD_BAR = "  /spz bar        -- mueve el reproductor al centro de la pantalla"
L.CMD_MINIMAP = "  /spz minimap    -- muestra u oculta el botón del minimapa"
L.CMD_DEBUG = "  /spz debug      -- informa nombres de zona al hacer clic"
L.CMD_VERIFY = "  /spz verify     -- verifica los datos contra este cliente"
L.CMD_DUMP = "  /spz dump       -- enumera el árbol de mapas (dev)"

L.SUBZONE_COUNT_FMT = "%1$d subzonas"

SpokenZones:RegisterStrings("esES", L)
SpokenZones:RegisterStrings("esMX", L)
