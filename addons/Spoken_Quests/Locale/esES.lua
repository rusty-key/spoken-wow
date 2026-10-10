-- Spanish interface strings for the Spoken Quests options and quest-window buttons.
-- Covers both esES and esMX: nothing in these strings varies by region.
--
-- Keyed exactly as in Strings.lua; anything missing falls back to English.
-- Positional format arguments (%1$s) stay positional when Spanish needs a
-- different word order.

if not (VoiceOver and VoiceOver.SpokenDialogue) then return end
setfenv(1, VoiceOver)

if GetLocale() ~= "esES" and GetLocale() ~= "esMX" then
	return
end

L.OPT_GROUP_GENERAL = "General"
L.OPT_GROUP_AUDIO = "Audio"
L.OPT_AUTOPLAY = "Leer el diálogo al abrirse"
L.OPT_AUTOPLAY_TIP = "Ventanas de misión. Desactivado, no se lee nada hasta que pulses Escuchar en la ventana o escribas /spq read."
L.OPT_SYNC_WINDOW = "Sincronizar el diálogo con la ventana"
L.OPT_SYNC_WINDOW_TIP = "La narración se detendrá automáticamente al cerrar la ventana de misión."
L.OPT_SECTION_LANGUAGE = "Idioma"
L.OPT_VOICE_LANGUAGE = "Idioma de las voces"
L.OPT_VOICE_LANGUAGE_TIP = "En qué idioma hablan las voces. Automático usa el idioma de tu juego. Un idioma solo se oye si su paquete de voces está instalado."
L.OPT_LANG_AUTO_FMT = "Automático (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "Si falta una línea"
L.OPT_FALLBACK_LANGUAGE_TIP = "Qué reproducir cuando el paquete de voces de tu idioma no tiene grabada una línea: la misma línea en otro idioma, o nada."
L.OPT_FALLBACK_NONE = "Silencio"
L.OPT_GROUP_DEBUG = "Herramientas de depuración"
L.OPT_DEBUG = "Activar mensajes de depuración"
L.OPT_DEBUG_TIP = "Muestra algunos mensajes de depuración «útiles» en la ventana de chat."
L.OPT_DEV_MOCK_MISSING = "Simular voz ausente"
L.OPT_DEV_MOCK_MISSING_TIP = "Trata cada línea de misión como si ningún paquete instalado la tuviera: al abrir una misión no suena nada, los botones de reproducir no encuentran nada y aparece el enlace para informar de la voz ausente. Muestra cómo se ve una misión sin voz. Sigue activo hasta que lo desactives; Spoken Quests te lo recuerda al iniciar sesión."
L.OPT_DEV_MOCK_ON = "Simular voz ausente está activado: no suena ninguna línea de misión. Desactívalo en Spoken > Desarrollador."
L.OPT_AVAILABLE_GROUP = "|cFF00CCFFDisponibles|r"
L.OPT_ROW_ADDON_NAME = "Nombre del addon"
L.OPT_ROW_TITLE = "Título"
L.OPT_ROW_FORMAT_VERSION = "Versión del formato de datos"
L.OPT_ROW_PRIORITY = "Prioridad del módulo"
L.OPT_ROW_CONTENT_VERSION = "Versión del contenido"
L.OPT_ROW_LOAD_ON_DEMAND = "Cargar bajo demanda"
L.OPT_ROW_LOADED = "Cargado"
L.OPT_ROW_REASON_FMT = "%1$sMotivo: |r%2$s%3$s|r"
L.OPT_LOAD_BUTTON = "Cargar"
L.OPT_DOWNLOAD_URL = "URL de descarga"
L.OPT_UPDATE_SUFFIX = " (actualización)"
L.OPT_NOT_LOADED_SUFFIX = " (no cargado)"
L.OPT_NEW_SUFFIX = " (NUEVO)"
L.OPT_CONTENT_VERSION_FMT = "%1$s"
L.OPT_CONTENT_VERSION_UPDATE_FMT = "%2$s -> |cFF00CCFF%1$s|r"
L.OPT_CMD_GROUP = "Comandos"
L.OPT_STOP = "Detener"
L.OPT_STOP_TIP = "Detiene la línea de esta misión. Repetir la empieza de nuevo desde el principio."
L.OPT_REPLAY = "Repetir"
L.OPT_REPLAY_TIP = "Reproduce la línea de esta misión otra vez desde el principio."
L.OPT_CMD_PLAYPAUSE = "Detener o repetir audio"
L.OPT_CMD_PLAYPAUSE_DESC = "Detiene la línea o repite desde el principio una detenida"
L.OPT_CMD_PAUSE = "Detener audio"
L.OPT_CMD_PAUSE_DESC = "Detiene la línea que se está leyendo"
L.OPT_CMD_PLAY = "Reproducir audio"
L.OPT_CMD_PLAY_DESC = "Reproduce desde el principio una línea detenida"
L.OPT_CMD_SKIP = "Omitir línea"
L.OPT_CMD_SKIP_DESC = "Omite la voz que se está reproduciendo"
L.OPT_CMD_CLEAR = "Vaciar cola"
L.OPT_CMD_CLEAR_DESC = "Detiene la reproducción y vacía la cola de voces"
L.OPT_CMD_READ = "Leer misión visible"
L.OPT_CMD_READ_DESC = "Narra el panel de misión visible"
L.OPT_CMD_TEST = "Probar audio"
L.OPT_CMD_TEST_DESC = "Reproduce una línea de misión conocida para comprobar que la oyes"
L.OPT_CMD_DIAG = "Diagnóstico"
L.OPT_CMD_DIAG_DESC = "Muestra el estado del cliente, la API y la carga de paquetes de voces"
L.OPT_CMD_OPTIONS = "Abrir opciones"
L.OPT_CMD_OPTIONS_DESC = "Abre la ventana de opciones"
L.OPT_PANEL_NOTE = "Voces para los PNJ que dan misiones. El volumen, el idioma, la ventana y los subtítulos están en la página Spoken, ya que valen para todos los módulos."
L.OPT_SECTION_DIALOGUE = "Cuándo leer"
L.OPT_PANEL_AUTOPLAY = "Leer automáticamente"
L.OPT_PANEL_AUTOPLAY_TIP = "Lee las misiones en cuanto se abre su ventana. Desactivado, nada empieza solo: pulsa Escuchar en la ventana o escribe /spq read."
L.OPT_PANEL_STOP_ON_CLOSE = "Detener al cerrar la ventana"
L.OPT_PANEL_STOP_ON_CLOSE_TIP = "Detiene la voz en cuanto cierras la ventana de misión."
L.OPT_SECTION_PACKS = "Paquetes de voces"
L.OPT_NO_PACK = "|cffff8080Ningún paquete de voces instalado.|r Sin uno no se lee nada en voz alta."
L.OPT_COPY_ADDRESS_FMT = "Muestra la dirección para copiarla en tu navegador: %1$s"
L.OPT_SECTION_TROUBLE = "Solucionar un problema"
L.OPT_TEST_LINE = "Reproducir una línea de prueba"
L.OPT_TEST_LINE_TIP = "Reproduce una línea que Spoken Quests sabe que tiene, igual que suena una real, para comprobar que la oyes."
L.OPT_PRINT_DIAG = "Mostrar diagnóstico"
L.OPT_PRINT_DIAG_TIP = "Muestra en el chat la versión del juego, la configuración de sonido y los paquetes de voces instalados, para un informe de errores."
L.OPT_RESET_PROFILE = "Restablecer configuración de Misiones"
L.OPT_RESET_PROFILE_TIP = "Devuelve todos los ajustes de esta página a su valor predeterminado, en el perfil en uso."
L.OPT_PLAY = "Reproducir"
L.OPT_AUTOPLAY_OFF_TIP = "«Leer automáticamente» está desactivado en la página Misiones de la configuración de Spoken."
L.OPT_CONTRIBUTE = "Contribuir"
L.OPT_MINIMAP_SETTINGS = "Configuración de Misiones"
L.OPT_PACK_ALL = "Todas"
L.OPT_PACK_ALLIANCE = "Alianza"
L.OPT_PACK_HORDE = "Horda"
L.OPT_PACK_SHARED = "Compartidas"
L.OPT_PACK_GOSSIP = "Charlas"

