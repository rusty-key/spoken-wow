-- The client's book frame driving the addon: opening, turning pages, closing, and the
-- autoplay switch that decides whether any of it speaks. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local READABLES = here .. "/../../addons/Spoken_Readables/"
local Expect, Failures = H.Expecter(print)

_G.SpokenReadablesAudioPacks = {
    SpokenReadablesAudio = {
        version = 1, addon = "SpokenReadablesAudio", quality = "high", bitrate = 128,
        pages = {
            [261] = { file = "261", len = 30.5 },
            [262] = { file = "262", len = 41.0 },
            [265] = { file = "265", len = 12.25 },
        },
    },
}

local REGISTRY_1 = "Hillsbrad Town Registry\n\nWe the people of Hillsbrad do solemny swear our faith and devotion to the Alliance maintained by the great monarchs, King Magni Bronzebeard of Ironforge and King Anduin Wrynn of Stormwind.\n\nHerein lies the town registry for purposes of governing this fair city in the foothills of the great Alterac Mountains as well as serving as a record of those who have paid their taxes to their Kings and to the great almighty Alliance."
local REGISTRY_2 = "Magistrate Rutherford Burnside\nAll debts settled.\n\nBlacksmith Avery Verringtan\nAll debts settled.\n\nClerk Horrace Whitesteed\nAll debts settled.\n\nCouncilman Gillis\nAll debts settled.\n\nCouncilman Hooks\nAll debts settled.\n\nFarmer Getz\nAll debts settled.\n\nFarmer Ray\nDebt outstanding.  Payment in agricultural goods promised at time of harvest.\n\nFarmer Lyion\nDebt outstanding.  Evicted from the land."

local function LoadReadables()
    local SpokenReadables = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Opener", "Reader", "Audio", "Playlist",
        "UI/PlayButton", "Events", "Commands" }) do
        local chunk = assert(loadfile(READABLES .. file .. ".lua"))
        chunk("Spoken_Readables", SpokenReadables)
    end
    return SpokenReadables
end

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
_G.SpokenReadablesSettings = nil
local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
local B = LoadReadables()
B:InitDB()
B:SetupSource()
dofile(READABLES .. "Data/Books.lua")

local function QueuedPages()
    local pages = {}
    for _, clip in ipairs(Spoken:GetQueue()) do
        if clip.pageId then table.insert(pages, clip.pageId) end
    end
    return pages
end

--- The registry's pages still to come.
local function Coming()
    local entry = (B.following or {})[261]
    return entry and entry.pages or {}
end

--- How many pages are being read: the one queued, and the rest of its book to follow it.
local function Reading()
    return #QueuedPages() + #Coming()
end

