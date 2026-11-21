-- Which page the addon thinks is on screen, against the real generated lookup and the real
-- pages from the corpus. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local READABLES = here .. "/../../addons/Spoken_Readables/"
local Expect, Failures = H.Expecter(print)

local function LoadReadables()
    local SpokenReadables = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Opener", "Reader", "Audio" }) do
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

-- Two real pages of one real book: the Hillsbrad Town Registry, whose first page names the
-- town and whose second lists its debts.
local REGISTRY_1 = "Hillsbrad Town Registry\n\nWe the people of Hillsbrad do solemny swear our faith and devotion to the Alliance maintained by the great monarchs, King Magni Bronzebeard of Ironforge and King Anduin Wrynn of Stormwind.\n\nHerein lies the town registry for purposes of governing this fair city in the foothills of the great Alterac Mountains as well as serving as a record of those who have paid their taxes to their Kings and to the great almighty Alliance."

---------------------------------------------------------------- the normal path
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
Expect("a page is found by title, number and checksum", B:PageOnScreen(), 261)
Expect("...as the corpus's own text", select(2, B:PageOnScreen()), true)

local book, number = B:PlaceOf(261)
Expect("...and knows which book it is in", book, 261)
Expect("...and where", number, 1)
Expect("...and what the book is called", B:BookOf(261).title, "Hillsbrad Town Registry")

---------------------------------------------------------------- mail is not a book
stub.ShowPage({ title = "A letter", number = 1, text = REGISTRY_1, creator = "Somebody" })
Expect("a letter with a creator is not read", B:PageOnScreen(), nil)
local savedPageText = B.pageText
B.pageText = nil
Expect("mail is never captured for captions", B:PageOnScreen(), nil)
Expect("...even if its words match a book", B.pageText, nil)
B.pageText = savedPageText

stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1 })
_G.MailFrame = { IsShown = function() return true end }
Expect("a page under an open MailFrame is not read", B:PageOnScreen(), nil)
_G.MailFrame = { IsShown = function() return false end }
Expect("...and is read again once the mail is closed", B:PageOnScreen(), 261)
_G.MailFrame = nil

---------------------------------------------------------------- the title fallback
stub.ShowPage({ title = "Registre de la ville", number = 1, text = REGISTRY_1 })
Expect("a title the corpus does not know still finds the page by checksum", B:PageOnScreen(), 261)

---------------------------------------------------------------- refusing to guess
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = "Words nobody wrote." })
Expect("text the corpus does not have is nil rather than a guess", B:PageOnScreen(), nil)

stub.ShowPage({ title = "Hillsbrad Town Registry", number = 9, text = REGISTRY_1 })
Expect("the wrong page number still matches, through the checksum", B:PageOnScreen(), 261)

stub.ClosePage()
Expect("a closed frame is not a page", B:PageOnScreen(), nil)

world.itemText = ""
Expect("an empty page is not a page", B:PageOnScreen(), nil)

---------------------------------------------------------------- the ambiguous ones
-- "Pteradon Skeleton" is two books holding identical text. Nothing on screen tells them
-- apart, so the lookup collapses them and the page must resolve to the lower of the two
-- rather than to nothing.
local PTERADON = "This intact pteradon skeleton was recovered from the remote Un'Goro Crater. Based on the skeletal structure, it is clear that this specific genus has not yet been encountered. This skeleton could have been preserved for any number of centuries beneath the region's rich soil."
stub.ShowPage({ title = "Pteradon Skeleton", number = 1, text = PTERADON })
Expect("two books with the same words resolve to the lower", B:PageOnScreen(), 1756)

---------------------------------------------------------------- the same page, laid out or worded differently
-- A server that breaks the lines elsewhere, or rewords a sentence, misses every checksum.
local REGISTRY_RELAID = string.gsub(REGISTRY_1, "\n\n", " ")
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_RELAID, hasNext = true })
Expect("a page laid out differently is found by its title, number and words", B:PageOnScreen(), 261)

