-- ptBR. Brazilian Portuguese interface strings for Spoken Places.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, SpokenZones = ...

if GetLocale() ~= "ptBR" then
	return
end

local L = {}

L.OPT_SECTION_MAP = "Histórias"
L.OPT_MAP_PANEL = "História ao lado do mapa"
L.OPT_PICTURES = "Mostrar imagens"
L.OPT_MAP_HIGHLIGHT = "Destaque de áreas"
L.OPT_PANEL_WIDTH = "Largura da história"
L.OPT_PLAY_BUTTON = "Ler histórias em voz alta"
L.OPT_AUTOPLAY = "Ler automaticamente"
L.OPT_AUTOPLAY_SUB = "Incluir áreas menores"
L.OPT_AUTOPLAY_EXPLORED = "Incluir lugares já encontrados"
L.OPT_AUTOPLAY_EXPLORED_TIP = "Lê cada lugar uma vez por personagem, mesmo um já descoberto."
L.OPT_LANG_RELOAD = "Digite /reload para trocar para ele."
L.OPT_LANGUAGE = "Idioma do texto"
L.OPT_LANGUAGE_TIP = "O texto das histórias; a voz segue o idioma da voz."
L.OPT_LANG_AUTO_FMT = "Automático (%1$s)"
L.OPT_LANG_SET_FMT = "As histórias estarão em %1$s depois que a interface recarregar."
L.OPT_LANG_PROFILE_FMT = "Este perfil lê as histórias em %1$s. Digite /reload para trocar."
L.OPT_REPORT_PROBLEM = "Informar um problema"
L.MENU_LORE_WINDOW = "Abrir Compêndio de Azeroth"
L.MENU_ZONE_SETTINGS = "Configurações de Lugares"

L.OPT_REPORT_LINE_TIP = "Receba um link para informar uma história errada, uma leitura errada ou um nome mal pronunciado."
L.OPT_REPORT_LINE_ADDRESS = "Copie este endereço e abra-o no navegador para informar um problema com esta entrada."

L.AUDIO_READ_TIP = "Ouvir esta história em voz alta."
L.REPORT_BUTTON = "Informar"
L.IN_ZONE_FMT = "Local: %1$s"
L.DISCOVERED_FMT = "%1$d de %2$d descobertas"

L.QUEUE_HELD_COMBAT = "Aguardando o fim do combate."
L.QUEUE_HELD_CINEMATIC = "Aguardando o fim da cinemática."
L.QUEUE_HELD_OFF = "A narração está desligada."
L.NOT_DISCOVERED = "Você ainda não descobriu este lugar. Vá até lá para ler sua história."
L.MAP_LORE_FOR_FMT = "história de %1$s"
L.CMD_HEADING = "comandos (/spokenplaces, ou /spp):"
L.CMD_STATUS = "  /spp            -- estado da zona e da área atuais"
L.CMD_DIAGNOSTICS = "  /spp diagnostics -- Mostrar diagnóstico"
L.CMD_OPTIONS = "  /spp settings   -- a página Lugares das configurações"
L.CMD_WINDOW = "  /spp window     -- abre Compêndio de Azeroth"
L.CMD_PANEL = "  /spp panel      -- História ao lado do mapa, liga ou desliga"
L.CMD_PLAY = "  /spp play       -- lê a história de onde você está"
L.CMD_STOP = "  /spp stop       -- para de ler"
L.CMD_VOICE = "  /spp voice      -- Ler histórias em voz alta, liga ou desliga"
L.CMD_AUTOPLAY = "  /spp autoplay   -- Ler automaticamente, liga ou desliga"
L.CMD_AUDIO = "  /spp audio      -- os pacotes de voz instalados"
L.CMD_LANG = "  /spp lang       -- Idioma do texto: lista, ou troca com /spp lang <code> ou auto"
L.CMD_FORGET = "  /spp forget     -- Esquecer lugares ouvidos"


-- Added in this release.
L.REASON_VOICE = "Marque Ler histórias em voz alta para usar isto."
L.OPT_FORGET_PLACES = "Esquecer lugares ouvidos"
L.OPT_FORGET_PLACES_DONE = "A lista de lugares ouvidos deste personagem foi limpa."
L.OPT_DOWNLOAD_ADDRESS = "Copie este endereço no seu navegador para baixar o pacote de voz."
L.OPEN_IN_LORE_TIP = "A história deste lugar no Compêndio de Azeroth, ao lado das de todas as outras zonas e áreas."
L.OTHER_LANDS = "Outras terras"
L.BATTLEGROUNDS = "Campos de batalha"
L.DUNGEONS = "Masmorras e raides"
L.COMPENDIUM_PLACES = "Lugares"
L.LORE_PANEL_TITLE = "História do Lugar"
L.MAP_PANEL_EXPAND = "Mostrar História do Lugar"
L.PANEL_SHOWN = "História ao lado do mapa: ligado"
L.PANEL_HIDDEN = "História ao lado do mapa: desligado"
L.LORE_SEARCH = "Buscar lugares"
L.LORE_DISCOVERED_ONLY = "Só descobertas"
L.LORE_VOICED_ONLY = "Só com voz"
L.LORE_SEARCH_NONE = "Nada encontrado."
L.REASON_DISCOVERY = "Marque Ler automaticamente para usar isto."
L.REASON_MAP_PANEL = "Marque História ao lado do mapa para usar isto."
L.OPT_RESET_PAGE_CONFIRM = "Voltar todas as configurações de Lugares ao padrão?"
L.OPT_RELOAD_NOW = "Recarregar agora"
L.OPT_LATER = "Depois"
L.OPT_PAGE_TITLE = "Lugares"
L.OPT_DEV_DEBUG = "Depuração de Lugares"
L.OPT_DEV_PREVIEW = "Oferecer traduções inacabadas"

L.OPEN_IN_COMPENDIUM = "Abrir no Compêndio de Azeroth"

SpokenZones:RegisterStrings("ptBR", L)
