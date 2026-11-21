-- The Readables addon speaking through the player. Checksum.lua and Core.lua are loaded for
-- real against a hand-built SpokenReadables table; the queue, frame and callbacks are the real
-- Spoken ones. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local READABLES = here .. "/../../addons/Spoken_Readables/"
local Expect, Failures = H.Expecter(print)

local function LoadReadables()
    local SpokenReadables = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language" }) do
        local chunk = assert(loadfile(READABLES .. file .. ".lua"))
        chunk("Spoken_Readables", SpokenReadables)
    end
    return SpokenReadables
end

local function Boot()
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    _G.SpokenReadablesSettings = nil
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    local B = LoadReadables()
    B:InitDB()
    B:SetupSource()
    return env, B
end

---------------------------------------------------------------- wired up by the client
-- Boot() above calls InitDB and SetupSource by hand, which is how an addon that called
-- neither passed this whole file while being mute in game: no login event reached them, so
-- no source was ever claimed and every page lookup returned 0 against a nil source. This
-- section boots a copy the way the client does -- load the files, then fire the events --
-- and runs first, so it is the only Readables copy alive while it fires them.
--
-- Its own loader, because LoadBooks above is deliberately the two files this file's other
-- sections need: Events.lua is what creates the frame the events arrive at, and without it
-- firing them reaches nothing and the test passes for the wrong reason.
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
_G.SpokenReadablesSettings = nil
local bootEnv = stub.LoadSpoken(SPOKEN)
bootEnv.Addon:Enable()
local B0 = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist", "Events", "Commands" }) do
    assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B0)
end

stub.FireEvent("ADDON_LOADED", "SomebodyElse")
Expect("another addon's load leaves the saved variables alone", SpokenReadablesSettings, nil)

stub.FireEvent("ADDON_LOADED", "Spoken_Readables")
Expect("the addon's own ADDON_LOADED writes the defaults", SpokenReadablesSettings.autoplay, true)
Expect("...and claims no source yet, because the player may not have loaded", B0.source, nil)

stub.FireEvent("PLAYER_ENTERING_WORLD")
Expect("entering the world claims the source", _G.Spoken:GetSource("readables"), B0.source)
local claimed = B0.source
stub.FireEvent("PLAYER_ENTERING_WORLD")
Expect("...and a second loading screen does not replace it", B0.source, claimed)

-- The test line plays a page ClipFor can place, whichever key the pack lists first.
_G.SpokenReadablesData = { version = 1, index = {}, loose = {}, books = { [1] = { title = "T", pages = { 15 } } },
    pages = { [15] = { book = 1, number = 1, text = "x" } } }
-- Packs are tried in addon-name order: the unplaceable key is alone in the first.
_G.SpokenReadablesAudioPacks = {
    SpokenReadablesAudio_a = { version = 1, addon = "SpokenReadablesAudio_a", pages = {
        ["n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"] = { file = "n", len = 1 } } },
    SpokenReadablesAudio_b = { version = 1, addon = "SpokenReadablesAudio_b", pages = { [15] = { file = "15", len = 1 } } } }
B0:PlayTestLine()
local queued = _G.Spoken:GetQueue()
Expect("the test line skips a page nothing places and queues one that is placed",
    queued[1] and queued[1].key, "b:15")
_G.SpokenReadablesData, _G.SpokenReadablesAudioPacks = nil, nil

-- Packs released as SpokenBooksAudio write SpokenBooksAudioPacks, and are read too, unless their
-- SpokenReadablesAudio replacement is installed beside them.
_G.SpokenBooksAudioPacks = { SpokenBooksAudio = { version = 1, pages = {} }, SpokenBooksAudio_deDE = { version = 1, pages = {} } }
_G.SpokenReadablesAudioPacks = { SpokenReadablesAudio = { version = 1, pages = {} } }
local listed = {}
for _, pack in ipairs(B0:GetAudioPacks()) do table.insert(listed, pack.addon) end
Expect("a pack released as SpokenBooksAudio is found, unless replaced", table.concat(listed, " "),
    "SpokenBooksAudio_deDE SpokenReadablesAudio")
