-- Close Book When Done Reading: the book shuts once its last page has been heard, which is also what
-- gives back the interface DialogueUI's book view hides. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local BOOKS = here .. "/../../addons/Spoken_Books/"
local Expect, Failures = H.Expecter(print)

_G.SpokenBooksAudioPacks = {
    SpokenBooksAudio = {
        version = 1, addon = "SpokenBooksAudio", quality = "high", bitrate = 128,
        pages = {
            [15] = { file = "15", len = 2 },
            [261] = { file = "261", len = 2 },
            [262] = { file = "262", len = 2 },
            [265] = { file = "265", len = 2 },
        },
    },
}

local LETTER = "Hello Morgan,\n\nBusiness in Goldshire is brisk."
local REGISTRY_1 = "Hillsbrad Town Registry\n\nWe the people of Hillsbrad do solemny swear our faith and devotion to the Alliance maintained by the great monarchs, King Magni Bronzebeard of Ironforge and King Anduin Wrynn of Stormwind.\n\nHerein lies the town registry for purposes of governing this fair city in the foothills of the great Alterac Mountains as well as serving as a record of those who have paid their taxes to their Kings and to the great almighty Alliance."

local function LoadBooks()
    local SpokenBooks = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
        "Events", "Commands" }) do
        local chunk = assert(loadfile(BOOKS .. file .. ".lua"))
        chunk("Spoken_Books", SpokenBooks)
    end
    return SpokenBooks
end

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
_G.SpokenBooksSettings = nil
local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
local B = LoadBooks()
B:InitDB()
B:SetupSource()
dofile(BOOKS .. "Data/Books.lua")
SpokenBooksData.index["William's Shipment"][1][B:ChecksumOf(LETTER)] = 15

-- The client's CloseItemText: the window goes and ITEM_TEXT_CLOSED follows.
local closed = 0
_G.CloseItemText = function()
    closed = closed + 1
    stub.ClosePage()
    stub.FireEvent("ITEM_TEXT_CLOSED")
end

local function OpenLetter()
    stub.ShowPage({ title = "William's Shipment", number = 1, text = LETTER })
    stub.FireEvent("ITEM_TEXT_READY")
end

local function OpenRegistry()
    stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
    stub.FireEvent("ITEM_TEXT_READY")
end

local function Queued()
    local count = 0
    for _, clip in ipairs(Spoken:GetQueue()) do
        if clip.pageId then count = count + 1 end
    end
    return count
end

local function Reset()
    B:StopReading()
    stub.Advance(1)
    if B.lastPage then stub.ClosePage(); stub.FireEvent("ITEM_TEXT_CLOSED") end
    closed = 0
end

---------------------------------------------------------------- off, as it ships
Expect("off by default", SpokenBooksSettings.closeWhenRead, false)
OpenLetter()
Expect("a letter is read", Queued(), 1)
stub.Advance(4)
Expect("...and with the setting off it stays open once heard", closed, 0)
Expect("...still on screen", B.lastPage, 15)
Reset()

---------------------------------------------------------------- on
SpokenBooksSettings.closeWhenRead = true
OpenLetter()
stub.Advance(4)
Expect("a one-page letter closes once it has been heard", closed, 1)
Expect("...and is no longer on screen", B.lastPage, nil)
Reset()

OpenLetter()
B:StopReading()
stub.Advance(4)
Expect("stopped by hand, it stays open", closed, 0)
Reset()

OpenLetter()
stub.ClosePage(); stub.FireEvent("ITEM_TEXT_CLOSED")
stub.Advance(4)
Expect("shut before the end, nothing is closed after it", closed, 0)
Reset()

-- Another book open by the time the letter ends: that one is not the letter's to close.
OpenLetter()
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
B.lastPage = B:PageOnScreen()
stub.Advance(4)
Expect("another book open when it ends is left open", closed, 0)
Reset()

---------------------------------------------------------------- a book of several pages
OpenRegistry()
Expect("the registry queues its pages", Queued(), 3)
stub.Advance(2.2)
Expect("its first page heard, the book stays open", closed, 0)
stub.Advance(6)
Expect("its last page heard, it closes, though the reader stayed on page 1", closed, 1)
Reset()

SpokenBooksSettings.readWholeBook = false
OpenRegistry()
Expect("with Read Whole Book off, only page 1 is queued", Queued(), 1)
stub.Advance(4)
Expect("...and hearing it leaves the book open to turn", closed, 0)
SpokenBooksSettings.readWholeBook = true
Reset()

-- Its last page silent: nothing is left to hear once page 2 has been read.
local voiced = SpokenBooksAudioPacks.SpokenBooksAudio.pages[265]
SpokenBooksAudioPacks.SpokenBooksAudio.pages[265] = nil
OpenRegistry()
Expect("a book whose last page is silent queues the rest", Queued(), 2)
stub.Advance(6)
Expect("...and closes once its last voiced page has been heard", closed, 1)
SpokenBooksAudioPacks.SpokenBooksAudio.pages[265] = voiced
Reset()

---------------------------------------------------------------- the command
SlashCmdList["SPOKENBOOKS"]("close")
Expect("/spb close toggles it", SpokenBooksSettings.closeWhenRead, false)
SlashCmdList["SPOKENBOOKS"]("close")
Expect("...and back", SpokenBooksSettings.closeWhenRead, true)

print(Failures() == 0 and "All books close tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
