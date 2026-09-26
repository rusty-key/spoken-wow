local _, SpokenBooks = ...

-- Korean interface strings for Spoken Books.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "koKR" then
	return
end
L.OPT_NOTE = "책, 편지, 쪽지를 Spoken 플레이어로 소리 내어 읽습니다. 내레이션에는 Spoken Books Audio 팩이 필요합니다."
L.OPT_SECTION_READING = "읽기"
L.OPT_AUTOPLAY = "책을 열면 읽기"
L.OPT_AUTOPLAY_TIP = "끄면 자동으로 시작되지 않으며, 재생을 누르거나 /spb read를 입력해야 책을 읽습니다."
L.OPT_WHOLE_BOOK = "보이는 페이지만이 아니라 책 전체 읽기"
L.OPT_WHOLE_BOOK_TIP = "첫 페이지를 열면 나머지가 대기열에 들어가 일지를 넘기면서 계속 읽습니다."
L.OPT_READ_ONCE = "각 책 한 번씩만 읽기"
L.OPT_READ_ONCE_TIP = "이 캐릭터가 이미 들은 책은 열어도 다시 읽지 않습니다. 재생은 계속 동작하며, 읽은 기록은 캐릭터별로 기억됩니다."
L.OPT_SECTION_READ = "이 캐릭터가 읽은 책"
L.OPT_FORGET = "읽은 기록 잊기"
L.OPT_FORGET_DONE_FMT = "%1$d권 잊음. 다시 읽습니다."
L.OPT_FORGET_TIP = "이 캐릭터의 기록을 지워 모든 책을 새로 만듭니다. “각 책 한 번씩만 읽기”가 켜져 있을 때만 의미 있습니다."
L.PLAY = "재생"
L.STOP = "정지"
L.PLAY_TIP = "이 책 소리 내어 읽기"
L.STOP_TIP = "이 책 읽기 정지"
L.CONTRIBUTE = "기여하기"
L.REPORT = "신고"
L.NO_LINE = "이 페이지의 대사 없음"
L.NO_LINE_TIP = "자신의 클라이언트 텍스트를 보내 추가하세요."
L.MENU_READ_BOOK = "이 책 읽기"
L.MENU_BOOK_SETTINGS = "Spoken Books 설정"
L.OPT_SECTION_LANGUAGE = "언어"
L.OPT_VOICE_LANGUAGE = "음성 언어"
L.OPT_VOICE_LANGUAGE_TIP = "어떤 언어의 사운드 팩이 읽어주는지. 자동은 게임 실행 언어를 사용합니다. 해당 언어로 녹음된 팩이 설치되어 있어야 들립니다."
L.OPT_LANG_AUTO_FMT = "자동 (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "대체 언어"
L.OPT_FALLBACK_LANGUAGE_TIP = "선택한 언어의 팩에 페이지가 없을 때 읽을 것. 없음은 요청하지 않은 언어로 읽는 대신 침묵합니다."
L.OPT_FALLBACK_NONE = "없음 (무음)"
L.OPT_NO_PACK_AUDIO = "설치된 사운드 팩에 아직 이 페이지의 내레이션이 없습니다."
L.OPT_NO_PACK_INSTALLED = "설치된 Spoken Books 사운드 팩이 없습니다."
L.OPT_PAGE_COUNT_FMT = "페이지 %1$d/%2$d"