local REGISTRY_REWORDED = string.gsub(REGISTRY_1, "solemny swear our faith and devotion", "solemnly pledge our loyalty")
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_REWORDED, hasNext = true })
Expect("...and one with a sentence reworded", B:PageOnScreen(), 261)

Expect("...which is not the corpus's own text", select(2, B:PageOnScreen()), false)

-- Forever's chain ends the Registry early, so its last page offers no next page.
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_RELAID, hasNext = false })
Expect("all but the same words are the page where the screen ends a book the corpus goes on with", B:PageOnScreen(), 261)

local REGISTRY_REWRITTEN = string.gsub(REGISTRY_REWORDED, "for purposes of governing this fair city in the foothills", "kept to run this town below")
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_REWRITTEN, hasNext = true })
Expect("most of the words are the page", B:PageOnScreen(), 261)
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_REWRITTEN, hasNext = false })
Expect("...but not where the screen ends a book the corpus goes on with", B:PageOnScreen(), nil)

-- Forever's Sargeras and the Betrayal has no 1774, so its second page is the corpus's third.
local SARGERAS_3 = string.gsub(B:Data().pages[1775].text, "%. ", ".\n")
stub.ShowPage({ title = "Sargeras and the Betrayal", number = 2, text = SARGERAS_3, hasNext = true })
Expect("a page a place early is found at the number after", B:PageOnScreen(), 1775)

stub.ShowPage({ title = "Proof of Deed", number = 1, text = "This proof of deed is to verify that Torno slew Onyxia, the Black Dragonflight's broodmother." })
Expect("a book of the same name with other words is not the corpus's", B:PageOnScreen(), nil)

---------------------------------------------------------------- what opened the frame
-- The Registry is item 3657. An item names its book whatever the words on screen say.
B:NoteOpener("item", 3657)
B:OnTextBegin()
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 2, text = "Words the corpus never had.", hasNext = true })
Expect("the item that opened the frame names the page at this number", B:PageOnScreen(), 262)
stub.ShowPage({ title = "Registre de Hautebrande", number = 3, text = "Des mots en français.", hasNext = true })
Expect("...under a title the corpus does not know", B:PageOnScreen(), 263)
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 9, text = "Words the corpus never had." })
Expect("...but not past the end of its book", B:PageOnScreen(), nil)
stub.ShowPage({ title = "Proof of Deed", number = 1, text = "Words the corpus never had." })
Expect("...nor under another corpus book's title: that item was not what was clicked", B:PageOnScreen(), nil)
B:OnOpenerClosed()
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 2, text = "Words the corpus never had.", hasNext = true })
Expect("closing the frame forgets what opened it", B:PageOnScreen(), nil)

-- Object 175724 is Sargeras and the Betrayal, whose page 2 Forever shows the corpus's page 3 as.
B:NoteOpener("object", 175724)
B:OnTextBegin()
stub.ShowPage({ title = "Sargeras and the Betrayal", number = 2, text = SARGERAS_3, hasNext = true })
Expect("an opener's page with other words gives way to the page of its book that has them", B:PageOnScreen(), 1775)
Expect("...which is not the corpus's own text", select(2, B:PageOnScreen()), false)
stub.ShowPage({ title = "Sargeras et la Trahison", number = 2, text = "Des mots en français.", hasNext = true })
Expect("...while words in another language keep the number", B:PageOnScreen(), 1774)
B:OnOpenerClosed()

