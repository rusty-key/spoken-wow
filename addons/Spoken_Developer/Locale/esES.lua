local _, Developer = ...

-- Spanish interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "esES" and GetLocale() ~= "esMX" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "Desarrollador"
L.OPT_DEVELOPER_INTRO = "Herramientas de desarrollo para Spoken: el registro de depuración, los modos de depuración y lo que los módulos de Spoken añaden para probar."
L.OPT_LOG_SECTION = "Depuración"
L.OPT_LOG_KEEP = "Registrar la depuración"
L.OPT_LOG_KEEP_TIP = "Anota lo que Spoken reproduce y por qué: cada línea puesta en cola, iniciada, detenida o descartada, con la hora, el diagnóstico y lo que añaden los módulos de Spoken. Se conserva entre sesiones, hasta 2000 líneas, para enviarlo con un informe. Mientras está desactivado no se guarda nada."
L.OPT_LOG_SIZE = "Tamaño"
L.OPT_LOG_SIZE_TIP = "Cuántas de las 2000 líneas que conserva están en uso y cuánto espacio ocupan en Spoken_Developer.lua."
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%d de %d líneas, %s"
L.LOG_SIZE_OTHERS_FMT = "; registros de otros jugadores: %d"
L.OPT_LOG_SHOW = "Mostrar el registro"
L.OPT_LOG_SHOW_TIP = "El registro, y los que hayan reunido otros addons de Spoken, en una sola línea de tiempo dentro de un cuadro: Ctrl+A y luego Ctrl+C para copiarlo."
L.OPT_LOG_COPY = "Copiar con diagnóstico"
L.OPT_LOG_COPY_TIP = "El diagnóstico y luego todo el registro, en un cuadro: Ctrl+A y luego Ctrl+C para copiarlo. Un clic derecho en un botón de Informar hace lo mismo."
L.OPT_LOG_WRITE = "Escribir para un agente de IA"
L.OPT_LOG_WRITE_TIP = "Guarda ahora el registro en el disco, con el estado actual (la ventana, la misión, la cola), recargando la interfaz: el juego solo escribe los archivos de un addon en ese momento. Así un agente de IA en este equipo puede leerlo: dile qué salió mal."
L.OPT_LOG_CLEAR = "Vaciar el registro"
L.OPT_LOG_CLEAR_TIP = "Vacía el registro, para que lo que siga se lea como una sesión de prueba aparte."
L.OPT_LOG_COMMANDS = "/spoken log: lo muestra\n/spoken log copy: lo copia con el diagnóstico\n/spoken log write: lo escribe para un agente de IA\n/spoken log on, /spoken log off: lo activa o lo desactiva\n/spoken log clear: lo vacía\nEscrito, o tras un /reload, está en:\nWTF\\Account\\<cuenta>\\SavedVariables\\Spoken_Developer.lua"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "¿Cómo usar un agente de IA para leer los registros?"
L.OPT_LOG_AGENT_STEPS = "1. Deja la misión abierta.\n2. Haz clic derecho en su botón Contribuir o Informar de un problema.\n3. Elige \"Escribir el registro para un agente de IA\". La interfaz se recarga y así guarda el registro.\n4. Pregunta al agente de IA de este equipo (Claude Code, por ejemplo), por ejemplo:\n    \"La voz no sonó en la misión que acabo de abrir. Lee el registro de depuración de Spoken y dime por qué.\"\n\nO, para un agente de IA que no puede leer los archivos de este equipo (un chat en el navegador): en el paso 3, elige \"Copiar el registro de depuración\" (en esta página, \"Copiar con diagnóstico\"), pulsa Ctrl+C y pégalo en la ventana del agente junto con tu pregunta."
-- The welcome window's switch (Spoken's UI/Welcome.lua asks for these).
L.WELCOME_LOG_TIP = "Spoken anota lo que reproduce y por qué. Si algo falla, el registro es lo que hay que enviar con el informe, y solo muestra lo ocurrido mientras estaba activado. Está en Spoken > Desarrollador, donde se puede volver a desactivar."
-- The box (UI/Box.lua, Copy.lua).
L.LOG_BOX_TITLE = "Registro de depuración de Spoken - Ctrl+A y luego Ctrl+C para copiar"
L.BOX_TITLE_COPY = "Registro de depuración de Spoken con diagnóstico - Ctrl+A y luego Ctrl+C para copiar"
-- A Report button's right-click (UI/Menu.lua).
L.MENU_COPY = "Copiar el registro de depuración"
L.MENU_WRITE = "Escribir el registro para un agente de IA"
L.MENU_TURN_ON = L.OPT_LOG_KEEP
L.MENU_HINT = "Clic derecho: copiar el registro de depuración o escribirlo para un agente de IA"
L.MENU_HINT_OFF = "Clic derecho: registrar la depuración para los informes"
