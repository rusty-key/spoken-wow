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

local env, quests, zones = H.Fresh(stub, SPOKEN)
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
Expect("the other parts carry on", zones:Enqueue(H.Clip()) ~= nil, true)
Expect("the choice is kept in the settings", env.Addon.db.profile.Parts.quests, false)
S:SetTurnedOff("quests", false)
Expect("switched back on, it plays again", quests:Enqueue(H.Clip()) ~= nil, true)
Expect("...and nothing is left in the settings", env.Addon.db.profile.Parts.quests, nil)
Q:RemoveAllSoundsFromQueue()

-- A feature addon may build its settings page before Spoken's own entry exists. The page
-- waits, then is nested under it in its order rather than in the order the addons loaded.
stub.settingsCategories = {}
local zonesPage = _G.Spoken:AddSettingsPage(CreateFrame("Frame"), "Places", 3)
local questsPage = _G.Spoken:AddSettingsPage(CreateFrame("Frame"), "Quests", 1)
Expect("a page asked for before Spoken's own entry waits for it", questsPage.category, nil)

-- The panel offers all three parts, saying which are missing rather than leaving them out.
-- Quests found no voice pack, as the real addon reports it when none is installed.
quests.packs = function() return {} end
env.Addon:Enable()
local function Listed()
    local names = {}
    for _, category in ipairs(stub.settingsCategories) do
        table.insert(names, (category.parent and (category.parent.name .. ">") or "") .. category.name)
    end
    return table.concat(names, "|")
end
Expect("...then is nested under it, in its own order", Listed(), "Spoken|Spoken>Quests|Spoken>Places")
local readables = _G.Spoken:AddSettingsPage(CreateFrame("Frame"), "Writings", 2)
Expect("a page asked for afterwards is nested at once", readables.category and readables.category.parent.name, "Spoken")
Expect("opening a page opens its own entry", readables.Open(), true)
local labels = {}
for _, text in ipairs(stub.LabelsUnder(_G.SpokenOptionsPanel)) do labels[text] = true end
Expect("the parts have a section of their own", labels["Modules"], true)
Expect("an installed part is named for what it reads", labels["Quests"], true)
Expect("...and so is the other: Zones is Places", labels["Places"], true)
Expect("a part not installed still has its card: Books is Writings", labels["Writings"], true)
local readablesCard
for _, child in ipairs(_G.SpokenOptionsPanel.content.children) do
    if child.layoutCard and child.layoutCard.title == "Writings" then readablesCard = child end
end
Expect("...which says why it cannot be turned on", readablesCard and readablesCard.layoutReason, env.L.REASON_NOT_INSTALLED)
-- Installed here, with no voice pack found: the card says what is missing.
Expect("an installed part says how many of its voice packs it has", labels[env.L.PART_VOICE], true)
-- A part switched off is off everywhere: its entries leave the minimap menu, and it is told,
-- so it can take its buttons off the game's frames.
env.Minimap:AddEntry("zones", { id = "lore", text = "Lore" })
local told
_G.Spoken:RegisterCallback("PART_SWITCHED", function(key, on) told = key .. ":" .. tostring(on) end)
local function InMenu(id)
    for _, entry in ipairs(env.Minimap:BuildMenu()) do if entry.id == id then return true end end
    return false
end
Expect("a part's entry is in the minimap menu while it is on", InMenu("lore"), true)
_G.Spoken:SetPartOn("zones", false)
Expect("...and gone once it is switched off", InMenu("lore"), false)
Expect("...the part told it was switched off", told, "zones:false")
_G.Spoken:SetPartOn("zones", true)
Expect("...and back, and told, when it is on again", InMenu("lore") and told, "zones:true")
-- Quests says how many packs it found (none, here); off, its card still says so.
_G.Spoken:SetPartOn("quests", false); env.Options:UpdateRows()
Expect("...while still saying whether it has its voices", env.Options:PartVoice("quests"), "muted")
_G.Spoken:SetPartOn("quests", true); env.Options:UpdateRows()
Expect("nothing went wrong in a callback", #env.Callbacks.errors, 0)

os.exit(Failures() == 0 and 0 or 1)
