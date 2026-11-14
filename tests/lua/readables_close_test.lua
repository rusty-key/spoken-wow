-- Close Book When Done Reading: the book shuts once its last page has been heard, which is also what
-- gives back the interface DialogueUI's book view hides. Run with `make test-player`.
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
            [15] = { file = "15", len = 2 },
            [261] = { file = "261", len = 2 },
            [262] = { file = "262", len = 2 },
            [265] = { file = "265", len = 2 },
        },
    },
}

local LETTER = "Hello Morgan,\n\nBusiness in Goldshire is brisk."
local REGISTRY_1 = "Hillsbrad Town Registry\n\nWe the people of Hillsbrad do solemny swear our faith and devotion to the Alliance maintained by the great monarchs, King Magni Bronzebeard of Ironforge and King Anduin Wrynn of Stormwind.\n\nHerein lies the town registry for purposes of governing this fair city in the foothills of the great Alterac Mountains as well as serving as a record of those who have paid their taxes to their Kings and to the great almighty Alliance."

local function LoadReadables()
    local SpokenReadables = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
        "Events", "Commands" }) do
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
SpokenReadablesData.index["William's Shipment"][1][B:ChecksumOf(LETTER)] = 15

---------------------------------------------------------------- readable items entering the bags
local bagItems = {}
_G.NUM_BAG_SLOTS = 4
_G.GetContainerNumSlots = function(bag) return bag == 0 and 4 or 0 end
_G.GetContainerItemID = function(bag, slot) return bag == 0 and bagItems[slot] or nil end
_G.GetItemInfoInstant = function(itemID) return itemID, "Quest", "Note", "", 123456 end
_G.SpokenReadablesPlaces = { books = {} }
_G.C_QuestLog = { GetAllCompletedQuestIDs = function() return { 12345, 97277 } end }
_G.LibQuestieDB = {
    Item = { Get = function() return nil end },
    Quest = {
        Get = function(questID, field)
            if field ~= "sourceItemId" then return nil end
            if questID == 12345 then return 745 end
            if questID == 97277 then return 277976 end
        end,
    },
}
SpokenReadablesCharacter.found = {}
SpokenReadablesCharacter.questReadableBackfill = nil
stub.FireEvent("PLAYER_LOGIN")
Expect("a completed source-item quest backfills its readable", B:IsBookFound(209), true)
Expect("a completed Forever source-item quest backfills its readable", B:IsBookFound("nc0bf109d-e5d1-494d-ba1b-12a6b27352a8"), true)

-- A bag event can precede login while Questie is still loading. It must not consume the
-- one-shot backfill before PLAYER_LOGIN has a chance to see Questie's source-item index.
do
    local questie = _G.LibQuestieDB
    _G.LibQuestieDB = nil
    _G.SpokenReadablesPlaces = { books = {} }
    _G.C_QuestLog.GetAllCompletedQuestIDs = function() return { 12345 } end
    SpokenReadables.hasLoggedIn = false
    SpokenReadablesCharacter.found, SpokenReadablesCharacter.questReadableBackfill = {}, nil
    bagItems[1] = 745
    SpokenReadables.readableItemCounts = nil
    stub.FireEvent("BAG_UPDATE", 0)
    Expect("a pre-login bag update does not consume quest backfill", SpokenReadablesCharacter.questReadableBackfill, nil)
    Expect("a pre-login bag update does not mark a Questie-only readable", B:IsBookFound(209), false)
    _G.LibQuestieDB = questie
    stub.FireEvent("PLAYER_LOGIN")
    Expect("login backfill sees Questie after the early bag update", B:IsBookFound(209), true)
end

_G.C_QuestLog.GetAllCompletedQuestIDs = function() return {} end
SpokenReadablesCharacter.found = {}
SpokenReadablesCharacter.questReadableBackfill = nil
bagItems[1] = 745
SpokenReadables.readableItemCounts = nil
stub.FireEvent("BAG_UPDATE", 0)
Expect("an early bag update establishes a baseline", B:IsBookFound(209), false)
stub.FireEvent("PLAYER_LOGIN")
Expect("an item already in the bags is not mistaken for newly received notes",
    B:IsBookFound(209), false)
