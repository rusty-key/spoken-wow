-- Parts of Spoken switched on and off from the player's settings (Sources:SetTurnedOff). Run
-- with `make test-player`.
--
-- The player's own switch, not the client's addon list, which current clients refuse to
-- addons: a part switched off stays loaded, and nothing it sends is played.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

-- Pages under Spoken held until the world is entered, as in the game (see below).
stub.holdPages = true
local env, quests, places = H.Fresh(stub, SPOKEN)
local Q, S = env.SoundQueue, env.Sources

quests:Enqueue(H.Clip({ length = 5 }))
Expect("a part is on until it is switched off", Q:GetQueueSize(), 1)
S:SetTurnedOff("quests", true)
Expect("switching a part off silences what it already queued", Q:GetQueueSize(), 0)
local added, reason = quests:Enqueue(H.Clip())
Expect("...and refuses its new lines", added, nil)
Expect("...saying why", reason, env.L.PART_TURNED_OFF)
local played, why = quests:PlayNow(H.Clip())
Expect("a line played by hand is refused too", played, false)
Expect("...with the reason, for the addon to show", why, env.L.PART_TURNED_OFF)
Expect("the other parts carry on", places:Enqueue(H.Clip()) ~= nil, true)
Expect("the choice is kept in the settings", env.Addon.db.profile.Parts.quests, false)
S:SetTurnedOff("quests", false)
Expect("switched back on, it plays again", quests:Enqueue(H.Clip()) ~= nil, true)
Expect("...and nothing is left in the settings", env.Addon.db.profile.Parts.quests, nil)
Q:RemoveAllSoundsFromQueue()

-- A feature addon may build its settings page before Spoken's own entry exists, or after it,
-- on entering the world. The game lists them in the order they were registered, so each page
-- waits until just after the world is entered, then all are nested in their order rather than
-- in the order the addons asked.
stub.settingsCategories = {}
local placesPage = _G.Spoken:AddSettingsPage(CreateFrame("Frame"), "Places", 3)
local questsPage = _G.Spoken:AddSettingsPage(CreateFrame("Frame"), "Quests", 1)
Expect("a page asked for before Spoken's own entry waits for it", questsPage.category, nil)

-- The panel offers all three parts, saying which are missing rather than leaving them out.
-- Quests found no voice pack, as the real addon reports it when none is installed.
quests.packs = function() return {} end
env.Addon:Enable()
local gossipPage = _G.Spoken:AddSettingsPage(CreateFrame("Frame"), "Gossip", 2)
Expect("...and one asked for after it, until the world is entered", gossipPage.category, nil)
stub.FireEvent("PLAYER_ENTERING_WORLD")
stub.Advance(0.1)
local function Listed()
    local names = {}
    for _, category in ipairs(stub.settingsCategories) do
        table.insert(names, (category.parent and (category.parent.name .. ">") or "") .. category.name)
    end
    return table.concat(names, "|")
end
Expect("...then is nested under it, in its own order", Listed(), "Spoken|Spoken>Quests|Spoken>Gossip|Spoken>Places|Spoken>Contribute & Report")
local readables = _G.Spoken:AddSettingsPage(CreateFrame("Frame"), "Readables", 2)
Expect("a page asked for afterwards is nested at once", readables.category and readables.category.parent.name, "Spoken")
Expect("opening a page opens its own entry", readables.Open(), true)
local labels = {}
for _, text in ipairs(stub.LabelsUnder(_G.SpokenOptionsPanel)) do labels[text] = true end
Expect("the parts have a section of their own", labels["What Spoken Reads"], true)
Expect("an installed part is named for what it reads", labels["Quests"], true)
Expect("...and so is the other", labels["Places"], true)
Expect("a part not installed still has its row", labels["Readables"], true)
local readablesCard
local cards = {}
for _, child in ipairs(_G.SpokenOptionsPanel.content.children) do
    for _, row in ipairs(child.layoutRows or {}) do
        if row.layoutCard and row.layoutCard.title == "Readables" then readablesCard = row end
        if row.layoutCard then table.insert(cards, row.layoutCard.title) end
    end
end
Expect("the modules are listed Quests, Gossip, Places, Readables", table.concat(cards, ", "), "Quests, Gossip, Places, Readables")
Expect("...which says why it cannot be turned on", readablesCard and readablesCard.layoutReason, env.L.REASON_NOT_INSTALLED)
-- The modules register on entering the world, after the page is built: the row is drawn again
-- at once, not left saying "Not installed" until something else redraws it.
local lateReadables = _G.Spoken:RegisterSource("readables", { title = "Spoken Readables", order = 4 })
Expect("a module registering after the page is built is installed on its row at once",
    readablesCard and readablesCard.layoutReason, nil)