world.time = 100
B:NoteOpener("item", 3657)
world.time = 111
B:OnTextBegin()
Expect("a use older than ten seconds is not what opened the frame", #B.openedBy, 0)

world.time = 200
B:NoteSoftInteract("GameObject-0-4170-0-6-175685-00002A5B1C")
B:NoteOpener("item", 3657)
world.time = 201
B:NoteOpener("object", B:ObjectEntryOf("GameObject-0-4170-0-6-175685-00002A5B1C"))
world.time = 202
B:OnTextBegin()
Expect("the most recent use comes first", B.openedBy[1].kind, "object")
Expect("...then the older one", B.openedBy[2].kind, "item")
Expect("...then the interact key's target, however old", B.openedBy[3].id, 175685)
Expect("an object's entry is read from its GUID", B:ObjectEntryOf("GameObject-0-4170-0-6-175685-00002A5B1C"), 175685)
Expect("...and a creature's is not an object's", B:ObjectEntryOf("Creature-0-4170-0-6-3657-00002A5B1C"), nil)
B:NoteSoftInteract(nil)
B:OnOpenerClosed()
world.time = 0

---------------------------------------------------------------- pages the client fills in
-- The client writes the reader's name, class and gender word into a page, while the index is
-- keyed on the page with its tokens. These are found by the words around what was filled in.
local PROOF = "This proof of deed is to verify that %s slew Margol the Rager, scourge of the searing gorge.\n\nThe Ironforge museum recognizes this achievement and thanks the bearer for their generous contribution.\n\n-Head Curator Thorius Stonetender"
stub.ShowPage({ title = "Proof of Deed", number = 1, text = string.format(PROOF, "Torno") })
Expect("a page with the reader's name in it is found", B:PageOnScreen(), 1231)
stub.ShowPage({ title = "Proof of Deed", number = 1, text = string.format(PROOF, "Valaas Dawnsight") })
Expect("...whatever the name", B:PageOnScreen(), 1231)
stub.ShowPage({ title = "Proof of Deed", number = 1, text = "This proof of deed is to verify that Torno slew Hogger." })
Expect("...but other words around a name are still nil", B:PageOnScreen(), nil)

local TABLET = "Greetings, %s. The Shattered Hand sends its regards and hopes you find the Valley a comfortable place to apply your trade. This is a time of testing for you, so do not think you are not being watched constantly.\n\nIt is my duty to appraise the Hand of your skills, and to then inform them when I feel you are ready to move on to greater challenges.\n\nWhen you are ready, come find me deep inside the Den. I'll be waiting for you there.\n\n-Rwag, Rogue Trainer "
stub.ShowPage({ title = "Encrypted Tablet", number = 1, text = string.format(TABLET, "brother") })
Expect("a page with the gender word for a man is found", B:PageOnScreen(), 2438)
stub.ShowPage({ title = "Encrypted Tablet", number = 1, text = string.format(TABLET, "sister") })
Expect("...and for a woman", B:PageOnScreen(), 2438)

local NOTE = "Many tribes claim that it is a gift to be blessed with the aptitude to use magic or to talk to our ancestors, but you should know this as well, Warrior, you are just as gifted. Some do not have the strength in their arms to wield mighty weapons. Some do not have the skill to parry a blow from an assassin, or to even suffer the physical punishments from an arcane spellcaster, but you do. You are strong. And I will help you become stronger. Find me in Camp Narache.\n\n-Harutt Thunderhorn, Warrior Trainer"
stub.ShowPage({ title = "Simple Note", number = 1, text = NOTE })
Expect("a class letter with the reader's class in it is found", B:PageOnScreen(), 2441)

world.playerName, world.playerClass, world.playerRace, world.unitSex = "Torno", "Warrior", "Orc", 3
Expect("a caption filled in for this character, as the page shows it",
    B:FillPlayerTokens("Greetings, $gbrother:sister;. Tell me, $c, have you met $N the $r?"),
    "Greetings, sister. Tell me, Warrior, have you met Torno the Orc?")
Expect("a caption as the narrator says it: the first side, adventurer, traveler, capitalised at a sentence's start",
    B:SaidTokens("$N, Before I go. Greetings, $g brother : sister;. Tell me, $c, have you met the $r? $N!"),
    "Adventurer, Before I go. Greetings, brother. Tell me, adventurer, have you met the traveler? Adventurer!")
world.playerName, world.playerClass, world.playerRace, world.unitSex = nil, nil, nil, 2

print(Failures() == 0 and "All readables reader tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
