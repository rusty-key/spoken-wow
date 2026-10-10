--[[
The dialogue core: what the quest and gossip modules both read lines with (the voice packs, the
languages they speak, the sound events). It lives in Spoken so that either module works without
the other, and both share this one environment.

Use the addon's private table as an isolated environment.
By using { __index = _G } metatable we're allowing all global lookups to transparently fallback to the game-wide
globals table, while the private table itself will act as a thin layer on top of the game-wide globals table,
allowing us to have our own global variables isolated from the rest of the game.

This accomplishes several goals:
1. Prevents addon-specific "globals" from leaking to game-wide global namespace _G
2. Optionally retains the ability to access these "globals" via the only exposed global variable "VoiceOver"
3. Allows us to make overrides for WoW API's global functions and variables without actually touching
   the real global namespace, making these overrides visible only to this addon.
   This will be useful mainly for adding backwards-compatibility with older WoW clients.

setfenv(1, VoiceOver) must be added to every .lua file to allow it to work within this environment,
and this Environment file must be loaded before all others
]]

-- THE GLOBAL STAYS VoiceOver, whatever the addon is called. It is not a leftover: every sound
-- pack calls into the player through it, and those calls are Lua baked into files already on
-- players' disks -- `if not VoiceOver or not VoiceOver.DataModules then return end` and
-- `VoiceOver.DataModules:Register(...)`, from tts_cli/build.py. A rebuilt pack could follow a
-- rename; a pack built for upstream AI VoiceOver could not, and DataModules deliberately keeps
-- reading those. Renaming this would make every pack this project did not build inert forever.
--
-- The DataModule TOC key is being renamed, and is not a counter-example: a key is data, so
-- both spellings can be looked for. A call target is not -- the pack names the symbol.
local _G = getfenv(0)
local previousEnvironment = rawget(_G, "VoiceOver")

VoiceOver = setmetatable({
    _G = _G,
    -- What a module checks before loading on top of this: an older Spoken has no dialogue core,
    -- and upstream AI VoiceOver's table has the same global name.
    SpokenDialogue = true,
    PreviousEnvironment = previousEnvironment,
}, { __index = _G })
