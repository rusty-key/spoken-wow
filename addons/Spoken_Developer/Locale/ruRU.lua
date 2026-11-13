local _, Developer = ...

-- Russian interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "ruRU" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "Разработчик"
L.OPT_DEVELOPER_INTRO = "Инструменты для проверки Spoken и сообщений о проблемах."
L.OPT_LOG_SECTION = "Журнал отладки"
L.OPT_LOG_KEEP = "Вести журнал отладки"
L.OPT_LOG_SIZE = "Размер журнала"
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%1$d из %2$d строк, %3$s"
L.LOG_SIZE_OTHERS_FMT = "; журналы других игроков: %1$d"
L.OPT_LOG_SHOW = "Показать журнал"
L.OPT_LOG_COPY = "Копировать с диагностикой"
L.OPT_LOG_WRITE = "Записать для ИИ-агента"
L.OPT_LOG_WRITE_TIP = "Перезагружает интерфейс, чтобы сохранить журнал на диск."
L.OPT_LOG_CLEAR = "Очистить журнал"
L.OPT_LOG_COMMANDS = "/spoken log: показать журнал\n/spoken log copy: скопировать с диагностикой\n/spoken log write: записать для ИИ-агента\n/spoken log on, /spoken log off: включить или выключить\n/spoken log clear: очистить\nЗаписанный или после /reload, он лежит в:\nWTF\\Account\\<учётная запись>\\SavedVariables\\Spoken_Developer.lua"
L.OPT_CHAT_SECTION = "Сообщения в чате"
L.OPT_TESTING_SECTION = "Тестирование"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "Как поручить ИИ-агенту прочитать журналы?"
L.OPT_LOG_AGENT_STEPS = "1. Не закрывайте задание.\n2. Щёлкните правой кнопкой по его кнопке «Помочь» или «Сообщить о проблеме».\n3. Выберите «Записать журнал для ИИ-агента». Интерфейс перезагрузится и сохранит журнал.\n4. Спросите ИИ-агента на этом компьютере (например, Claude Code), например:\n    «Озвучка не прозвучала для задания, которое я только что открыл. Прочитай журнал отладки Spoken и скажи почему.»\n\nИли, для ИИ-агента, который не может читать файлы этого компьютера (чат в браузере): на шаге 3 выберите «Копировать журнал отладки» (на этой странице «Копировать с диагностикой»), нажмите Ctrl+C и вставьте его в окно агента вместе со своим вопросом."
-- The welcome window's switch (Spoken's UI/Welcome.lua asks for these).
L.WELCOME_LOG_TIP = "Spoken записывает, что и почему воспроизводит. Если что-то пойдёт не так, приложите журнал к сообщению; он показывает только то, что было, пока он был включён. Он находится в Spoken > Разработчик, где его можно снова выключить."
-- The box (UI/Box.lua, Copy.lua).
L.LOG_BOX_TITLE = "Журнал отладки Spoken - Ctrl+A, затем Ctrl+C, чтобы скопировать"
L.BOX_TITLE_COPY = "Журнал отладки Spoken с диагностикой - Ctrl+A, затем Ctrl+C, чтобы скопировать"
-- A Report button's right-click (UI/Menu.lua).
L.MENU_COPY = "Копировать журнал отладки"
L.MENU_WRITE = "Записать журнал для ИИ-агента"
L.MENU_TURN_ON = L.OPT_LOG_KEEP
L.MENU_HINT = "Правый щелчок: скопировать журнал отладки или записать его для ИИ-агента"
L.MENU_HINT_OFF = "Правый щелчок: записывать журнал отладки для сообщений"
