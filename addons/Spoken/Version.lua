setfenv(1, SpokenEnv)
Version = {}

local CLIENT_VERSION, _, _, INTERFACE_VERSION = GetBuildInfo()

Version.Client                  = CLIENT_VERSION
Version.Interface               = INTERFACE_VERSION

-- Which client and realm this is, as one of:
--   "forever"      the WoW Forever beta: vanilla content on the modern engine
--   "era"          Classic Era, Hardcore included
--   "sod"          Season of Discovery: the Era client, with the season's own maps and quests
--   "anniversary"  TBC Anniversary
-- Told apart by the interface number, never by WOW_PROJECT_ID: Forever build 69913 answered
-- WOW_PROJECT_MAINLINE, 70170 answers a project of its own (18), and Forever can report the
-- Classic project too. Era stays at 115xx and Anniversary at 205xx, so any 1.6x and later 1.x
-- release of Forever lands in its band. SoD shares Era's client, so only the season names it.
local function Resolve(interface)
    if interface >= 16000 and interface < 20000 then
        return "forever"
    elseif interface >= 20000 then
        return "anniversary"
    end
    local season = C_Seasons and C_Seasons.GetActiveSeason and C_Seasons.GetActiveSeason()
    if season and Enum and Enum.SeasonID and season == Enum.SeasonID.SeasonOfDiscovery then
        return "sod"
    end
    return "era"
end

Version.Variant                 = Resolve(INTERFACE_VERSION)
