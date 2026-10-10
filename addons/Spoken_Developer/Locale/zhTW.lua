local _, Developer = ...

-- Traditional Chinese interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "zhTW" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "開發者"
L.OPT_DEVELOPER_INTRO = "Spoken 的開發者工具：除錯紀錄、除錯模式，以及 Spoken 各模組為測試加入的功能。"
L.OPT_LOG_SECTION = "除錯紀錄"
L.OPT_LOG_KEEP = "啟用除錯紀錄"
L.OPT_LOG_KEEP_TIP = "記下 Spoken 播放了什麼以及原因：每句台詞的排入、開始、停止或捨棄，附上時間、診斷資訊，以及 Spoken 各模組加入的內容。跨工作階段保存，最多 2000 行，可隨回報一併送出。關閉時不會記錄任何內容。"
L.OPT_LOG_SIZE = "大小"
L.OPT_LOG_SIZE_TIP = "它保留的 2000 行中已用了多少行，以及這些行在 Spoken_Developer.lua 中佔用的空間。"
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%d/%d 行，%s"
L.LOG_SIZE_OTHERS_FMT = "；其他玩家的紀錄：%d"
L.OPT_LOG_SHOW = "顯示紀錄"
L.OPT_LOG_SHOW_TIP = "在一個框中以同一條時間軸顯示本紀錄與其他 Spoken 插件收集的紀錄：按 Ctrl+A，再按 Ctrl+C 複製。"
L.OPT_LOG_COPY = "連同診斷複製"
L.OPT_LOG_COPY_TIP = "在一個框中顯示診斷資訊與完整紀錄：按 Ctrl+A，再按 Ctrl+C 複製。右鍵點擊「回報」按鈕效果相同。"
L.OPT_LOG_WRITE = "為 AI 代理寫入"
L.OPT_LOG_WRITE_TIP = "透過重新載入介面，立即把紀錄連同目前狀態（視窗、任務、佇列）存到磁碟：遊戲只在這時寫入插件的檔案。之後這台電腦上的 AI 代理就能讀取它：告訴它出了什麼問題。"
L.OPT_LOG_CLEAR = "清除紀錄"
L.OPT_LOG_CLEAR_TIP = "清空紀錄，讓之後的內容成為一次獨立的測試。"
L.OPT_LOG_COMMANDS = "/spoken log：顯示紀錄\n/spoken log copy：連同診斷複製\n/spoken log write：為 AI 代理寫入\n/spoken log on、/spoken log off：開啟或關閉\n/spoken log clear：清除\n寫入後或 /reload 之後，它存在：\nWTF\\Account\\<帳號>\\SavedVariables\\Spoken_Developer.lua"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "如何讓 AI 代理讀取紀錄？"
L.OPT_LOG_AGENT_STEPS = "1. 保持任務視窗開啟。\n2. 右鍵點擊它的「貢獻」或「回報問題」按鈕。\n3. 選擇「為 AI 代理寫入除錯紀錄」。介面會重新載入，從而儲存紀錄。\n4. 問這台電腦上的 AI 代理（例如 Claude Code），例如：\n    「我剛打開的任務沒有播放配音。請讀取 Spoken 除錯紀錄並告訴我原因。」\n\n或者，如果 AI 代理無法讀取這台電腦上的檔案（例如瀏覽器裡的聊天）：在第 3 步改選「複製除錯紀錄」（本頁上為「連同診斷複製」），按 Ctrl+C，然後連同你的問題一起貼到代理的視窗中。"
-- The welcome window's switch (Spoken's UI/Welcome.lua asks for these).
L.WELCOME_LOG_TIP = "Spoken 會記下它播放了什麼以及原因。出問題時，請隨回報一併送出紀錄；它只能顯示開啟期間發生的事。可在 Spoken > 開發者 中再次關閉。"
-- The box (UI/Box.lua, Copy.lua).
L.LOG_BOX_TITLE = "Spoken 除錯紀錄 - 按 Ctrl+A，再按 Ctrl+C 複製"
L.BOX_TITLE_COPY = "Spoken 除錯紀錄（含診斷）- 按 Ctrl+A，再按 Ctrl+C 複製"
-- A Report button's right-click (UI/Menu.lua).
L.MENU_COPY = "複製除錯紀錄"
L.MENU_WRITE = "為 AI 代理寫入除錯紀錄"
L.MENU_TURN_ON = L.OPT_LOG_KEEP
L.MENU_HINT = "右鍵點擊：複製除錯紀錄，或為 AI 代理寫入"
L.MENU_HINT_OFF = "右鍵點擊：啟用除錯紀錄，以便隨回報送出"
