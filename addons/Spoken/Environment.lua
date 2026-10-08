--[[
Two globals, and only two.

    Spoken     the public API. What a feature addon calls. Frozen by API_VERSION.
    SpokenEnv  the private environment every implementation file runs in.

SpokenEnv is a table whose metatable falls back to _G, so inside it every bare global
resolves against the game as usual, while anything an implementation file assigns to a
bare name lands here and nowhere else. That is what keeps SoundQueue, Sources and the
rest out of the game-wide namespace, and it is what lets Compat.lua override `select`,
`print` and a dozen frame APIs for the 1.12 client by writing into this table: every
file loaded after it sees the override, and the real _G is untouched.

Every implementation file starts with `setfenv(1, SpokenEnv)`, and this file must load
before all of them. This is VoiceOverRedux's Environment.lua with the API split out of
the environment, so that what a caller can reach is a deliberate surface rather than
the player's entire internals.
]]

local _G = getfenv(0)

SpokenEnv = setmetatable({
    _G = _G,
    AddonFolder = "Spoken",
    -- A literal because this file loads before any metadata API exists;
    -- scripts/quests/package.sh refuses to build when it disagrees with the .toc.
    AddonVersion = "3.2.0-alpha.1",
}, { __index = _G })

-- Created here, filled by API.lua. Reusing an existing table keeps a feature addon's
-- early reference valid if the player is ever reloaded in place.
Spoken = rawget(_G, "Spoken") or {}
SpokenEnv.Spoken = Spoken
