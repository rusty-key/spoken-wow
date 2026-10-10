-- The client's book frame driving the addon: opening, turning pages, closing, and the
-- autoplay switch that decides whether any of it speaks. Run with `make test-player`.
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
            [261] = { file = "261", len = 30.5 },
            [262] = { file = "262", len = 41.0 },
            [265] = { file = "265", len = 12.25 },
        },
    },
}

local REGISTRY_1 = "Hillsbrad Town Registry\n\nWe the people of Hillsbrad do solemny swear our faith and devotion to the Alliance maintained by the great monarchs, King Magni Bronzebeard of Ironforge and King Anduin Wrynn of Stormwind.\n\nHerein lies the town registry for purposes of governing this fair city in the foothills of the great Alterac Mountains as well as serving as a record of those who have paid their taxes to their Kings and to the great almighty Alliance."
local REGISTRY_2 = "Magistrate Rutherford Burnside\nAll debts settled.\n\nBlacksmith Avery Verringtan\nAll debts settled.\n\nClerk Horrace Whitesteed\nAll debts settled.\n\nCouncilman Gillis\nAll debts settled.\n\nCouncilman Hooks\nAll debts settled.\n\nFarmer Getz\nAll debts settled.\n\nFarmer Ray\nDebt outstanding.  Payment in agricultural goods promised at time of harvest.\n\nFarmer Lyion\nDebt outstanding.  Evicted from the land."

local function LoadBooks()
    local SpokenBooks = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
        "UI/PlayButton", "Events", "Commands" }) do
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

local function QueuedPages()
    local pages = {}
    for _, clip in ipairs(Spoken:GetQueue()) do
        if clip.pageId then table.insert(pages, clip.pageId) end
    end
    return pages
end

