if not SpokenGossipEnv then return end
setfenv(1, SpokenGossipEnv)

-- Recordings the player ships itself, to be heard instead of the pack's take on the same line
-- when their option is on. Keyed on file name, which is what DataModules resolves a line to
-- before it goes looking through the packs, so a swap needs no pack of its own - and works for
-- somebody whose installed packs do not even hold the line.
EasterEggs =
{
    -- The folder, not a name: it builds the path the recording is played from.
    ADDON_NAME = AddonFolder,

    ---@type table<string, { path: string, length: number, option: string }>
    alternates =
    {
        -- Thrall's "All members of the Horde are equal in my eyes". AI VoiceOver's reading of
        -- it outlived the addon that shipped it; the mp3 is upstream's file, byte for byte,
        -- and the length is upstream's own sound_length_table entry for it.
        ["9fdeb82237b72e8801030487901e690f"] =
        {
            path = [[Sounds\og-thrall.mp3]],
            length = 33.802375,
            option = "OGThrall",
        },
    },
}

--- Swap in the easter egg recording for a line, if there is one and its option is on.
---@param soundData SoundData Resolved by `DataModules:PrepareSound`, mutated in place
---@return boolean applied Whether an easter egg replaced what the packs resolved
function EasterEggs:Apply(soundData)
    local alternate = self.alternates[soundData.fileName]
    if not alternate or not Addon.db.profile.Audio[alternate.option] then
        return false
    end

    soundData.filePath = format([[Interface\AddOns\%s\%s]], self.ADDON_NAME, alternate.path)
    soundData.length = alternate.length
    -- SoundQueue logs the addon a sound came from, so there is always a module to name even
    -- when no pack held the line.
    soundData.module = soundData.module or
        { METADATA = { AddonName = self.ADDON_NAME, Title = self.ADDON_NAME } }
    return true
end

-- Into the core by name: its DataModules swaps a recording in as it resolves a line, and reads
-- only its own table (DataModules.lua).
Core.EasterEggs = EasterEggs
