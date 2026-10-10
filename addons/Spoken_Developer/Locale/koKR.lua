local _, Developer = ...

-- Korean interface strings for Spoken Developer.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

if GetLocale() ~= "koKR" then return end

local L = Developer.L

-- The Developer page (UI/Options.lua).
L.OPT_DEVELOPER = "개발자"
L.OPT_DEVELOPER_INTRO = "Spoken 개발자 도구: 디버그 기록, 디버그 모드, 그리고 Spoken 모듈이 테스트용으로 더하는 기능."
L.OPT_LOG_SECTION = "디버그 기록"
L.OPT_LOG_KEEP = "디버그 기록 저장 켜기"
L.OPT_LOG_KEEP_TIP = "Spoken이 무엇을 왜 재생하는지 기록합니다. 대기열에 들어가거나 시작, 정지, 제외된 각 대사와 그 시각, 진단, 그리고 Spoken 모듈이 더하는 내용입니다. 신고에 첨부할 수 있도록 세션이 바뀌어도 최대 2000줄까지 보관합니다. 꺼져 있는 동안에는 아무것도 저장하지 않습니다."
L.OPT_LOG_SIZE = "크기"
L.OPT_LOG_SIZE_TIP = "보관하는 2000줄 중 몇 줄을 쓰고 있는지, 그리고 Spoken_Developer.lua에서 차지하는 공간입니다."
-- "1234 of 2000 lines, 96 KB", then "; other players' logs: 2" where there are any.
L.LOG_SIZE_FMT = "%d/%d줄, %s"
L.LOG_SIZE_OTHERS_FMT = "; 다른 플레이어의 기록: %d"
L.OPT_LOG_SHOW = "기록 보기"
L.OPT_LOG_SHOW_TIP = "이 기록과 다른 Spoken 애드온이 모은 기록을 하나의 시간순으로 상자에 보여 줍니다. Ctrl+A, 이어서 Ctrl+C로 복사하세요."
L.OPT_LOG_COPY = "진단과 함께 복사"
L.OPT_LOG_COPY_TIP = "진단과 전체 기록을 상자에 보여 줍니다. Ctrl+A, 이어서 Ctrl+C로 복사하세요. 신고 버튼을 오른쪽 클릭해도 같습니다."
L.OPT_LOG_WRITE = "AI 에이전트용으로 저장"
L.OPT_LOG_WRITE_TIP = "인터페이스를 다시 불러와 지금의 상태(창, 퀘스트, 대기열)와 함께 기록을 디스크에 저장합니다. 게임은 그때만 애드온의 파일을 씁니다. 그러면 이 컴퓨터의 AI 에이전트가 읽을 수 있으니, 무엇이 잘못되었는지 알려 주세요."
L.OPT_LOG_CLEAR = "기록 지우기"
L.OPT_LOG_CLEAR_TIP = "기록을 비워, 이후 내용을 별도의 테스트 세션으로 읽을 수 있게 합니다."
L.OPT_LOG_COMMANDS = "/spoken log: 기록 보기\n/spoken log copy: 진단과 함께 복사\n/spoken log write: AI 에이전트용으로 저장\n/spoken log on, /spoken log off: 켜기 또는 끄기\n/spoken log clear: 비우기\n저장하거나 /reload 하면 다음 파일에 있습니다:\nWTF\\Account\\<계정>\\SavedVariables\\Spoken_Developer.lua"
-- Under the commands: how to ask an AI agent, a question and the steps to take.
L.OPT_LOG_AGENT_TITLE = "AI 에이전트로 기록을 읽게 하려면?"
L.OPT_LOG_AGENT_STEPS = "1. 퀘스트를 연 채로 둡니다.\n2. 퀘스트의 \"기여하기\" 또는 \"문제 신고\" 버튼을 오른쪽 클릭합니다.\n3. \"AI 에이전트용으로 디버그 기록 저장\"을 고릅니다. 인터페이스가 다시 불러와지면서 기록이 저장됩니다.\n4. 이 컴퓨터의 AI 에이전트(예: Claude Code)에게 이렇게 물어봅니다:\n    \"방금 연 퀘스트의 음성이 재생되지 않았어. Spoken 디버그 기록을 읽고 이유를 알려 줘.\"\n\n또는 이 컴퓨터의 파일을 읽을 수 없는 AI 에이전트(브라우저의 채팅)라면: 3단계에서 \"디버그 기록 복사\"(이 페이지에서는 \"진단과 함께 복사\")를 고르고 Ctrl+C를 누른 뒤, 질문과 함께 에이전트 창에 붙여 넣으세요."
-- The welcome window's switch (Spoken's UI/Welcome.lua asks for these).
L.WELCOME_LOG_TIP = "Spoken이 무엇을 왜 재생하는지 기록합니다. 문제가 생기면 신고와 함께 이 기록을 보내 주세요. 켜져 있던 동안의 일만 보여 줍니다. Spoken > 개발자에서 다시 끌 수 있습니다."
-- The box (UI/Box.lua, Copy.lua).
L.LOG_BOX_TITLE = "Spoken 디버그 기록 - Ctrl+A, 이어서 Ctrl+C로 복사"
L.BOX_TITLE_COPY = "진단이 포함된 Spoken 디버그 기록 - Ctrl+A, 이어서 Ctrl+C로 복사"
-- A Report button's right-click (UI/Menu.lua).
L.MENU_COPY = "디버그 기록 복사"
L.MENU_WRITE = "AI 에이전트용으로 디버그 기록 저장"
L.MENU_TURN_ON = L.OPT_LOG_KEEP
L.MENU_HINT = "오른쪽 클릭: 디버그 기록 복사 또는 AI 에이전트용으로 저장"
L.MENU_HINT_OFF = "오른쪽 클릭: 신고용 디버그 기록 저장 켜기"