-- Added in the settings, subtitles and Zone Lore release.

-- Settings page: module switch and sections
L.OPT_PAGE_TITLE = "Misiones"
L.OPT_PART_SWITCH = "Activar módulo"
L.OPT_PART_SWITCH_TIP = "Activa o desactiva las voces de misiones. Desactivado, el módulo sigue instalado pero no lee nada. El mismo interruptor está en la página Spoken."
L.REASON_PART_OFF = "Activa «Activar módulo», arriba en esta página, para usar esto."
L.REASON_AUTOPLAY = "Activa «Leer automáticamente» para usar esto."
L.OPT_SECTION_EXTRAS = "Extras"
-- UI/DialogueUIBridge.lua
L.OPT_SECTION_DIALOGUEUI = "DialogueUI"
L.OPT_DUI_NOTE = "Para el addon DialogueUI, cuya ventana sustituye a las de misiones y conversación y oculta el resto de la interfaz mientras está abierta."
L.OPT_DUI_CAPTIONS = "Marcar las palabras leídas"
L.OPT_DUI_CAPTIONS_TIP = "En el texto de misiones y conversación de DialogueUI, las palabras siguen a la voz como los subtítulos de Spoken. Si se van escribiendo, se resaltan o ambas cosas se elige en la página de Spoken: «Ir escribiendo el texto» y «Resaltar palabras»."
L.OPT_DUI_AUTOSCROLL = "Mantener las palabras a la vista"
L.OPT_DUI_AUTOSCROLL_TIP = "Desplaza el texto de DialogueUI cuando las palabras leídas salen de la vista."
L.OPT_DUI_SHOW_PLAYER = "Ver Spoken sobre DialogueUI"
L.OPT_DUI_SHOW_PLAYER_TIP = "DialogueUI oculta el resto de la interfaz mientras está abierta, y con ella la ventana o los subtítulos de Spoken. Activado, se quedan en pantalla donde los pusiste, y se pueden seguir moviendo."
L.OPT_DUI_PLAY_BUTTON = "Botón Escuchar en DialogueUI"
L.OPT_DUI_PLAY_BUTTON_TIP = "El botón de reproducir de Spoken Quests, en la esquina superior izquierda de la ventana de DialogueUI, en las páginas de las que tiene grabación, esté activado o no el texto a voz de DialogueUI. Clic izquierdo reproduce la línea o la detiene. Clic derecho activa o desactiva «Leer automáticamente». Con el texto a voz de DialogueUI activado, su propio botón también reproduce la grabación."
L.OPT_DUI_ON = "Activado"
L.OPT_DUI_OFF = "Desactivado"
L.OPT_DUI_PLAY_RIGHT_CLICK = "Clic derecho para activar o desactivar «Leer automáticamente»."
L.OPT_DUI_MISSING = "DialogueUI no está cargado."
L.OPT_DUI_NO_PLAYER = "Necesita el addon Spoken."
L.OPT_DUI_OLD_PLAYER = "Necesita una versión más reciente de Spoken."
L.OPT_DUI_UNKNOWN = "No se reconoce esta versión de DialogueUI."
L.REASON_DUI_CAPTIONS = "Activa «Marcar las palabras leídas» para usar esto."
L.OPT_ROW_LANGUAGE = "Idioma"

