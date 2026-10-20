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
L.OPT_SHOW_ABILITIES = "우두머리 기술 표시"
L.OPT_RESET_PAGE_CONFIRM = "우두머리 설정을 모두 기본값으로 되돌릴까요?"
