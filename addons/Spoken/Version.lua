setfenv(1, SpokenEnv)
Version = {}

local CLIENT_VERSION, _, _, INTERFACE_VERSION = GetBuildInfo()

Version.Client                  = CLIENT_VERSION
Version.Interface               = INTERFACE_VERSION
Version.IsRetailVanilla         = WOW_PROJECT_ID == WOW_PROJECT_CLASSIC or nil
Version.IsRetailMainline        = WOW_PROJECT_ID == WOW_PROJECT_MAINLINE or nil
-- The "WoW Forever" beta client: vanilla content on the modern engine. Told apart by its
-- interface number alone (16001 for 1.60.1), never by WOW_PROJECT_ID: build 69913 answered
-- WOW_PROJECT_MAINLINE and 70170 answers a project of its own (18), and the next build may
-- answer something else again. Era stays at 115xx and Anniversary at 205xx, so any 1.6x and
-- later 1.x release of Forever lands in the band.
Version.IsCamelot               = Version.Interface >= 16000 and Version.Interface < 20000 or nil

