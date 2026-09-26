local _, SpokenBooks = ...

-- Portuguese interface strings for Spoken Books.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "ptBR" then
	return
end
L.OPT_NOTE = "Livros, cartas e notas lidos em voz alta pelo reprodutor Spoken. A narração precisa do pacote Spoken Books Audio."
L.OPT_SECTION_READING = "Leitura"
L.OPT_AUTOPLAY = "Ler um livro ao abri-lo"
L.OPT_AUTOPLAY_TIP = "Desativado, nada começa sozinho e um livro só é lido ao apertar Reproduzir ou digitar /spb read."
L.OPT_WHOLE_BOOK = "Ler o livro inteiro, não só a página visível"
L.OPT_WHOLE_BOOK_TIP = "Abrir a primeira página enfileira o resto, assim um diário continua enquanto você vira suas páginas."
L.OPT_READ_ONCE = "Ler cada livro uma só vez"
L.OPT_READ_ONCE_TIP = "Um livro já ouvido neste personagem não é lido de novo ao abri-lo. Reproduzir continua funcionando, e o lido é lembrado por personagem."
L.OPT_SECTION_READ = "O que este personagem leu"
L.OPT_FORGET = "Esquecer o que foi lido"
L.OPT_FORGET_DONE_FMT = "esquecido %1$d livro%2$s; serão lidos de novo"
L.OPT_FORGET_TIP = "Apaga o registro deste personagem, para cada livro ser novo de novo. Só importa enquanto “Ler cada livro uma só vez” está ativado."
L.PLAY = "Reproduzir"
L.STOP = "Parar"
L.PLAY_TIP = "Ler este livro em voz alta"
L.STOP_TIP = "Parar de ler este livro"
L.CONTRIBUTE = "Contribuir"
L.REPORT = "Informar"
L.NO_LINE = "Sem fala para esta página"
L.NO_LINE_TIP = "Envie o texto do seu próprio cliente para adicioná-lo."
L.MENU_READ_BOOK = "Ler este livro"
L.MENU_BOOK_SETTINGS = "Configurações do Spoken Books"
L.OPT_SECTION_LANGUAGE = "Idioma"
L.OPT_VOICE_LANGUAGE = "Idioma da voz"
L.OPT_VOICE_LANGUAGE_TIP = "De qual idioma é o pacote de som que lê para você. Automático usa o idioma do seu jogo. Um idioma só é ouvido se um pacote gravado nele estiver instalado."
L.OPT_LANG_AUTO_FMT = "Automático (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "Idioma alternativo"
L.OPT_FALLBACK_LANGUAGE_TIP = "O que ler quando nenhum pacote no seu idioma tem a página. Nenhum a deixa silenciosa em vez de lê-la num idioma não pedido."
L.OPT_FALLBACK_NONE = "Nenhum (silêncio)"
L.OPT_NO_PACK_AUDIO = "O pacote de som instalado ainda não tem narração para esta página."
L.OPT_NO_PACK_INSTALLED = "Nenhum pacote de som do Spoken Books instalado."
L.OPT_PAGE_COUNT_FMT = "Página %1$d de %2$d"