---------------------------------------------------------------- opening a book
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("opening a book queues it", #QueuedPages(), 3)
Expect("...starting at the page on screen", QueuedPages()[1], 261)

---------------------------------------------------------------- turning a page
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 2, text = REGISTRY_2, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("turning to a queued page does not restart the book", #QueuedPages(), 3)
Expect("...and remembers where the reader is", B.lastPage, 262)

---------------------------------------------------------------- closing it
-- The frame goes before the event does: ItemTextGetText() answers nil from here, which is
-- what the client actually does and what makes `/spb read` afterwards a no-op.
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
Expect("closing the book does not stop narration", #QueuedPages(), 3)
Expect("...but forgets the page, because there is no page on screen", B.lastPage, nil)

---------------------------------------------------------------- mail, through the events
-- Stopped by hand, which closing the frame above no longer does: this section is about what
-- mail queues, not about the book still being read behind it.
B:StopReading()
SpokenBooksCharacter.found = {}
stub.ShowPage({ title = "A letter", number = 1, text = REGISTRY_1, creator = "Somebody" })
stub.FireEvent("ITEM_TEXT_READY")
Expect("mail queues nothing", #QueuedPages(), 0)
Expect("...and is not remembered as a page", B.lastPage, nil)
Expect("...nor found", next(SpokenBooksCharacter.found), nil)
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")

---------------------------------------------------------------- autoplay off
SpokenBooksSettings.autoplay = false
SpokenBooksCharacter.found, SpokenBooksCharacter.read = {}, {}
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1 })
stub.FireEvent("ITEM_TEXT_READY")
Expect("with autoplay off nothing speaks by itself", #QueuedPages(), 0)
Expect("...but the page is remembered, so it can be read on request", B.lastPage, 261)
Expect("...and the book counts as found, opened though not heard", B:IsBookFound(B:PlaceOf(261)), true)
Expect("...without counting as read, which Read Only Once goes by", B:HasReadBook(B:PlaceOf(261)), false)

B:ReadCurrent()
Expect("asking for it reads it anyway", #QueuedPages(), 3)
B:StopReading()
SpokenBooksSettings.autoplay = true

---------------------------------------------------------------- the slash command
SlashCmdList["SPOKENBOOKS"]("autoplay")
Expect("/spb autoplay toggles it", SpokenBooksSettings.autoplay, false)
SlashCmdList["SPOKENBOOKS"]("autoplay")
Expect("...and back", SpokenBooksSettings.autoplay, true)

SlashCmdList["SPOKENBOOKS"]("whole")
Expect("/spb whole toggles whole-book reading", SpokenBooksSettings.readWholeBook, false)
SlashCmdList["SPOKENBOOKS"]("whole")

stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
SlashCmdList["SPOKENBOOKS"]("read")
Expect("/spb read with no book open queues nothing", #QueuedPages(), 0)

-- With the page already queued, /spb read says why nothing new started: reading, or stopped.
do
    local said
    local chat = _G.DEFAULT_CHAT_FRAME.AddMessage
    _G.DEFAULT_CHAT_FRAME.AddMessage = function(_, message) said = message end
    stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
    stub.FireEvent("ITEM_TEXT_READY")
    SlashCmdList["SPOKENBOOKS"]("read")
    Expect("/spb read on the page being read says so", said and said:find("already reading") ~= nil, true)
    Spoken:Pause()
    SlashCmdList["SPOKENBOOKS"]("read")
    Expect("...and on a stopped one, that Spoken is stopped", said and said:find("Spoken is stopped") ~= nil, true)
    Spoken:Resume()
    B:StopReading()
    stub.ClosePage()
    stub.FireEvent("ITEM_TEXT_CLOSED")
    _G.DEFAULT_CHAT_FRAME.AddMessage = chat
end

---------------------------------------------------------------- reading each book only once
B:StopReading()
SpokenBooksCharacter.read = {}
SpokenBooksSettings.readOnce = true
local REGISTRY = B:PlaceOf(261)

-- Opened at page 2, so page 1 is a page of this book the queue does not cover.
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 2, text = REGISTRY_2, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("a book this character has not read is read", #QueuedPages(), 2)
Expect("...and counts as read from the moment it starts", SpokenBooksCharacter.read[REGISTRY], true)

stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("turning back inside the book being read still follows the reader", #QueuedPages(), 3)

-- Stopped and opened again, which is the case the setting exists for.
B:StopReading()
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("a book already read is not read again", #QueuedPages(), 0)

B:ReadCurrent()
Expect("...but asking for it still reads it", #QueuedPages(), 3)

B:StopReading()
Expect("forgetting the record empties it", B:ForgetRead() >= 1, true)
stub.FireEvent("ITEM_TEXT_READY")
Expect("...so the same book is read again", #QueuedPages(), 3)
SpokenBooksSettings.readOnce = false

---------------------------------------------------------------- the button on the book frame
B:StopReading()
B:SetupPlayButton()
local button = B.playButton
Expect("the book frame carries a button", button ~= nil, true)

-- On the page, bottom right. Twice it was on the strip above the page instead -- off the
-- frame's corner, then beside the previous-page arrow -- and that row has no free space: the
-- arrows carry PREV and NEXT labels on their inner edges, and ItemTextCurrentPage is a
-- 192-wide FontString reaching back under the left arrow. The scrollbar hangs outside the
-- page's right edge, so this corner is clear of it too.
Expect("...on the page, not on the row above it", button.anchor.relativeTo,
    _G.ItemTextScrollFrame)
Expect("...in its bottom-right corner",
    button.anchor.point .. "/" .. button.anchor.relativePoint, "BOTTOMRIGHT/BOTTOMRIGHT")
Expect("...inset, so it sits on the parchment rather than over its edge",
    button.anchor.x < 0 and button.anchor.y > 0, true)

-- ITEM_TEXT_CLOSED is not handled for the button on purpose: it is the frame's child and
-- goes with it. What is asserted here is the branch the addon does own -- asked to refresh
-- with no page on screen, it hides rather than leaving Stop offered for a book nobody has
-- open. (The stub tracks visibility per widget, so a hidden parent would not show here.)
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
B:RefreshPlayButton()
Expect("...hidden when there is no page to read", button:IsShown(), false)

stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("shown on a page the pack can narrate", button:IsShown(), true)
Expect("...offering Stop while that book is being read", button:GetText(), "Stop")

button.scripts.OnClick(button)
Expect("pressing it stops the book", #QueuedPages(), 0)
Expect("...and offers to start it again", button:GetText(), "Play")

button.scripts.OnClick(button)
Expect("pressing it again reads the book", #QueuedPages(), 3)
Expect("...whatever autoplay and read-once say", button:GetText(), "Stop")

-- Mail is not a book, and a button on a letter would be an invitation to read somebody's
-- post aloud.
B:StopReading()
stub.ShowPage({ title = "A letter", number = 1, text = REGISTRY_1, creator = "Somebody" })
stub.FireEvent("ITEM_TEXT_READY")
Expect("no button on mail", button:IsShown(), false)

print(Failures() == 0 and "All books event tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
