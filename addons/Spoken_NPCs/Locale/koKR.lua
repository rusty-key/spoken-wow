local _, NPCs = ...

-- Korean interface strings for Spoken NPCs.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = NPCs.L

if GetLocale() ~= "koKR" then
	return
end
L.COMPENDIUM_BOSSES = "우두머리"
L.BOSSES_SEARCH = "우두머리 검색"
L.BOSSES_NONE = "일치하는 항목이 없습니다."
L.BOSSES_FOUND_ONLY = "찾은 것만"
L.BOSSES_FOUND_FMT = "%2$d개 중 %1$d개 찾음"
L.BOSS_IN_FMT = "위치: %1$s"
L.BOSS_NOT_FOUND = "아직 만나지 못한 우두머리입니다. 던전이나 공격대에서 맞서면 여기서 그 이야기를 읽을 수 있습니다."
L.GROUP_LANDS = "기타 지역"
L.OPT_PAGE_TITLE = "우두머리"
L.OPT_RESET_PAGE_CONFIRM = "우두머리 설정을 모두 기본값으로 되돌릴까요?"
L.OPT_FORGET_STORIES = "표시한 이야기 잊기"
L.OPT_FORGET_STORIES_DONE_FMT = "이야기 %1$d개를 잊었습니다. 다시 표시합니다."
L.PART_ABOUT = "우두머리를 처치하면 내레이터에 그 이야기를 표시합니다."
