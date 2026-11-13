local _, Developer = ...

-- Brazilian Portuguese interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "ptBR" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "Desenvolvedor"
L.OPT_DEVELOPER_INTRO = "Ferramentas para testar o Spoken e informar problemas."
L.OPT_LOG_SECTION = "Depuração"
L.OPT_LOG_KEEP = "Manter registro de depuração"
L.OPT_LOG_SIZE = "Tamanho do registro"
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%1$d de %2$d linhas, %3$s"
L.LOG_SIZE_OTHERS_FMT = "; registros de outros jogadores: %1$d"
L.OPT_LOG_SHOW = "Mostrar o registro"
L.OPT_LOG_COPY = "Copiar com diagnóstico"
L.OPT_LOG_WRITE = "Gravar para um agente de IA"
L.OPT_LOG_WRITE_TIP = "Recarrega a interface para salvar o registro no disco."
L.OPT_LOG_CLEAR = "Limpar o registro"
L.OPT_LOG_COMMANDS = "/spoken log: mostra o registro\n/spoken log copy: copia com o diagnóstico\n/spoken log write: grava para um agente de IA\n/spoken log on, /spoken log off: liga ou desliga\n/spoken log clear: esvazia o registro\nGravado, ou depois de um /reload, está em:\nWTF\\Account\\<conta>\\SavedVariables\\Spoken_Developer.lua"
L.OPT_CHAT_SECTION = "Mensagens no chat"
L.OPT_TESTING_SECTION = "Testes"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "Como usar um agente de IA para ler os registros?"
L.OPT_LOG_AGENT_STEPS = "1. Deixe a missão aberta.\n2. Clique com o botão direito no botão Contribuir ou Informar um problema dela.\n3. Escolha “Gravar o registro para um agente de IA”. A interface recarrega, o que salva o registro.\n4. Pergunte ao agente de IA deste computador (o Claude Code, por exemplo), por exemplo:\n    “A narração não tocou na missão que acabei de abrir. Leia o registro de depuração do Spoken e me diga por quê.”\n\nOu, para um agente de IA que não consegue ler os arquivos deste computador (um chat no navegador): no passo 3, escolha “Copiar o registro de depuração” (nesta página, “Copiar com diagnóstico”), pressione Ctrl+C e cole na janela do agente junto com a sua pergunta."
-- The welcome window's switch (Spoken's UI/Welcome.lua asks for these).
L.WELCOME_LOG_TIP = "O Spoken anota o que toca e por quê. Se algo der errado, o registro é o que se envia com o relato, e ele só mostra o que aconteceu enquanto estava ligado. Fica em Spoken > Desenvolvedor, onde pode ser desligado de novo."
-- The box (UI/Box.lua, Copy.lua).
L.LOG_BOX_TITLE = "Registro de depuração do Spoken - Ctrl+A e depois Ctrl+C para copiar"
L.BOX_TITLE_COPY = "Registro de depuração do Spoken com diagnóstico - Ctrl+A e depois Ctrl+C para copiar"
-- A Report button's right-click (UI/Menu.lua).
L.MENU_COPY = "Copiar o registro de depuração"
L.MENU_WRITE = "Gravar o registro para um agente de IA"
L.MENU_TURN_ON = L.OPT_LOG_KEEP
L.MENU_HINT = "Clique direito: copiar o registro de depuração ou gravá-lo para um agente de IA"
L.MENU_HINT_OFF = "Clique direito: ativar o registro de depuração para relatos"
