-- esES. Spanish interface strings for Spoken Places.
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

L.OPT_SECTION_MAP = "Historias"
L.OPT_MAP_PANEL = "Historia junto al mapa"
L.OPT_PICTURES = "Mostrar imágenes"
L.OPT_MAP_HIGHLIGHT = "Resaltado de áreas"
L.OPT_PANEL_WIDTH = "Ancho de la historia"
L.OPT_PLAY_BUTTON = "Leer historias en voz alta"
L.OPT_AUTOPLAY = "Leer automáticamente"
L.OPT_AUTOPLAY_SUB = "Incluir áreas más pequeñas"
L.OPT_AUTOPLAY_EXPLORED = "Incluir lugares encontrados antes"
L.OPT_LANG_RELOAD = "Escribe /reload para cambiar a él."
L.OPT_LANGUAGE = "Idioma del texto"
L.OPT_LANG_AUTO_FMT = "Automático (%1$s)"
L.OPT_LANG_SET_FMT = "Las historias estarán en %1$s cuando se recargue la interfaz."
L.OPT_LANG_PROFILE_FMT = "Este perfil lee las historias en %1$s. Escribe /reload para cambiar."
L.OPT_REPORT_PROBLEM = "Informar de un problema"
L.MENU_LORE_WINDOW = "Abrir Compendio de Azeroth"
L.MENU_ZONE_SETTINGS = "Configuración de Lugares"

L.OPT_REPORT_LINE_TIP = "Obtén un enlace para informar de una historia errónea, una lectura errónea o un nombre mal pronunciado."
L.OPT_REPORT_LINE_ADDRESS = "Copia esta dirección y ábrela en tu navegador para informar de un problema con esta entrada."

L.AUDIO_READ_TIP = "Escuchar esta historia en voz alta."
L.REPORT_BUTTON = "Informar"
L.CONTRIBUTE_BUTTON = "Contribuir"
L.CONTRIBUTE_BUTTON_TIP_TITLE = "Spoken Places no tiene historia para este lugar"
L.CONTRIBUTE_BUTTON_TIP = "Contribuye describiéndolo: qué es, quién vive allí, qué pasó allí."
L.IN_ZONE_FMT = "Ubicación: %1$s"
L.DISCOVERED_FMT = "%1$d de %2$d descubiertas"

L.QUEUE_HELD_COMBAT = "Esperando que termine el combate."
L.QUEUE_HELD_CINEMATIC = "Esperando que termine la cinemática."
L.QUEUE_HELD_OFF = "La narración está desactivada."
L.NO_LORE_FOR = "Aún no hay historia registrada para %1$s."
L.LORE_NOT_WRITTEN = "%1$s está en el mapa, pero nadie ha escrito su historia todavía."
L.NOT_DISCOVERED = "Aún no has descubierto este lugar. Ve allí para leer su historia."
L.MAP_LORE_FOR_FMT = "historia de %1$s"
L.CMD_HEADING = "comandos (/spokenplaces, o /spp):"
L.CMD_STATUS = "  /spp            -- estado de la zona y el área actuales"
L.CMD_DIAGNOSTICS = "  /spp diagnostics -- Mostrar diagnóstico"
L.CMD_OPTIONS = "  /spp settings   -- la página Lugares de la configuración"
L.CMD_WINDOW = "  /spp window     -- abre Compendio de Azeroth"
L.CMD_PANEL = "  /spp panel      -- «Historia junto al mapa», sí o no"
L.CMD_PLAY = "  /spp play       -- lee la historia de donde estás"
L.CMD_STOP = "  /spp stop       -- deja de leer"
L.CMD_VOICE = "  /spp voice      -- «Leer historias en voz alta», sí o no"
L.CMD_AUTOPLAY = "  /spp autoplay   -- «Leer automáticamente», sí o no"
L.CMD_AUDIO = "  /spp audio      -- los paquetes de voces instalados"
L.CMD_LANG = "  /spp lang       -- Idioma del texto: lista, o cambia con /spp lang <code> o auto"
L.CMD_FORGET = "  /spp forget     -- Olvidar lugares oídos"


-- Added in the settings, subtitles and Zone Lore release.

-- Settings page: module switch and why a setting is unavailable
L.OPT_PAGE_TITLE = "Lugares"
L.OPT_DEV_DEBUG = "Depuración de Lugares"
L.OPT_DEV_PREVIEW = "Traducciones sin terminar"
L.REASON_VOICE = "Activa «Leer historias en voz alta» para usar esto."
L.REASON_DISCOVERY = "Activa «Leer automáticamente» para usar esto."
L.REASON_MAP_PANEL = "Activa «Historia junto al mapa» para usar esto."

-- Voice packs
L.OPT_DOWNLOAD_ADDRESS = "Copia esta dirección en tu navegador para descargar el paquete de voces."

-- Reading history
L.OPT_FORGET_PLACES = "Olvidar lugares oídos"
L.OPT_FORGET_PLACES_DONE = "Se ha borrado la lista de lugares oídos de este personaje."

-- Fixing a problem

-- Starting over
L.OPT_RESET_PAGE_CONFIRM = "¿Restablecer todos los ajustes de Lugares a su valor predeterminado?"
L.OPT_RELOAD_NOW = "Recargar ahora"
L.OPT_LATER = "Más tarde"

-- Lore of Azeroth and Zone Lore
L.COMPENDIUM_PLACES = "Lugares"
L.LORE_PANEL_TITLE = "Historia del lugar"
L.MAP_PANEL_EXPAND = "Mostrar historia del lugar"
L.OPEN_IN_LORE_TIP = "La historia de este lugar en el Compendio de Azeroth, junto a la de todas las demás zonas y áreas."
L.PANEL_SHOWN = "Historia junto al mapa: sí"
L.PANEL_HIDDEN = "Historia junto al mapa: no"
L.LORE_SEARCH = "Buscar lugares"
L.LORE_DISCOVERED_ONLY = "Solo descubiertas"
L.LORE_VOICED_ONLY = "Solo con voz"
L.LORE_SEARCH_NONE = "No hay coincidencias."
L.OTHER_LANDS = "Otras tierras"
L.BATTLEGROUNDS = "Campos de batalla"
L.DUNGEONS = "Mazmorras y bandas"
L.ZONES_PICK = "Elige a la izquierda una zona para leer su historia. Mayús-clic en un área pone su historia en la cola, tras lo que esté sonando."
L.DUNGEONS_PICK = "Elige a la izquierda una mazmorra o banda para leer su historia. Mayús-clic en una pone su historia en la cola, tras lo que esté sonando."

L.OPEN_IN_COMPENDIUM = "Abrir en el Compendio de Azeroth"

SpokenZones:RegisterStrings("esES", L)
SpokenZones:RegisterStrings("esMX", L)
