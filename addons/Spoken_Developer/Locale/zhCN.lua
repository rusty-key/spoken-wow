local _, Developer = ...

-- Simplified Chinese interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "zhCN" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "开发者"
L.OPT_DEVELOPER_INTRO = "用于测试 Spoken 和报告问题的工具。"
L.OPT_LOG_SECTION = "调试日志"
L.OPT_LOG_KEEP = "保留调试日志"
L.OPT_LOG_SIZE = "日志大小"
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%1$d/%2$d 行，%3$s"
L.LOG_SIZE_OTHERS_FMT = "；其他玩家的日志：%1$d"
L.OPT_LOG_SHOW = "显示日志"
L.OPT_LOG_COPY = "连同诊断复制"
L.OPT_LOG_WRITE = "为 AI 代理写入"
L.OPT_LOG_WRITE_TIP = "重新载入界面，把日志保存到磁盘。"
L.OPT_LOG_CLEAR = "清空日志"
L.OPT_LOG_COMMANDS = "/spoken log：显示日志\n/spoken log copy：连同诊断复制\n/spoken log write：为 AI 代理写入\n/spoken log on、/spoken log off：开启或关闭\n/spoken log clear：清空\n写入后或 /reload 之后，它保存在：\nWTF\\Account\\<账号>\\SavedVariables\\Spoken_Developer.lua"
L.OPT_CHAT_SECTION = "聊天信息"
L.OPT_TESTING_SECTION = "测试"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "如何让 AI 代理读取日志？"
L.OPT_LOG_AGENT_STEPS = "1. 保持任务窗口打开。\n2. 右键点击它的“贡献”或“报告问题”按钮。\n3. 选择“为 AI 代理写入调试日志”。界面会重新载入，从而保存日志。\n4. 问这台电脑上的 AI 代理（例如 Claude Code），例如：\n    “我刚打开的任务没有播放配音。请读取 Spoken 调试日志并告诉我原因。”\n\n或者，如果 AI 代理无法读取这台电脑上的文件（例如浏览器里的聊天）：在第 3 步改选“复制调试日志”（本页上为“连同诊断复制”），按 Ctrl+C，然后连同你的问题一起粘贴到代理的窗口中。"
-- The welcome window's switch (Spoken's UI/Welcome.lua asks for these).
L.WELCOME_LOG_TIP = "Spoken 会记下它播放了什么以及原因。出现问题时，请随报告一并发送日志；它只能显示开启期间发生的事。可在 Spoken > 开发者 中再次关闭。"
-- The box (UI/Box.lua, Copy.lua).
L.LOG_BOX_TITLE = "Spoken 调试日志 - 按 Ctrl+A，再按 Ctrl+C 复制"
L.BOX_TITLE_COPY = "Spoken 调试日志（含诊断）- 按 Ctrl+A，再按 Ctrl+C 复制"
-- A Report button's right-click (UI/Menu.lua).
L.MENU_COPY = "复制调试日志"
L.MENU_WRITE = "为 AI 代理写入调试日志"
L.MENU_TURN_ON = L.OPT_LOG_KEEP
L.MENU_HINT = "右键点击：复制调试日志，或为 AI 代理写入"
L.MENU_HINT_OFF = "右键点击：启用调试日志记录，以便随报告发送"
