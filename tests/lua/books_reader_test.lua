-- Which page the addon thinks is on screen, against the real generated lookup and the real
-- pages from the corpus. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local BOOKS = here .. "/../../addons/Spoken_Readables/"
local Expect, Failures = H.Expecter(print)

local function LoadBooks()
    local SpokenBooks = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio" }) do
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
dofile(BOOKS .. "Data/Variants.lua")

-- Two real pages of one real book: the Hillsbrad Town Registry, whose first page names the
-- town and whose second lists its debts.
local REGISTRY_1 = "Hillsbrad Town Registry\n\nWe the people of Hillsbrad do solemny swear our faith and devotion to the Alliance maintained by the great monarchs, King Magni Bronzebeard of Ironforge and King Anduin Wrynn of Stormwind.\n\nHerein lies the town registry for purposes of governing this fair city in the foothills of the great Alterac Mountains as well as serving as a record of those who have paid their taxes to their Kings and to the great almighty Alliance."

---------------------------------------------------------------- the normal path
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
Expect("a page is found by title, number and checksum", B:PageOnScreen(), 261)

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

---------------------------------------------------------------- the same words, laid out differently
-- Pages as the Forever server's page_text holds them, which lays some out differently from the
-- text the index was keyed on: two spaces after a full stop, $B where the corpus has a space.
local THURMAN_2 = "I fear my father made a grave error when he decided to remain and defend our home.  The forces of the Scourge rage through Tirisfal Glades, and although we are well fortified and well stocked, after the betrayal of my brother Devlin we lack the strength and numbers to withstand their continued assault. If you receive this letter, Yvette, then know that Devlin is a traitor. "
stub.ShowPage({ title = "Thurman's Letter", number = 2, text = THURMAN_2 })
Expect("a page whose spacing differs is found by its words", B:PageOnScreen(), 252)

local TROLL_LEGEND_1 = "Rising from the ocean, a tower of water, Neptulon sent the great Krakken to doomed I'lalai. So huge were their forms that jungles of kelp swayed through their limbs, and leviathans swam through bodies.$B$BThe largest Krakken then raised his arms high and crashed them into the sea, sending waves about him. And they raged toward I'lalai."
stub.ShowPage({ title = "The Third Troll Legend", number = 1, text = TROLL_LEGEND_1 })
Expect("...and one whose line breaks differ", B:PageOnScreen(), 324)

stub.ShowPage({ title = "Some other name", number = 5, text = TROLL_LEGEND_1 })
Expect("...also under a title the corpus does not know, when no other page has the words", B:PageOnScreen(), 324)

-- The server numbers these pages 712 and 2697; the corpus has the same words as 791 and 2711.
local NEEKA_2 = "I will describe the surrounding lands as the scouts of Kargath have surveyed:$B$B-Red, rocky hills and dry flats that offer little support for life.$B-A blazing sun and severe winds.$B-No lakes or streams. Not even scattered pools. To find water denizens must dig deep, muddy wells, or suck scant moisture from the rare cactus or spiny weed.$B$BIn short: hot, hard living."
stub.ShowPage({ title = "Neeka's Report", number = 2, text = NEEKA_2 })
Expect("a page the server keeps under another id is found by its words", B:PageOnScreen(), 791)

local MORZUL_7 = "Completing the Ritual$B$BYou can track your progress by the magic runes along the border of the circle. When nine runes appear then the ritual is complete, and you will see energy rise from the newly empowered Circle.$B$BFrom there, you may invoke the Xorothian Glyphs and open a portal into Xoroth and pull a dreadsteed through it.$B$BDefeat the dreadsteed and release his spirit. Confront the spirit and it will be enthralled, and you will be rewarded with the secret of its summoning."
stub.ShowPage({ title = "Mor'zul's Instructions", number = 7, text = MORZUL_7 })
Expect("...on the last page of a book too", B:PageOnScreen(), 2711)

-- The server's page 2304 holds Lady Mara Fordragon's plaque, not the White Stag's fourth page.
local LADY_MARA = "Lady Mara Fordragon High Clerist of Stormwind Patron of the Refugees who fled to Lordaeron after the First War. She was the bright mother of our future. May she rest in the Light. "
stub.ShowPage({ title = "The White Stag and the Moon", number = 4, text = LADY_MARA })
Expect("words that are another readable's are found as that readable's page", B:PageOnScreen(), 2294)

local PICTURE = "<HTML>\n<BODY>\n<IMG src=\"Interface\\Pictures\\11733_blackrock_256\"/>\n</BODY>\n</HTML>\n"
stub.ShowPage({ title = "Book", number = 1, text = PICTURE })
Expect("a picture page has no words to find it by", B:PageOnScreen(), nil)

stub.ShowPage({ title = "Thurman's Letter", number = 2, text = "Words  nobody\nwrote." })
Expect("words the corpus does not have are still nil", B:PageOnScreen(), nil)

---------------------------------------------------------------- the same page in other words
-- Pages as the Forever server words them (Data/Variants.lua): a spelling the server corrects,
-- a page it keeps under another id, a page rewritten after Classic. Each plays its corpus page.
local MORGAN_3 = "someday be reunited with his wife and children.\n\nMorgan would eventually return to his homeland, but find it nothing like how he remembered it. The once verdant forest was corrupted and teemed with the undead and other dark forces. Destroyed houses and farms could be found everywhere, and the cemetery near Raven Hill now dominated much of the area. A shocked and bewildered Morgan eventually made his way to his home, only to find it in ruins. Not knowing what had befallen his homeland, he"
stub.ShowPage({ title = "The Story of Morgan Ladimore", number = 3, text = MORGAN_3 })
Expect("a page the server spells differently is found as its corpus page", B:PageOnScreen(), 66)

local NEEKA_3 = "The Badlands are filled with enemies. Ogres roam the blistering sands, ambushing the unwary. Darkiron dwarves inhabit a barracks east of Kargath and battle their lighter-skinned cousins in Loch Modan to the north. Brutal, primitive beasts called Troggs haunt any scrap of shade they find and defend it savagely.$B$BAnd in eastern Badlands in the Lethlor Ravine there are dragons. We don't know how many and we don't know how big, since scouts who get too close never return."
stub.ShowPage({ title = "Neeka's Report", number = 3, text = NEEKA_3 })
Expect("...and one it keeps under another id, as the page at its place in the book", B:PageOnScreen(), 792)

-- The server's chain skips page 1774, so this is its second page.
local SARGERAS_3 = "Although Sargeras' nearly limitless powers made short work of the shambling demons he found throughout the Great Dark, he was greatly troubled by the creatures' corruption and all-consuming evil. Incapable of fathoming such depravity, the great Titan began to slip into a brooding depression. Despite his growing unease, Sargeras rid the universe of demonic entities by trapping them within a corner of the Twisting Nether."
stub.ShowPage({ title = "Sargeras and the Betrayal", number = 2, text = SARGERAS_3 })
Expect("...and one rewritten, under whichever number the server gives it", B:PageOnScreen(), 1775)

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

print(Failures() == 0 and "All books reader tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