---------------------------------------------------------------- opening a book
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("opening a book queues it, as one line", #QueuedPages(), 1)
Expect("...starting at the page on screen", QueuedPages()[1], 261)
Expect("...its other pages to follow", #Coming(), 2)

---------------------------------------------------------------- turning a page
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 2, text = REGISTRY_2, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("turning to a page still to come does not restart the book", tostring(QueuedPages()[1]) .. " " .. #Coming(),
    "261 2")
Expect("...and remembers where the reader is", B.lastPage, 262)

---------------------------------------------------------------- closing it
-- The frame goes before the event does: ItemTextGetText() answers nil from here, which is
-- what the client actually does and what makes `/spw read` afterwards a no-op.
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
Expect("closing the book does not stop narration", Reading(), 3)
Expect("...but forgets the page, because there is no page on screen", B.lastPage, nil)

---------------------------------------------------------------- mail, through the events
-- Stopped by hand, which closing the frame above no longer does: this section is about what
-- mail queues, not about the book still being read behind it.
B:StopReading()
SpokenReadablesCharacter.found = {}
stub.ShowPage({ title = "A letter", number = 1, text = REGISTRY_1, creator = "Somebody" })
stub.FireEvent("ITEM_TEXT_READY")
Expect("mail queues nothing", #QueuedPages(), 0)
Expect("...and is not remembered as a page", B.lastPage, nil)
Expect("...nor found", next(SpokenReadablesCharacter.found), nil)
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")

---------------------------------------------------------------- autoplay off
SpokenReadablesSettings.autoplay = false
SpokenReadablesCharacter.found, SpokenReadablesCharacter.read = {}, {}
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1 })
stub.FireEvent("ITEM_TEXT_READY")
Expect("with autoplay off nothing speaks by itself", #QueuedPages(), 0)
Expect("...but the page is remembered, so it can be read on request", B.lastPage, 261)
Expect("...and the book counts as found, opened though not heard", B:IsBookFound(B:PlaceOf(261)), true)
Expect("...without counting as read, which Read Only Once goes by", B:HasReadBook(B:PlaceOf(261)), false)

B:ReadCurrent()
Expect("asking for it reads it anyway", Reading(), 3)
B:StopReading()
SpokenReadablesSettings.autoplay = true

---------------------------------------------------------------- the slash command
Expect("the commands are /spokenreadables and /spr, and /spokenwritings, /spw, /spokenbooks and /spb still work",
    table.concat({ SLASH_SPOKENREADABLES1, SLASH_SPOKENREADABLES2, SLASH_SPOKENREADABLES3, SLASH_SPOKENREADABLES4,
        SLASH_SPOKENREADABLES5, SLASH_SPOKENREADABLES6 }, " "),
    "/spokenreadables /spr /spokenwritings /spw /spokenbooks /spb")
SlashCmdList["SPOKENREADABLES"]("autoplay")
Expect("/spw autoplay toggles it", SpokenReadablesSettings.autoplay, false)
SlashCmdList["SPOKENREADABLES"]("autoplay")
Expect("...and back", SpokenReadablesSettings.autoplay, true)

SlashCmdList["SPOKENREADABLES"]("whole")
Expect("/spw whole toggles whole-book reading", SpokenReadablesSettings.readWholeBook, false)
SlashCmdList["SPOKENREADABLES"]("whole")

stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
SlashCmdList["SPOKENREADABLES"]("read")
Expect("/spw read with no book open queues nothing", #QueuedPages(), 0)

-- With the page already queued, /spw read says why nothing new started: reading, or stopped.
do
    local said
    local chat = _G.DEFAULT_CHAT_FRAME.AddMessage
    _G.DEFAULT_CHAT_FRAME.AddMessage = function(_, message) said = message end
    stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
    stub.FireEvent("ITEM_TEXT_READY")
    SlashCmdList["SPOKENREADABLES"]("read")
    Expect("/spw read on the page being read says so", said and said:find("already reading") ~= nil, true)
    Spoken:Pause()
    SlashCmdList["SPOKENREADABLES"]("read")
    Expect("...and on a stopped one, that Spoken is stopped", said and said:find("Spoken is stopped") ~= nil, true)
    Spoken:Resume()
    stub.ShowPage({ title = "Hillsbrad Town Registry", number = 2, text = REGISTRY_2, hasNext = true })
    stub.FireEvent("ITEM_TEXT_READY")
    SlashCmdList["SPOKENREADABLES"]("read")
    Expect("...and on a page of it still to come, that it is coming", said and said:find("still to come") ~= nil, true)
    B:StopReading()
    stub.ClosePage()
    stub.FireEvent("ITEM_TEXT_CLOSED")
    _G.DEFAULT_CHAT_FRAME.AddMessage = chat
end

---------------------------------------------------------------- reading each book only once
B:StopReading()
SpokenReadablesCharacter.read = {}
SpokenReadablesSettings.readOnce = true
local REGISTRY = B:PlaceOf(261)

-- Opened at page 2, so page 1 is a page of this book the queue does not cover.
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 2, text = REGISTRY_2, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("a book this character has not read is read", Reading(), 2)
Expect("...and counts as read from the moment it starts", SpokenReadablesCharacter.read[REGISTRY], true)

stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("turning back inside the book being read still follows the reader", Reading(), 3)

-- Stopped and opened again, which is the case the setting exists for.
B:StopReading()
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("a book already read is not read again", #QueuedPages(), 0)

B:ReadCurrent()
Expect("...but asking for it still reads it", Reading(), 3)

B:StopReading()
Expect("forgetting the record empties it", B:ForgetRead() >= 1, true)
stub.FireEvent("ITEM_TEXT_READY")
Expect("...so the same book is read again", Reading(), 3)
SpokenReadablesSettings.readOnce = false

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
Expect("pressing it again reads the book", Reading(), 3)
Expect("...whatever autoplay and read-once say", button:GetText(), "Stop")

-- Open in Azeroth's Compendium beside it, for a writing whose page the Compendium shows.
local open, opened = B.openButton, nil
local has, show = B.CompendiumHas, B.ShowReadables
B.CompendiumHas = function(_, book) return book ~= nil end
B.ShowReadables = function(_, book) opened = book end
B:RefreshPlayButton()
Expect("Open in Azeroth's Compendium beside Play, for a writing the Compendium shows",
    open ~= nil and open:IsShown() and open.anchor.relativeTo == button and open.anchor.point, "RIGHT")
open.scripts.OnClick(open)
Expect("...opening its tab on the book", opened ~= nil and opened == B:PlaceOf(B:PageOnScreen()), true)
B.CompendiumHas = function() return false end
B:RefreshPlayButton()
Expect("...and none for one it does not", open:IsShown(), false)
B.CompendiumHas, B.ShowReadables = has, show

-- Mail is not a book, and a button on a letter would be an invitation to read somebody's
-- post aloud.
B:StopReading()
stub.ShowPage({ title = "A letter", number = 1, text = REGISTRY_1, creator = "Somebody" })
stub.FireEvent("ITEM_TEXT_READY")
Expect("no button on mail", button:IsShown(), false)

---------------------------------------------------------------- what opened the frame
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
stub.FireEvent("PLAYER_ENTERING_WORLD")
stub.FireEvent("PLAYER_SOFT_INTERACT_CHANGED", nil, "GameObject-0-4170-0-6-175685-00002A5B1C")
stub.FireEvent("ITEM_TEXT_BEGIN")
Expect("the interact key's object is a candidate when the frame opens", B.openedBy and B.openedBy[1].id, 175685)
stub.FireEvent("ITEM_TEXT_CLOSED")
Expect("...and forgotten when it closes", B.openedBy, nil)

print(Failures() == 0 and "All readables event tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
