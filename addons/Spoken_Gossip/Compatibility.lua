if not SpokenGossipEnv then return end
setfenv(1, SpokenGossipEnv)

-- What every client differs in is the dialogue core's (Spoken's Dialogue/Compat.lua). Left here:
-- the options window on 1.12, where AceConfig is embedded into the addon rather than a library
-- of its own.
if Version.IsLegacyVanilla then
    LibStub("AceConfig-3.0"):Embed(Addon)
end
