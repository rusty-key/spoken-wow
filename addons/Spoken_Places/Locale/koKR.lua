-- koKR. Korean interface strings for Spoken Places.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, SpokenZones = ...

if GetLocale() ~= "koKR" then
	return
end

local L = {}

L.OPT_SECTION_MAP = "이야기"
L.OPT_MAP_PANEL = "지도 옆에 이야기 표시"
L.OPT_PICTURES = "그림 표시"
L.OPT_MAP_HIGHLIGHT = "지역 강조"
L.OPT_PANEL_WIDTH = "이야기 너비"
L.OPT_PLAY_BUTTON = "이야기 소리 내어 읽기"
L.OPT_AUTOPLAY = "자동으로 읽기"
L.OPT_AUTOPLAY_SUB = "세부 지역 포함"
L.OPT_AUTOPLAY_EXPLORED = "이전에 발견한 장소 포함"
L.OPT_AUTOPLAY_EXPLORED_TIP = "캐릭터마다 장소를 한 번씩 읽습니다. 이전에 발견한 장소도 포함됩니다."
L.OPT_LANG_RELOAD = "전환하려면 /reload를 입력하세요."
L.OPT_LANGUAGE = "텍스트 언어"
L.OPT_LANGUAGE_TIP = "이야기의 글 언어입니다. 음성은 음성 언어를 따릅니다."
L.OPT_LANG_AUTO_FMT = "자동 (%1$s)"
L.OPT_LANG_SET_FMT = "UI를 다시 불러오면 이야기가 %1$s(으)로 표시됩니다."
L.OPT_LANG_PROFILE_FMT = "이 프로필은 이야기를 %1$s(으)로 읽습니다. 전환하려면 /reload를 입력하세요."
L.OPT_REPORT_PROBLEM = "문제 신고"
L.MENU_LORE_WINDOW = "아제로스 백과사전 열기"
L.MENU_ZONE_SETTINGS = "장소 설정"

L.OPT_REPORT_LINE_TIP = "잘못된 이야기, 잘못 읽은 부분이나 잘못 발음된 이름을 신고할 링크를 받습니다."
L.OPT_REPORT_LINE_ADDRESS = "이 주소를 복사하여 브라우저에서 열어 이 항목의 문제를 신고하세요."

L.AUDIO_READ_TIP = "이 이야기를 소리로 듣기"
L.REPORT_BUTTON = "신고"
L.IN_ZONE_FMT = "위치: %1$s"
L.DISCOVERED_FMT = "%2$d곳 중 %1$d곳 발견"

L.QUEUE_HELD_COMBAT = "전투 종료 대기 중."
L.QUEUE_HELD_CINEMATIC = "시네마틱 종료 대기 중."
L.QUEUE_HELD_OFF = "내레이션이 꺼져 있습니다."
L.NOT_DISCOVERED = "아직 발견하지 못한 곳입니다. 그곳에 가 보면 이야기를 읽을 수 있습니다."
L.MAP_LORE_FOR_FMT = "%1$s의 이야기"
L.CMD_HEADING = "명령어(/spokenplaces 또는 /spp):"
L.CMD_STATUS = "  /spp            -- 현재 지역과 세부 지역 상태"
L.CMD_DIAGNOSTICS = "  /spp diagnostics -- 진단 정보 보기"
L.CMD_OPTIONS = "  /spp settings   -- 설정의 장소 페이지"
L.CMD_WINDOW = "  /spp window     -- 아제로스 백과사전 열기"
L.CMD_PANEL = "  /spp panel      -- '지도 옆에 이야기 표시' 켜기/끄기"
L.CMD_PLAY = "  /spp play       -- 지금 있는 곳의 이야기 읽기"
L.CMD_STOP = "  /spp stop       -- 읽기 정지"
L.CMD_VOICE = "  /spp voice      -- '이야기 소리 내어 읽기' 켜기/끄기"
L.CMD_AUTOPLAY = "  /spp autoplay   -- '자동으로 읽기' 켜기/끄기"
L.CMD_AUDIO = "  /spp audio      -- 설치된 음성 팩"
L.CMD_LANG = "  /spp lang       -- 텍스트 언어: 목록, 또는 /spp lang <code> 또는 auto로 전환"
L.CMD_FORGET = "  /spp forget     -- 들은 장소 잊기"


-- Added in this release: settings pages, subtitles, voice packs, profiles and module switches.
L.REASON_VOICE = "이 기능을 쓰려면 '이야기 소리 내어 읽기'를 켜세요."
L.OPT_FORGET_PLACES = "들은 장소 잊기"
L.OPT_FORGET_PLACES_DONE = "이 캐릭터의 들은 장소 목록을 지웠습니다."
L.OPT_DOWNLOAD_ADDRESS = "이 주소를 웹 브라우저에 복사해 넣어 음성 팩을 다운로드하세요."
L.OPEN_IN_LORE_TIP = "아제로스 백과사전에서 다른 모든 지역과 세부 지역의 이야기와 함께 이곳의 이야기를 봅니다."
L.OTHER_LANDS = "기타 지역"
L.BATTLEGROUNDS = "전장"
L.DUNGEONS = "던전 및 공격대"
L.COMPENDIUM_PLACES = "장소"
L.LORE_PANEL_TITLE = "장소 이야기"
L.MAP_PANEL_EXPAND = "장소 이야기 표시"
L.PANEL_SHOWN = "지도 옆에 이야기 표시: 켜짐"
L.PANEL_HIDDEN = "지도 옆에 이야기 표시: 꺼짐"
L.LORE_SEARCH = "장소 검색"
L.LORE_DISCOVERED_ONLY = "발견한 것만"
L.LORE_VOICED_ONLY = "음성이 있는 것만"
L.LORE_SEARCH_NONE = "일치하는 항목이 없습니다."
L.REASON_DISCOVERY = "이 기능을 쓰려면 '자동으로 읽기'를 켜세요."
L.REASON_MAP_PANEL = "이 기능을 쓰려면 '지도 옆에 이야기 표시'를 켜세요."
L.OPT_RESET_PAGE_CONFIRM = "장소 설정을 모두 기본값으로 되돌릴까요?"
L.OPT_RELOAD_NOW = "지금 다시 불러오기"
L.OPT_LATER = "나중에"
L.OPT_PAGE_TITLE = "장소"
L.OPT_DEV_DEBUG = "장소 디버그 메시지"
L.OPT_DEV_PREVIEW = "미완성 번역 제공"

L.OPEN_IN_COMPENDIUM = "아제로스 백과사전에서 열기"

SpokenZones:RegisterStrings("koKR", L)