stub.FireEvent("BAG_UPDATE", 0)
Expect("an unchanged bag update still leaves it unfound", B:IsBookFound(209), false)
Expect("a readable item resolves to its inventory icon", B:ItemIcon(209), 123456)
bagItems[1] = nil
stub.FireEvent("BAG_UPDATE", 0)
Expect("removing the item does not mark its readable found", B:IsBookFound(209), false)
bagItems[1] = 745 -- Report: Kobolds, a text-bearing quest item in the corpus.
stub.FireEvent("BAG_UPDATE", 0)
Expect("receiving a text-bearing note adds it to the Compendium", B:IsBookFound(209), true)
Expect("receiving a note does not start narration", #Spoken:GetQueue(), 0)

local emptyBook = 990001
SpokenReadablesData.owners.item[emptyBook] = emptyBook
SpokenReadablesData.books[emptyBook] = { title = "Empty Note", pages = { emptyBook } }
SpokenReadablesData.pages[emptyBook] = { book = emptyBook, number = 1, text = "" }
bagItems[2] = emptyBook
stub.FireEvent("BAG_UPDATE", 0)
Expect("an item without note text is not added", B:IsBookFound(emptyBook), false)

-- A login with a populated bag must establish a baseline before BAG_UPDATE fires.
do
    bagItems[1], bagItems[2] = 745, nil
    SpokenReadablesCharacter.found, SpokenReadablesCharacter.read = {}, {}
    stub.FireEvent("PLAYER_LOGIN")
    stub.FireEvent("BAG_UPDATE", 0)
    Expect("a note owned at login stays unfound on the first bag event", B:IsBookFound(209), false)
    bagItems[1], bagItems[3] = nil, 745
    stub.FireEvent("BAG_UPDATE", 0)
    Expect("moving a note between slots does not discover it", B:IsBookFound(209), false)
    bagItems[4] = 745
    stub.FireEvent("BAG_UPDATE", 0)
    Expect("an additional copy of an owned note is discovered", B:IsBookFound(209), true)
    Expect("receiving a note never marks it heard", B:HasReadBook(209), false)
    Expect("receiving a note leaves the narration queue empty", #Spoken:GetQueue(), 0)
    SpokenReadablesCharacter.found = {}
    bagItems[3], bagItems[4] = nil, nil
    stub.FireEvent("BAG_UPDATE", 0)
    Expect("removing notes does not discover them", B:IsBookFound(209), false)
    bagItems[1] = 745
    stub.FireEvent("BAG_UPDATE", 0)
    Expect("a note received again after removal is discovered", B:IsBookFound(209), true)
end

-- Questie's item reverse index can include a choice reward, which completed quest history cannot
-- prove the player selected. The exact source-item index remains safe to use.
do
    local oldQuestGet = _G.LibQuestieDB.Quest.Get
    local oldItemGet = _G.LibQuestieDB.Item.Get
    _G.LibQuestieDB.Item.Get = function(itemID, field)
        if itemID == 745 and field == "questRewards" then return { 12345 } end
    end
    _G.LibQuestieDB.Quest.Get = function() return nil end
    SpokenReadablesCharacter.found = {}
    SpokenReadablesCharacter.questReadableBackfill = nil
    _G.C_QuestLog.GetAllCompletedQuestIDs = function() return { 12345 } end
    SpokenReadables:BackfillQuestReadables()
    Expect("a choice reward is not backfilled as a received readable", B:IsBookFound(209), false)
    _G.LibQuestieDB.Quest.Get = oldQuestGet
    _G.LibQuestieDB.Item.Get = oldItemGet
end

-- Synthetic corpus rows let malformed and partially populated books be checked independently.
do
    local data = SpokenReadablesData
    SpokenReadablesData = {
        owners = { item = { [1] = "note", [2] = "blank", [3] = "missing" } },
        books = { note = { pages = { 10, 11, 12, 13 } }, blank = { pages = { 10, 11, 12 } } },
        pages = { [11] = { text = "" }, [12] = { text = 123 }, [13] = { text = "Words" } },
    }
    Expect("a later text-bearing page makes an item readable", B:BookForItem(1), "note")
    Expect("missing, empty and non-string pages are not readable", B:BookForItem(2), nil)
    Expect("an owner without a book is ignored", B:BookForItem(3), nil)
    Expect("an unknown item is ignored", B:BookForItem(999), nil)
    Expect("an empty bag slot is ignored", B:BookForItem(nil), nil)
    Expect("an item owner is resolved for its book", B:ItemForBook("note"), 1)
    SpokenReadablesData = { owners = { item = { [4] = "note" } } }
    Expect("replacing the corpus invalidates the item owner cache", B:ItemForBook("note"), 4)
    SpokenReadablesData = nil
    Expect("item lookup tolerates an unavailable corpus", B:BookForItem(1), nil)
    Expect("owner lookup drops stale items when the corpus disappears", B:ItemForBook("note"), nil)
    SpokenReadablesData = data
end

do
    local instant = GetItemInfoInstant
    _G.C_Item = {
        GetItemInfoInstant = function(id) return id, "Quest", "Note", "", 654321 end,
        GetItemIconByID = function() return 111111 end,
    }
    Expect("modern instant item info supplies the icon", B:ItemIcon(209), 654321)
    C_Item.GetItemInfoInstant = function() return nil end
    Expect("an uncached instant lookup falls back to the icon API", B:ItemIcon(209), 111111)
    _G.C_Item, _G.GetItemInfoInstant = nil, nil
    _G.GetItemIcon = function(id) return id == 745 and 222222 end
    Expect("legacy clients can resolve the icon directly", B:ItemIcon(209), 222222)
    _G.GetItemIcon = nil
    Expect("missing item APIs leave the category fallback available", B:ItemIcon(209), nil)
    Expect("world objects have no item icon", B:ItemIcon(261), nil)
    _G.GetItemInfoInstant = instant
end

-- The same snapshot must work across the supported container API shapes.
do
    local slots, item = GetContainerNumSlots, GetContainerItemID
    for _, api in ipairs({ "modern ID", "legacy ID", "modern link", "legacy link" }) do
        _G.C_Container, _G.GetContainerNumSlots, _G.GetContainerItemID, _G.GetContainerItemInfo = nil, nil, nil, nil
        local numSlots = function(bag) return (bag == 0 or bag == 4) and 2 or 0 end
        local id = function(_, slot) return slot == 1 and 745 or nil end
        local link = function(_, slot) return slot == 1 and "|Hitem:745:0|h[Note]|h" or "invalid" end
        if api == "modern ID" then
            _G.C_Container = { GetContainerNumSlots = numSlots, GetContainerItemID = id }
        elseif api == "legacy ID" then
            _G.GetContainerNumSlots, _G.GetContainerItemID = numSlots, id
        elseif api == "modern link" then
            _G.C_Container = { GetContainerNumSlots = numSlots,
                GetContainerItemInfo = function(bag, slot) return { hyperlink = link(bag, slot) } end }
        else
            _G.GetContainerNumSlots = numSlots
            _G.GetContainerItemInfo = function(bag, slot) return nil, nil, nil, nil, nil, nil, link(bag, slot) end
        end
        local snapshot = B:ReadableItemSnapshot()
        Expect(api .. " counts readable slots across backpack and last bag", snapshot[745], 2)
        snapshot[745] = nil
        Expect(api .. " ignores empty or invalid slots", next(snapshot), nil)
    end
    _G.C_Container, _G.GetContainerItemInfo = nil, nil
    _G.GetContainerNumSlots, _G.GetContainerItemID = slots, item
end

do
    _G.C_Container = {
        GetContainerNumSlots = function(bag) return bag == 0 and 1 or 0 end,
        GetContainerItemID = function() return 745 end,
        GetContainerItemInfo = function() return { stackCount = 3 } end,
    }
    local snapshot = B:ReadableItemSnapshot()
    Expect("a readable stack counts every item received", snapshot[745], 3)
    SpokenReadablesCharacter.found = {}
    SpokenReadables.readableItemCounts = { [745] = 1 }
    B:OnBagUpdate()
    Expect("receipt into an existing stack is discovered", B:IsBookFound(209), true)

    local stack = { [1] = 1, [2] = 1 }
    _G.C_Container.GetContainerNumSlots = function(bag) return bag == 0 and 2 or 0 end
    _G.C_Container.GetContainerItemID = function(_, slot) return stack[slot] and 745 end
    _G.C_Container.GetContainerItemInfo = function(_, slot) return { stackCount = stack[slot] } end
    SpokenReadablesCharacter.found = {}
    SpokenReadables.readableItemCounts = { [745] = 2 }
    B:OnBagUpdate()
    Expect("splitting a stack without changing its quantity is not discovered", B:IsBookFound(209), false)
    _G.C_Container = nil
end

do
    local places, questie, lib, quests = SpokenReadablesPlaces, QuestieDB, LibQuestieDB, C_QuestLog
    _G.QuestieDB, _G.LibQuestieDB = nil, nil
    _G.C_QuestLog = { GetAllCompletedQuestIDs = function() return nil end }
    _G.SpokenReadablesPlaces = { books = {
        [209] = { quests = { 10, 20 } }, [261] = { quests = { 30 } },
        [emptyBook] = { quests = { 20 } },
    } }
    SpokenReadablesCharacter.found, SpokenReadablesCharacter.questReadableBackfill = {}, nil
    B:BackfillQuestReadables()
    Expect("missing quest history leaves backfill retryable", SpokenReadablesCharacter.questReadableBackfill, nil)
    _G.C_QuestLog.GetAllCompletedQuestIDs = function() return { 20 } end
    stub.FireEvent("BAG_UPDATE", 0)
    Expect("a later bag event retries completed quest history", B:IsBookFound(209), true)
    Expect("a retried backfill ignores an empty direct reward", B:IsBookFound(emptyBook), false)
    _G.C_QuestLog = nil
    _G.GetQuestsCompleted = function() return { [20] = true, [30] = false } end
    SpokenReadablesCharacter.found, SpokenReadablesCharacter.questReadableBackfill = {}, nil
    B:BackfillQuestReadables()
    Expect("legacy completed quest history discovers a direct reward", B:IsBookFound(209), true)
    Expect("legacy backfill ignores an empty direct reward", B:IsBookFound(emptyBook), false)
    Expect("an incomplete quest does not discover its reward", B:IsBookFound(261), false)
    Expect("backfill does not mark its reward heard", B:HasReadBook(209), false)
    SpokenReadablesCharacter.found = {}
    B:BackfillQuestReadables()
    Expect("completed backfill does not run again", next(SpokenReadablesCharacter.found), nil)
    SpokenReadablesCharacter.questReadableBackfill = 1
    B:BackfillQuestReadables()
    Expect("an older backfill version is rescanned", B:IsBookFound(209), true)
    _G.GetQuestsCompleted = nil
    _G.C_QuestLog = { GetAllCompletedQuestIDs = function() return { 40, 50, 51 } end }
    _G.SpokenReadablesPlaces = nil
    _G.QuestieDB = {
        QueryItemSingle = function(id, field)
            assert(field == "questRewards")
            return id == 745 and { 99, 40 } or nil
        end,
        QueryQuestSingle = function(id, field)
            assert(field == "sourceItemId")
            return id == 50 and 745 or id == 51 and emptyBook or nil
        end,
    }
    SpokenReadablesCharacter.found, SpokenReadablesCharacter.questReadableBackfill = {}, nil
    B:BackfillQuestReadables()
    Expect("Questie reward metadata works without generated places", B:IsBookFound(209), true)
    Expect("Questie backfill ignores an empty source item", B:IsBookFound(emptyBook), false)
    QuestieDB.QueryItemSingle = nil
    SpokenReadablesCharacter.found, SpokenReadablesCharacter.questReadableBackfill = {}, nil
    B:BackfillQuestReadables()
    Expect("Questie source items work without reward metadata", B:IsBookFound(209), true)
    Expect("quest backfill never queues narration", #Spoken:GetQueue(), 0)
    _G.SpokenReadablesPlaces, _G.QuestieDB, _G.LibQuestieDB, _G.C_QuestLog = places, questie, lib, quests
end

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

--- Pages to be read: the book's page in the queue and those to follow it (Read Book as One Line).
local function Queued()
    local count = 0
    for _, clip in ipairs(Spoken:GetQueue()) do
        if clip.pageId then count = count + 1 end
    end
    for _, entry in pairs(B.following or {}) do count = count + #entry.pages end
    return count
end

local function Reset()
    B:StopReading()
    stub.Advance(1)
    if B.lastPage then stub.ClosePage(); stub.FireEvent("ITEM_TEXT_CLOSED") end
    closed = 0
end

---------------------------------------------------------------- off, as it ships
Expect("off by default", SpokenReadablesSettings.closeWhenRead, false)
OpenLetter()
Expect("a letter is read", Queued(), 1)
stub.Advance(4)
Expect("...and with the setting off it stays open once heard", closed, 0)
Expect("...still on screen", B.lastPage, 15)
Reset()

---------------------------------------------------------------- on
SpokenReadablesSettings.closeWhenRead = true
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

SpokenReadablesSettings.readWholeBook = false
OpenRegistry()
Expect("with Read Whole Book off, only page 1 is queued", Queued(), 1)
stub.Advance(4)
Expect("...and hearing it leaves the book open to turn", closed, 0)
SpokenReadablesSettings.readWholeBook = true
Reset()

-- Its last page silent: nothing is left to hear once page 2 has been read.
local voiced = SpokenReadablesAudioPacks.SpokenReadablesAudio.pages[265]
SpokenReadablesAudioPacks.SpokenReadablesAudio.pages[265] = nil
OpenRegistry()
Expect("a book whose last page is silent queues the rest", Queued(), 2)
stub.Advance(6)
Expect("...and closes once its last voiced page has been heard", closed, 1)
SpokenReadablesAudioPacks.SpokenReadablesAudio.pages[265] = voiced
Reset()

---------------------------------------------------------------- the command
SlashCmdList["SPOKENREADABLES"]("close")
Expect("/spw close toggles it", SpokenReadablesSettings.closeWhenRead, false)
SlashCmdList["SPOKENREADABLES"]("close")
Expect("...and back", SpokenReadablesSettings.closeWhenRead, true)

print(Failures() == 0 and "All readables close tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
