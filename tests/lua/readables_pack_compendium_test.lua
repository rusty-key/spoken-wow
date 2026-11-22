-- A translated, minted book carried by an audio pack is still listed in the Compendium before
-- the English corpus export knows it. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local READABLES = here .. "/../../addons/Spoken_Readables/"
local SPOKEN = here .. "/../../addons/Spoken/"
local BOOK = "nfc676562-fb40-4845-8cbe-6ddd8269c620"

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
_G.C_Map.GetMapInfo = function(id)
    return { mapType = 3, name = id == 1426 and "Dun Morogh" or "Azeroth" }
end
_G.C_Texture = { GetAtlasInfo = stub.ListAtlas }
_G.UISpecialFrames = _G.UISpecialFrames or {}
_G.SpokenReadablesAudioPacks = {
    SpokenReadablesAudio = {
        version = 1, addon = "SpokenReadablesAudio", language = "enUS",
        pages = {
            ["n1c5a37a2-0a38-46b8-b5fa-e848b2d9fd20"] = { file = "gretchen-1", len = 2,
                text = "Mountaineer Gretchen's report." },
        },
        books = {
            [BOOK] = { title = "Mountaineer Gretchen's Report",
                pages = { "n1c5a37a2-0a38-46b8-b5fa-e848b2d9fd20" } },
        },
        bookPlaces = {
            [BOOK] = { kind = "carried", type = "journal", quests = { 98323 }, zones = { 1426 } },
        },
        items = { [280430] = BOOK },
    },
}

local createFrame = _G.CreateFrame
_G.CreateFrame = function(kind, name, parent, template)
    local frame = createFrame(kind, name, parent, template)
    if template == "PortraitFrameTemplate" then
        function frame:SetTitle(text) self.title = text end
        function frame:SetPortraitToAsset(path) self.portrait = path end
    end
    frame.template = template
    return frame
end

local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
    "UI/Readables", "Events", "Commands" }) do
    assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B)
end
B:InitDB()
SpokenReadablesSettings.compendiumFoundOnly = false
SpokenReadablesSettings.unlockUnfound = true
B:SetupSource()
dofile(READABLES .. "Data/Books.lua")
dofile(READABLES .. "Data/Places.lua")
B:SetupReadables()
B:ShowReadables(BOOK)

Expect("the locale-pack item resolves to its minted readable", B:BookForItem(280430), BOOK)
Expect("the locale-pack readable is available in the Compendium", B:CompendiumHas(BOOK), true)
Expect("the locale-pack readable is placed in Dun Morogh",
    B.readables.page.sub.text.text:find("Dun Morogh", 1, true) ~= nil, true)
Expect("the locale-pack readable resolves back to its item", B:ItemForBook(BOOK), 280430)
Expect("a pack-only English readable keeps its title", B:BookById(BOOK).title, "Mountaineer Gretchen's Report")
local getTextLanguage = B.GetTextLanguage
B.GetTextLanguage = function() return "esMX", true end
B:ShowReadables(BOOK)
Expect("a missing translation falls back to the English pack", B.readables.page.body.text.text,
    "Mountaineer Gretchen's report.")
B.GetTextLanguage = getTextLanguage

assert(Failures() == 0, "readables pack checks failed")