_G.SpokenBooksAudioPacks, _G.SpokenReadablesAudioPacks = nil, nil

local env, B = Boot()
local Spoken = _G.Spoken

---------------------------------------------------------------- registration
Expect("the Readables addon registers a source with the player", Spoken:GetSource("readables"), B.source)
Expect("...headed in the minimap menu by its page's name, in the player's language", B.source.title, B.L.OPT_PAGE_TITLE)
-- No cap: a book is a bounded sequence somebody opened, not a burst of discoveries. Capped,
-- the player trims the oldest waiting clip and a four-page book loses its middle.
Expect("...with no queue limit", B.source.queueLimit, nil)
Expect("...with its own gap", B.source.interClipGap, 0.35)
Expect("...and reports itself compatible", B.compatible, true)

---------------------------------------------------------------- saved variables
Expect("autoplay is on by default, because opening a book is already deliberate",
    SpokenReadablesSettings.autoplay, true)
Expect("a whole book is read by default", SpokenReadablesSettings.readWholeBook, true)

SpokenReadablesSettings.autoplay = false
B:InitDB()
Expect("InitDB does not overwrite a choice already made", SpokenReadablesSettings.autoplay, false)

---------------------------------------------------------------- the checksum
-- The numbers below come from pipelines/readables/tools/lib/naming.mjs, which keys the
-- generated lookup on them. If these two disagree, every page lookup misses and the addon
-- narrates nothing at all -- silently, which is why they are asserted rather than trusted.
Expect("the checksum matches the exporter on ASCII", B:ChecksumOf("The rains have come."), 1482999072)
Expect("the checksum matches the exporter on UTF-8", B:ChecksumOf("Voil\195\160, l'\195\169p\195\169e."), 1603451486)
Expect("the checksum normalises CRLF the way the exporter does",
    B:ChecksumOf("One.\r\n\r\nTwo."), B:ChecksumOf("One.\n\nTwo."))
Expect("...and WoW's $B newline token", B:ChecksumOf("One.$B$BTwo."), B:ChecksumOf("One.\n\nTwo."))
Expect("...and trailing whitespace", B:ChecksumOf("One.   \nTwo."), B:ChecksumOf("One.\nTwo."))
Expect("a non-string is not an error", B:ChecksumOf(nil), 0)

local SIGNED = '<HTML><BODY><H1>Ledger</H1><BR/><P align="right">Three &amp; four</P></BR></BODY></HTML>'
Expect("a signed page is hashed as the lines the exporter stores", B:ChecksumOf(SIGNED), 700299336)
Expect("...the same as those lines", B:ChecksumOf("Ledger\n\nThree & four"), 700299336)
Expect("...and over its HTML for packs built before", B:MarkedChecksumOf(SIGNED), 2122167809)
Expect("a page with no markup has no second checksum", B:MarkedChecksumOf("The rains have come."), nil)
Expect("an aside is not markup", B:ChecksumOf("<illegible text> runes"), 885014114)

---------------------------------------------------------------- the generated data
dofile(READABLES .. "Data/Books.lua")
local data = B:Data()
Expect("the lookup loaded", type(data), "table")
Expect("...at the version this addon reads", data.version, 1)
local twilight = data.index["Decoded Twilight Text"]
local variants = 0
for _ in pairs(twilight[1]) do variants = variants + 1 end
Expect("seven books share a title and are told apart by checksum", variants, 7)

---------------------------------------------------------------- a player that is too old
local oldSpoken = _G.Spoken
_G.Spoken = { IsCompatible = function() return false end }
local B2 = LoadReadables()
Expect("an incompatible player leaves the addon loaded but quiet", B2:SetupSource(), nil)
Expect("...and says so", B2.compatible, false)
_G.Spoken = oldSpoken

print(Failures() == 0 and "All readables source tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
