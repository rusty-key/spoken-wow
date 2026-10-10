--[[
This addon's environment: a table of its own that reads through to the dialogue core Spoken
creates (Dialogue/Environment.lua, the VoiceOver table), where the voice packs, languages and
sound events it reads lines with are. Its own names -- Addon, Player, Options, L -- stay in this
table, so they never meet the quests module's of the same names in the core.

What the core itself has to find goes into the core by name (EasterEggs.lua).

Without the core (Spoken missing, switched off, or too old to have one) the addon loads nothing
but PlayerRequired.lua: every other file starts with

    if not SpokenGossipEnv then return end

before its setfenv(1, SpokenGossipEnv).
]]
local _G = getfenv(0)
local core = rawget(_G, "VoiceOver")
if not (core and rawget(core, "SpokenDialogue")) then
    return
end

SpokenGossipEnv = setmetatable({
    Core = core,
    AddonFolder = "Spoken_Gossip",
    -- What /spg diagnostics prints. A literal because this file loads before the addon has any
    -- metadata API; scripts/package.sh refuses to build when it disagrees with the .toc.
    AddonVersion = "3.3.0",
}, { __index = core })
