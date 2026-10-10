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
dofile(BOOKS .. "Data/Places.lua")

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

--- The pages still to come of `book`, the registry by default.
local function Coming(book)
    local entry = (B.following or {})[book or 261]
    return entry and entry.pages or {}
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
Expect("...under what it is, as the Compendium sorts it, as a speaker over a quest", clip.present.header, "Book")
Expect("...named by the book, whatever page of it this is: the book is one line", clip.present.label,
    "Hillsbrad Town Registry")
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

Expect("opening page 1 reads the whole book, skipping the page with no clip", B:PlayFrom(261), 3)
Expect("...the book one line in the queue: its first page", Same(QueuedPages(), { 261 }), true)
Expect("...the rest to follow it", Same(Coming(), { 262, 265 }), true)

---------------------------------------------------------------- turning pages
Expect("turning to a page still to come changes nothing", B:SyncTo(262), 0)
Expect("...and leaves the queue alone", Same(QueuedPages(), { 261 }), true)
Expect("...and leaves the current clip's captions on its own page",
    Spoken:GetQueue()[1].present.transcript, SpokenBooksData.pages[261].text)
Expect("the next page carries its own captions", B:ClipFor(262).present.transcript, SpokenBooksData.pages[262].text)
Expect("turning to the last page also changes nothing", B:SyncTo(265), 0)

---------------------------------------------------------------- a page finishing
local audio = env.Addon.db.profile.Audio

--- How many times the cue between lines has played.
local function Cues()
    local n = 0
    for _, s in ipairs(stub.world.kitSounds) do
        if s.kit == _G.SOUNDKIT.IG_QUEST_LOG_CLOSE then n = n + 1 end
    end
    return n
end

-- Page 261 speaks for 30.5s; the book's gap after it is the source's 0.35s.
stub.Advance(30.8)
Expect("a page finishing: the next page waits the book's gap after the voice, even with nothing else queued",
    Same(QueuedPages(), { 261 }), true)
stub.Advance(0.1)
Expect("...then starts at the head, still one line", Same(QueuedPages(), { 262 }), true)
Expect("...speaking", stub.world.played[#stub.world.played], B:ClipFor(262).path)
Expect("...what follows it shorter by that page", Same(Coming(), { 265 }), true)
Spoken:Skip()
Expect("Skip skips the rest of the book", #QueuedPages() .. " " .. tostring((B.following or {})[261]), "0 nil")
B:PlayFrom(261)

-- Another readable opened while a book is read waits behind it: the book reads on to its end.
B:SyncTo(2810)
Expect("opening another readable while the book is read queues it after: it waits for the book",
    Same(QueuedPages(), { 261, 2810 }), true)
Expect("...the book still to follow on", Same(Coming(), { 262, 265 }), true)
-- The readable waiting must not turn the book's pages into separate lines.
local cues, lineGap, cueBetween = Cues(), audio.LineGap, audio.CueBetweenLines
audio.LineGap, audio.CueBetweenLines = 1, true
stub.Advance(30.8)
Expect("with a readable waiting, the next page still waits only the book's gap",
    Same(QueuedPages(), { 261, 2810 }), true)
stub.Advance(0.1)
Expect("...then starts ahead of the readable", Same(QueuedPages(), { 262, 2810 }), true)
stub.Advance(1)
Expect("...with no cue between the pages", Cues() - cues, 0)
audio.LineGap, audio.CueBetweenLines = lineGap, cueBetween
-- Turned back to a page of the book being read that is not coming: the book starts again from
-- there, in the queue's order: after what waits.
B:StopReading()
B:PlayFrom(262)
B:SyncTo(2810)
B:SyncTo(261)
Expect("turning back in the book being read starts it again from there, after what waits",
    Same(QueuedPages(), { 2810, 261 }) and Same(Coming(), { 262, 265 }), true)

---------------------------------------------------------------- stopping by hand
-- A book's Stop: that book goes, the readable waiting with it stays.
B:StopReading(261)
Expect("stopping one book drops it and what was to follow, the other readable still waiting",
    Same(QueuedPages(), { 2810 }) and #Coming() == 0, true)
-- What `/spb stop` reaches. Closing the frame does not come here: a book carries on being
-- read after it is shut.
B:StopReading()
Expect("stopping with no book named drops every readable", #QueuedPages(), 0)

---------------------------------------------------------------- reading one page only
SpokenBooksSettings.readWholeBook = false
B:PlayFrom(261)
Expect("with whole-book reading off, only the page on screen is queued",
    Same(QueuedPages(), { 261 }) and #Coming() == 0, true)
SpokenBooksSettings.readWholeBook = true
B:StopReading()

---------------------------------------------------------------- with no pack at all
_G.SpokenBooksAudioPacks = {}
Expect("no pack means no clips", B:ClipFor(261), nil)
Expect("...and a message that names the download rather than blaming the page",
    B:DescribeMissingAudio(), "No Books voice pack is installed.")

print(Failures() == 0 and "All books playlist tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
