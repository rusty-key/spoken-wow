local _, Developer = ...

-- Brazilian Portuguese interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "ptBR" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "Desenvolvedor"
L.OPT_DEVELOPER_INTRO = "Ferramentas de desenvolvimento para o Spoken: o registro de depuração, os modos de depuração e o que os módulos do Spoken acrescentam para testes."
L.OPT_LOG_SECTION = "Depuração"
L.OPT_LOG_KEEP = "Ativar o registro de depuração"
L.OPT_LOG_KEEP_TIP = "Anota o que o Spoken toca e por quê: cada fala enfileirada, iniciada, parada ou descartada, com o horário, o diagnóstico e o que os módulos do Spoken acrescentam. Fica guardado entre sessões, até 2000 linhas, para enviar com um relato. Enquanto estiver desligado, nada é guardado."
L.OPT_LOG_SIZE = "Tamanho"
L.OPT_LOG_SIZE_TIP = "Quantas das 2000 linhas que ele guarda estão em uso e quanto espaço ocupam em Spoken_Developer.lua."
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%d de %d linhas, %s"
L.LOG_SIZE_OTHERS_FMT = "; registros de outros jogadores: %d"
L.OPT_LOG_SHOW = "Mostrar o registro"
L.OPT_LOG_SHOW_TIP = "O registro, e os reunidos por outros addons do Spoken, numa só linha do tempo dentro de uma caixa: Ctrl+A e depois Ctrl+C para copiar."
L.OPT_LOG_COPY = "Copiar com diagnóstico"
L.OPT_LOG_COPY_TIP = "O diagnóstico e depois o registro inteiro, numa caixa: Ctrl+A e depois Ctrl+C para copiar. Um clique direito num botão Relatar faz o mesmo."
L.OPT_LOG_WRITE = "Gravar para um agente de IA"
L.OPT_LOG_WRITE_TIP = "Salva o registro no disco agora, com a situação do momento (a janela, a missão, a fila), recarregando a interface: o jogo só grava os arquivos de um addon nessa hora. Um agente de IA neste computador pode então lê-lo: diga a ele o que deu errado."
L.OPT_LOG_CLEAR = "Limpar o registro"
L.OPT_LOG_CLEAR_TIP = "Esvazia o registro, para que o que vier depois seja lido como uma sessão de teste à parte."
L.OPT_LOG_COMMANDS = "/spoken log: mostra o registro\n/spoken log copy: copia com o diagnóstico\n/spoken log write: grava para um agente de IA\n/spoken log on, /spoken log off: liga ou desliga\n/spoken log clear: esvazia o registro\nGravado, ou depois de um /reload, está em:\nWTF\\Account\\<conta>\\SavedVariables\\Spoken_Developer.lua"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "Como usar um agente de IA para ler os registros?"
L.OPT_LOG_AGENT_STEPS = "1. Deixe a missão aberta.\n2. Clique com o botão direito no botão Contribuir ou Informar um problema dela.\n3. Escolha \"Gravar o registro para um agente de IA\". A interface recarrega, o que salva o registro.\n4. Pergunte ao agente de IA deste computador (o Claude Code, por exemplo), por exemplo:\n    \"A narração não tocou na missão que acabei de abrir. Leia o registro de depuração do Spoken e me diga por quê.\"\n\nOu, para um agente de IA que não consegue ler os arquivos deste computador (um chat no navegador): no passo 3, escolha \"Copiar o registro de depuração\" (nesta página, \"Copiar com diagnóstico\"), pressione Ctrl+C e cole na janela do agente junto com a sua pergunta."
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
