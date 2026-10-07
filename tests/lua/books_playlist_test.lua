-- A book read straight through, and kept in step with the page on screen. The queue is the
-- real Spoken one. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local BOOKS = here .. "/../../addons/Spoken_Books/"
local Expect, Failures = H.Expecter(print)

-- The Hillsbrad Town Registry: four real pages of one real book, 261 through 265.
local REGISTRY = { 261, 262, 263, 265 }

-- A pack covering three of its four pages, so the fourth exercises the skip.
_G.SpokenBooksAudioPacks = {
    SpokenBooksAudio = {
        version = 1, addon = "SpokenBooksAudio", quality = "high", bitrate = 128,
        pages = {
            [261] = { file = "261", len = 30.5 },
            [262] = { file = "262", len = 41.0 },
            [265] = { file = "265", len = 12.25 },
            -- A page of a different book entirely: what a reader jumping to another book
            -- looks like from here.
            [2810] = { file = "2810", len = 8.0 },
        },
    },
}

local function LoadBooks()
    local SpokenBooks = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist", "UI/CopyLink" }) do
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

--- The books clips in the player's queue, in order, by page id.
local function QueuedPages()
    local pages = {}
    for _, clip in ipairs(Spoken:GetQueue()) do
        if clip.pageId then
            table.insert(pages, clip.pageId)
        end
    end
    return pages
end

local function Same(list, expected)
    if #list ~= #expected then return false end
    for i = 1, #list do
        if list[i] ~= expected[i] then return false end
    end
    return true
end

---------------------------------------------------------------- the clip
local clip = B:ClipFor(261)
Expect("a page has a clip when the pack carries it", clip ~= nil, true)
Expect("...keyed the way the corpus names the line", clip.key, "b:261")
Expect("...pointing into the pack's own folder",
    clip.path, [[Interface\AddOns\SpokenBooksAudio\Sounds\261.mp3]])
Expect("...carrying the recorded duration", clip.length, 30.5)
Expect("...carrying the first page's saved captions", clip.present.transcript,
    SpokenBooksData.pages[261].text)
Expect("...with readable text even before opening the book", #clip.present.transcript > 0, true)
Expect("...titled with the book", clip.present.header, "Hillsbrad Town Registry")
Expect("...and numbered, because this book has more than one page", clip.present.label, "Page 1 of 4")
Expect("a page the pack does not carry has no clip", B:ClipFor(263), nil)

---------------------------------------------------------------- reporting a bad reading
local report = clip.present.actions and clip.present.actions[1]
Expect("every clip carries a report action", report and report.id, "report")
Expect("...drawn as the bug icon the other addons use", report and report.icon,
    [[Interface\HelpFrame\HelpIcon-Bug]])
Expect("...with a letter for the clients whose art predates it", report and report.text, "R")

-- Built from the page id alone, which docs/books/AGENTS.md freezes as b:{pageTextID}. That
-- is what lets the addon address a page with no per-page table and nothing to escape.
Expect("the report address names the page", B:ReportURL(261),
    "https://spoken.rusty.one/books/r/261")
Expect("...and is nothing at all without one", B:ReportURL(nil), nil)

-- The client cannot open a browser, so pressing it can only offer the address to copy.
local before = table.getn(stub.popups)
report.onClick(clip)
Expect("pressing it raises one popup", table.getn(stub.popups), before + 1)
Expect("...saying what the address is for",
    string.find(stub.popups[table.getn(stub.popups)].args[1] or "", "report a problem") ~= nil,
    true)

---------------------------------------------------------------- reading a book
Expect("a book lists the pages from here on", Same(B:PagesFrom(262), { 262, 263, 265 }), true)

B:PlayFrom(261)
Expect("opening page 1 queues the whole book, skipping the page with no clip",
    Same(QueuedPages(), { 261, 262, 265 }), true)

---------------------------------------------------------------- turning pages
local before = #QueuedPages()
Expect("turning to a page already queued changes nothing", B:SyncTo(262), 0)
Expect("...and leaves the queue alone", #QueuedPages(), before)
Expect("...and leaves the current clip's captions on its own page",
    Spoken:GetQueue()[1].present.transcript, SpokenBooksData.pages[261].text)
Expect("the next queued page already carries its own captions",
    Spoken:GetQueue()[2].present.transcript, SpokenBooksData.pages[262].text)

Expect("turning to the last queued page also changes nothing", B:SyncTo(265), 0)

-- Opening a different book: nothing queued covers it, so this source's queue is dropped
-- and rebuilt from the new page rather than narrating on through the old book.
B:SyncTo(2810)
Expect("opening another book rebuilds the queue from there", Same(QueuedPages(), { 2810 }), true)

---------------------------------------------------------------- stopping by hand
-- What `/spb stop` reaches. Closing the frame does not come here: a book carries on being
-- read after it is shut.
B:StopReading()
Expect("stopping drops this source's narration", #QueuedPages(), 0)

---------------------------------------------------------------- reading one page only
SpokenBooksSettings.readWholeBook = false
B:PlayFrom(261)
Expect("with whole-book reading off, only the page on screen is queued",
    Same(QueuedPages(), { 261 }), true)
SpokenBooksSettings.readWholeBook = true
B:StopReading()

---------------------------------------------------------------- with no pack at all
_G.SpokenBooksAudioPacks = {}
Expect("no pack means no clips", B:ClipFor(261), nil)
Expect("...and a message that names the download rather than blaming the page",
    B:DescribeMissingAudio(), "No Writings voice pack is installed.")

print(Failures() == 0 and "All books playlist tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