-- Follow-up lines
L.OPT_FOLLOWUP = "Experimental: activar continuaciones de misión"
L.OPT_FOLLOWUP_TIP = "Algunos PNJ hablan en el chat después de que aceptes o entregues una misión. Solo se leen las líneas que provoca tu propia misión, nunca las de otro jugador."
L.OPT_PANEL_FOLLOWUP = "Líneas de continuación"
L.OPT_PANEL_FOLLOWUP_TIP = "Algunos PNJ hablan en el chat después de que aceptes o entregues una misión. Solo se leen las líneas que provoca tu propia misión, nunca las de otro jugador."
L.OPT_CMD_FOLLOWUP = "Continuación"
L.OPT_CMD_FOLLOWUP_DESC = "Repite las líneas de continuación de los PNJ de una misión como si acabaras de entregarla: /spq followup <questID> [start]"

-- Reading history

-- Voice packs
L.OPT_PACK_NAME_FMT = "Paquete (%1$s)"
L.OPT_PACK_INCLUDED = "Incluido en «Todas»"
L.OPT_PACK_LOADED = "Instalado"
L.OPT_PACK_NOT_LOADED = "No cargado"
L.OPT_DOWNLOAD = "Descargar"

-- Quest window buttons
L.OPT_PLAY_TIP = "Escucha esta misión leída en voz alta."

-- Fixing a problem
L.OPT_REPORT_PROBLEM = "Informar de un problema"
L.OPT_REPORT_QUEST_TIP = "Obtén un enlace para informar de una lectura errónea o de un nombre mal pronunciado."
L.OPT_REPORT_PROBLEM_TIP = "Para todo lo que no sea sobre una sola línea; cada línea tiene su propio botón Informar. Te da una dirección para copiar en tu navegador."

-- Starting over
L.OPT_SECTION_START_OVER = "Empezar de cero"
L.OPT_RESET_PROFILE_CONFIRM = "¿Restablecer todos los ajustes de Misiones del perfil en uso a su valor predeterminado?"
L.OPT_RESET = "Restablecer"
L.OPT_CANCEL = "Cancelar"
