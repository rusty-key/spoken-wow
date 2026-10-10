-- The gossip module's own gossip text (Gossip/<locale>.lua) and aliases (Gossip/Aliases.lua):
-- generated files, loaded into Spoken's dialogue core, where DataModules asks them before any
-- pack's tables. These load the real files through Gossip.xml, as the classic clients do.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local GOSSIP = here .. "/../../addons/Spoken_Gossip/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

-- A Stormwind guard's line in Gossip/deDE.lua, and the English line's file it points at.
local GUARD = "Creature-0-0-0-0-68-0"
local DE_TEXT = "An welchem Schlachtfeld seid Ihr interessiert?"
local HASH = "481f209702cc74fc87fe4569d25b276b"
-- One moment recorded under two names, from Gossip/Aliases.lua.
local LINE, ALIAS = "0cc088f013cb6fc40acf3a7acfed831d", "e841ba6ae28aa6b32a74b9d08e9fed88"

local function LoadGossipText()
    local xml = io.open(GOSSIP .. "Gossip/Gossip.xml")
    if not xml then
        return false
    end
    for file in string.gmatch(xml:read("*a"), '<Script file="([^"]+)"/>') do
        dofile(GOSSIP .. "Gossip/" .. file)
    end
    xml:close()
    return true
end

local function Boot(locale)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.SetLocale(locale)
    _G.SpokenGossipSettings = nil
    local G = stub.LoadGossip(GOSSIP, SPOKEN)
    G.Addon:OnInitialize()
    local loaded = LoadGossipText()
    -- The stub's English pack, with the files and no gossip tables: only the module's text finds them.
    G.DataModules:Register("TestPack", {
        SoundLengthLookupByFileName = { [HASH] = 1, [ALIAS] = 1 },
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
    })
    stub.Advance(2)
    return G, loaded
end

local G, loaded = Boot("deDE")
Expect("the module ships its gossip text", loaded, true)
Expect("deDE: the German text loads into the dialogue core", rawget(G.Core, "GossipText") ~= nil, true)
local sound = { event = G.Enums.SoundEvent.Gossip, unitGUID = GUARD, name = "Stormwind City Guard", text = DE_TEXT }
Expect("deDE: a German page finds its line with English packs", G.DataModules:PrepareSound(sound) and sound.fileName, HASH)
Expect("deDE: ...and the guard counts as having gossip", G.DataModules:HasGossipFor({ unitGUID = GUARD }), true)

local aliased = { event = G.Enums.SoundEvent.Gossip, fileName = LINE }
Expect("deDE: a line no pack holds plays under its alias", G.DataModules:ResolveSoundFile(aliased) and aliased.fileName, ALIAS)

G = Boot("enUS")
Expect("enUS: no locale's text is built on an English client", rawget(G.Core, "GossipText"), nil)
Expect("enUS: the aliases still load", rawget(G.Core, "GossipAliases") ~= nil, true)

-- Without Spoken's dialogue core the module loads nothing, its text included.
_G.SpokenGossipEnv = nil
stub.SetLocale("deDE")
Expect("without the core, the German text returns without an error", (pcall(dofile, GOSSIP .. "Gossip/deDE.lua")), true)
Expect("without the core, the aliases return without an error", (pcall(dofile, GOSSIP .. "Gossip/Aliases.lua")), true)

stub.SetLocale("enUS")
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll gossip text tests passed")
