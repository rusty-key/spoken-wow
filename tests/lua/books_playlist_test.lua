-- A book read straight through, and kept in step with the page on screen. The queue is the
-- real Spoken one. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local BOOKS = here .. "/../../addons/Spoken_Readables/"
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
            -- William's Shipment, a letter of one page.
            [15] = { file = "15", len = 6.0 },
        },
    },
}

local function LoadBooks()
    local SpokenBooks = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Contribute", "Audio", "Playlist", "Events", "UI/CopyLink" }) do
        local chunk = assert(loadfile(BOOKS .. file .. ".lua"))
        chunk("Spoken_Readables", SpokenBooks)
    end
    return SpokenBooks
end

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
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
local letter = B:ClipFor(15)
-- A first page that does not open with its title is read after it: the narration reads the title
-- first, and the captions' words start once it is said.
local timings = letter.present.timings
Expect("a letter's words start after its title, which its recording reads first",
    timings ~= nil and #timings == #(_G.Spoken:CaptionWords(letter.present.transcript)) and timings[1] > 0, true)
local rising = timings ~= nil
for i = 2, #(timings or {}) do rising = rising and timings[i] > timings[i - 1] end
Expect("...each word after the last, all within the recording", rising and timings[#timings] < letter.length, true)
Expect("a first page opening with its own title starts its words at once", clip.present.timings, nil)
Expect("...and a later page, read without its title, too", B:ClipFor(262).present.timings, nil)
Expect("a one-page letter is named by its title, under what it is", letter.present.label .. " " .. tostring(letter.present.header ~= letter.present.label),
    "William's Shipment true")

---------------------------------------------------------------- reporting a bad reading
local report = clip.present.actions and clip.present.actions[1]
Expect("every clip carries a report action", report and report.id, "report")
Expect("...drawn as the bug icon the other addons use", report and report.icon,
    [[Interface\HelpFrame\HelpIcon-Bug]])

-- Built from the page id alone, which docs/books/AGENTS.md freezes as b:{pageTextID}. That
-- is what lets the addon address a page with no per-page table and nothing to escape.
Expect("the report address names the page", B:ReportURL(261),
    "https://spoken.rusty.one/books/r/261")
Expect("...and is nothing at all without one", B:ReportURL(nil), nil)

-- The client cannot open a browser, so pressing it can only offer the address to copy, in
-- Spoken's box: the context makes it longer than a popup's edit box holds.
report.onClick(clip)
local box = _G.Spoken.ContributeBox
local address, context = H.SplitReportLink(box and box.frame:IsShown() and box.editBox:GetText())
Expect("pressing it offers the page's address", address, "https://spoken.rusty.one/books/r/261")
Expect("...carrying the addon and the page", context
    and context:find("\naddon=", 1, true) and context:find("\nid=261\n", 1, true) and true, true)
box.frame:Hide()

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

---------------------------------------------------------------- played while the player is stopped
-- A book opened in the world waits its turn behind the player's Stop; Play in the Compendium
-- starts it, ending the stop.
Spoken:Pause()
B:PlayFrom(261)
Expect("a book opened in the world while the player is stopped waits in the queue, silent",
    table.concat(QueuedPages(), ",") .. " " .. tostring(Spoken:IsPaused()) .. " " .. tostring(Spoken:IsPlaying()),
    "261 true false")
B:StopReading()
Spoken:Pause()
local playedBefore = #stub.world.played
Expect("Play in the Compendium while the player is stopped plays the book at once, ending the stop",
    B:PlayFrom(261, true) .. " " .. tostring(Spoken:IsPaused()) .. " " .. tostring(stub.world.played[#stub.world.played]
    == B:ClipFor(261).path and #stub.world.played > playedBefore), "3 false true")
Expect("...the rest of the book to follow it", Same(Coming(), { 262, 265 }), true)
B:StopReading()

---------------------------------------------------------------- the progress bar across the book
-- One line: the bar runs across the whole book, not each page.
B:PlayFrom(261)
local firstPage = Spoken:GetQueue()[1]
local total = 30.5 + 41.0 + 12.25
Expect("a book's first page knows the reading's length",
    firstPage.span and (firstPage.span.before .. " " .. firstPage.span.total), "0 " .. total)
Expect("...its bar a share of the book, not of the page",
    math.abs(env.SoundQueue:Share(firstPage, 10) - 10 / total) < 1e-9, true)
stub.Advance(30.9)
local secondPage = Spoken:GetQueue()[1]
Expect("the next page's bar starts where the last page's ended",
    secondPage.pageId .. " " .. tostring(secondPage.span and secondPage.span.before), "262 30.5")
B:StopReading()
-- A page with no length: the bar runs across each page, not a wrong share of the book.
local pages = SpokenBooksAudioPacks.SpokenBooksAudio.pages
pages[262].len = 0
B:PlayFrom(261)
Expect("a page with no length leaves the bar to each page", Spoken:GetQueue()[1].span, nil)
pages[262].len = 41.0
B:StopReading()

---------------------------------------------------------------- a page whose file is missing
-- A pack updated without a restart lists pages whose files the client cannot see yet: the
-- book reads on from the next page rather than wait for one that never plays.
stub.world.missing[B:ClipFor(261).path] = true
Expect("a first page with no file: the book starts from the next", B:PlayFrom(261) .. " "
    .. table.concat(QueuedPages(), ",") .. " " .. table.concat(Coming(), ","), "2 262 265")
B:StopReading()
stub.world.missing[B:ClipFor(261).path] = nil
stub.world.missing[B:ClipFor(262).path] = true
B:PlayFrom(261)
stub.Advance(30.9)
Expect("a middle page with no file: the book goes on to the one after it",
    table.concat(QueuedPages(), ",") .. " " .. #Coming(), "265 0")
Expect("...its bar no longer claiming a share of the book", Spoken:GetQueue()[1].span, nil)
stub.world.missing[B:ClipFor(262).path] = nil
B:StopReading()
Expect("...and nothing of the book left behind", next(B.following or {}), nil)

---------------------------------------------------------------- a line per page
SpokenBooksSettings.bookAsOneLine = false
Expect("Read Book as One Line off: every page queued now, each a line of its own",
    B:PlayFrom(261) .. " " .. table.concat(QueuedPages(), ","), "3 261,262,265")
local page = Spoken:GetQueue()[1]
Expect("...the book over its page count", page.present.header .. " / " .. tostring(page.present.label),
    "Hillsbrad Town Registry / Page 1 of 4")
Expect("...one item, so no pause or cue between its pages", page.group, "book:261")
Expect("...and nothing to follow it", tostring(page.continues) .. " " .. #Coming(), "nil 0")
SpokenBooksSettings.bookAsOneLine = true
B:StopReading()

---------------------------------------------------------------- with no pack at all
_G.SpokenBooksAudioPacks = {}
Expect("no pack means no clips", B:ClipFor(261), nil)
Expect("...and a message that names the download rather than blaming the page",
    B:DescribeMissingAudio(), "No Readables voice pack is installed.")

print(Failures() == 0 and "All books playlist tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