env.Sources.byKey.readables = nil
for i, source in ipairs(env.Sources.ordered) do
    if source == lateReadables then table.remove(env.Sources.ordered, i) break end
end
env.Options:UpdateRows()
-- Installed here, with no voice pack found: the row says what is missing.
Expect("an installed part says how many of its voice packs it has", labels[env.L.PART_VOICE], true)
Expect("...as a number, not out of how many there are", select(3, env.Options:PartVoice("quests")), "0")
-- A part switched off is off everywhere: its entries leave the minimap menu, and it is told,
-- so it can take its buttons off the game's frames.
env.Minimap:AddEntry("places", { id = "lore", text = "Lore" })
local told
_G.Spoken:RegisterCallback("PART_SWITCHED", function(key, on) told = key .. ":" .. tostring(on) end)
local function InMenu(id)
    for _, entry in ipairs(env.Minimap:BuildMenu()) do if entry.id == id then return true end end
    return false
end
Expect("a part's entry is in the minimap menu while it is on", InMenu("lore"), true)
_G.Spoken:SetPartOn("places", false)
Expect("...and gone once it is switched off", InMenu("lore"), false)
Expect("...the part told it was switched off", told, "places:false")
_G.Spoken:SetPartOn("places", true)
Expect("...and back, and told, when it is on again", InMenu("lore") and told, "places:true")
-- Quests says how many packs it found (none, here); off, its card still says so.
_G.Spoken:SetPartOn("quests", false); env.Options:UpdateRows()
Expect("...while still saying whether it has its voices", env.Options:PartVoice("quests"), "muted")
_G.Spoken:SetPartOn("quests", true); env.Options:UpdateRows()
Expect("nothing went wrong in a callback", #env.Callbacks.errors, 0)

-- Another source that registers is listed too, with its own title, line and place in the order;
-- the page and the Welcome window draw whatever Parts() lists when they are built.
local bosses = _G.Spoken:RegisterSource("bosses", { title = "Bosses", about = "What a boss says.", order = 2.5 })
local keys = {}
for _, part in ipairs(env.Options:Parts()) do table.insert(keys, part.key) end
Expect("a registered source is listed among the parts, in its order", table.concat(keys, ","),
    "quests,gossip,bosses,places,readables")
Expect("...with the line it gave", env.Options:Parts()[3].text, "What a boss says.")
Expect("...and it can be switched off like the others", _G.Spoken:IsPartOn("bosses"), true)
Expect("a part with no page of its own has no button to one", env.Options:HasPage(2.5), false)
Expect("...where a part with a page has", env.Options:HasPage(1), true)
env.Sources.byKey.bosses = nil
for i, source in ipairs(env.Sources.ordered) do
    if source == bosses then table.remove(env.Sources.ordered, i) break end
end

---------------------------------------------------------------- the renamed parts
-- Places and Readables were keyed zones and books, and their settings tables Zones and Writings:
-- in any profile, what was saved under an old name is under the new one, and the old name goes.
do
    local saved = env.Addon.db
    env.Addon.db = nil
    _G.SpokenSettings = { profiles = {
        Default = { Parts = { zones = false, books = false }, Modules = { Zones = { language = "deDE" }, Writings = {} } },
        Other = { Parts = { zones = false, places = true } },
    }, global = { ModulesLegacy = { Writings = { autoplay = false } } } }
    env.Addon:InitDB()
    local default = _G.SpokenSettings.profiles.Default.Parts
    Expect("a part switched off as zones is off as places", default.places, false)
    Expect("...and as books, off as readables", default.readables, false)
    Expect("...with the old keys gone", default.zones == nil and default.books == nil, true)
    local other = _G.SpokenSettings.profiles.Other.Parts
    Expect("a choice already made under the new key wins", other.places == true and other.zones == nil, true)
    local modules = _G.SpokenSettings.profiles.Default.Modules
    Expect("the Zones settings table is the Places one", modules.Places and modules.Places.language, "deDE")
    Expect("...and Writings the Readables one", modules.Readables ~= nil and modules.Zones == nil and modules.Writings == nil, true)
    Expect("...in the copy kept from before profiles too", _G.SpokenSettings.global.ModulesLegacy.Readables.autoplay, false)
    env.Addon.db = saved
end

os.exit(Failures() == 0 and 0 or 1)
