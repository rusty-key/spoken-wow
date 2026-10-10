-- The player's UI, as far as it can be seen without a client: the frame loads on a
-- current client and on 1.12, shows and hides with the queue, names the head and lists
-- the rows with their held reason, picks a portrait renderer and falls back, lays out the
-- actions a clip brings, owns the one minimap button, and registers its settings.
-- Run with `make test-player`. Layout and pixels are checked in game.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local function Boot(client)
    stub.SetClient(client or "11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()   -- what PLAYER_LOGIN does: builds the frame, the button, the panel
    local quests = env.Sources:Register("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
    local zones = env.Sources:Register("zones", { title = "Zones", addon = "Spoken_Zones", order = 2 })
    return env, quests, zones
end

---------------------------------------------------------------- a settings link registered before the panel exists
-- Feature addons register their link from ADDON_LOADED; the panel is built at PLAYER_LOGIN.
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
local early = stub.LoadSpoken(SPOKEN)
_G.Spoken:AddSettingsLink("Quests settings", function() end)
early.Addon:Enable()
-- On a client that nests each part's page under Spoken's, the settings list is the way there.
Expect("no link buttons where the parts' pages are nested", #_G.SpokenOptionsPanel.links, 0)
-- The legacy clients have no settings list, only Spoken's own window, and keep the links.
stub.SetClient("1.12"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
_G.SpokenOptionsPanel = nil
early = stub.LoadSpoken(SPOKEN)
_G.Spoken:AddSettingsLink("Quests settings", function() end)
early.Addon:Enable()
Expect("a link registered before the panel is built with it", #_G.SpokenOptionsPanel.links, 1)
Expect("...with its text", _G.SpokenOptionsPanel.links[1]:GetText(), "Quests settings")

-- 1.12 hands a script nothing: the frame is in `this` and its arguments in `arg1`. UI/Layout.lua
-- has no environment, so no Compat wrapper, and its controls read them from there themselves.
do
    local layout = _G.SpokenOptionsPanel.layout
    local function Row(label)
        for _, entry in ipairs(layout.entries) do if entry.label == label then return entry.frame end end
    end
    local L, profile = early.L, early.Addon.db.profile
    local locked, scaled = profile.Frame.LockFrame, profile.Frame.FrameScale
    local lock = Row(L.OPT_LOCK_FRAME)
    lock:SetChecked(true)
    _G.this, _G.arg1 = lock, "LeftButton"
    lock.scripts.OnClick()
    Expect("on 1.12 a settings checkbox finds itself in `this`", profile.Frame.LockFrame, true)
    local scale = Row(L.OPT_SCALE)
    _G.this, _G.arg1 = scale.layoutSlider, 1.5
    scale.layoutSlider.scripts.OnValueChanged()
    Expect("...and a slider its value in `arg1`", profile.Frame.FrameScale, 1.5)
    _G.this, _G.arg1 = nil, nil
    -- Put back: the saved variables outlive this load, and later scenarios read them.
    profile.Frame.LockFrame, profile.Frame.FrameScale = locked, scaled
    -- 2.4.3's and 3.3.5's sliders have no SetEnabled, and Refresh greys a slider out with it.
    local test = _G.SpokenLayout.New(CreateFrame("Frame"), 25, -16)
    local live = false
    local slider = test:Slider("Test", 0, 1, 0.1, function() return 0.5 end, function() end)
    test:Requires(slider, function() return live end, "off")
    stub.absentAPI.SetEnabled = true
    local ok = pcall(test.Refresh, test)
    stub.absentAPI.SetEnabled = nil
    Expect("...a slider greys out where sliders have no SetEnabled", ok and slider.layoutSlider.enabled, false)
end

---------------------------------------------------------------- loads, shows, hides
local env, quests, zones = Boot()
local F = env.PlayerFrame
Expect("the frame exists after Enable", F.frame ~= nil, true)
Expect("hidden while the queue is empty", F.frame:IsShown(), false)
local a = H.Clip({ present = { header = "Eagan Peltskinner", label = "Wolves Across the Border",
    bullet = "quest-accept", portrait = { kind = "none" } } })
quests:Enqueue(a)
Expect("shown once something is queued", F.frame:IsShown(), true)
Expect("the header is the clip's", F.frame.container.name:GetText(), "Eagan Peltskinner")
Expect("the first row is the clip's label", F.frame.container.buttons[1].textWidget:GetText(), "Wolves Across the Border")
env.SoundQueue:RemoveAllSoundsFromQueue()
Expect("hidden again when the queue empties", F.frame:IsShown(), false)

env.Addon:SetPlayerStyle("none")
quests:Enqueue(H.Clip())
Expect("Voice Only keeps it hidden with a queue", F.frame:IsShown(), false)
env.Addon:SetPlayerStyle("classic")
env.SoundQueue:RemoveAllSoundsFromQueue()

---------------------------------------------------------------- rows and held reason
env, quests, zones = Boot(); F = env.PlayerFrame
zones:AddGate(function() return "in combat" end)
local held = H.Clip({ present = { header = "Durotar", label = "Valley of Trials", bullet = "zone", portrait = { kind = "none" } } })
local free = H.Clip({ present = { header = "Thrall", label = "Warchief", bullet = "quest-accept", portrait = { kind = "none" } } })
zones:Enqueue(held); quests:Enqueue(free)
Expect("the speaking clip is row 1 even if queued second", F.frame.container.buttons[1].textWidget:GetText(), "Warchief")
Expect("a held row says why", F.frame.container.buttons[2].textWidget:GetText(), "Valley of Trials |cff888888(in combat)|r")
Expect("the header follows the head", F.frame.container.name:GetText(), "Thrall")

---------------------------------------------------------------- bullets
env, quests, zones = Boot(); F = env.PlayerFrame
_G.Spoken:RegisterBullet("quest-accept", [[Interface\AddOns\Spoken_Quests\Textures\Accept]], 14)
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "quest-accept", portrait = { kind = "none" } } }))
Expect("a row uses its registered bullet", F.frame.container.buttons[1].iconWidget:GetTexture(), [[Interface\AddOns\Spoken_Quests\Textures\Accept]])
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "nope", portrait = { kind = "none" } } }))
Expect("an unknown bullet falls back to the queue bullet", F.frame.container.buttons[2].iconWidget:GetTexture(), [[Interface\AddOns\Spoken\Textures\SoundQueueBulletQueue]])

---------------------------------------------------------------- portrait dispatch
env, quests, zones = Boot(); F = env.PlayerFrame
local P = env.Portrait
zones:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b",
    portrait = { kind = "texture", texture = [[Interface\AddOns\Spoken\Textures\Book]] } } }))
Expect("kind=texture shows a texture", F.frame.portrait.active, "texture")
Expect("...the one asked for", F.frame.portrait.texture:GetTexture(), [[Interface\AddOns\Spoken\Textures\Book]])
env.SoundQueue:RemoveAllSoundsFromQueue()

quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b",
    portrait = { kind = "model", creatureID = 196 } } }))
Expect("kind=model shows the model renderer", F.frame.portrait.active, "model")
Expect("...with the creature set", F.frame.portrait.model.creature, 196)
env.SoundQueue:RemoveAllSoundsFromQueue()

quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b",
    portrait = { kind = "model", creatureID = nil,
        fallback = { kind = "texture", texture = [[Interface\AddOns\Spoken\Textures\Book]] } } } }))
Expect("a model with nothing to load falls back", F.frame.portrait.active, "texture")
env.SoundQueue:RemoveAllSoundsFromQueue()

quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "unknown" } } }))
Expect("an unknown kind draws nothing rather than erroring", F.frame.portrait.active, "none")
env.SoundQueue:RemoveAllSoundsFromQueue()

env.Addon.db.profile.Frame.HidePortrait = true
F:RefreshConfig()
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "model", creatureID = 1 } } }))
Expect("HidePortrait hides the portrait", F.frame.portrait:IsShown(), false)
Expect("...and shows the line and mini pause instead", F.frame.miniPause:IsShown(), true)
env.Addon.db.profile.Frame.HidePortrait = false
F:RefreshConfig()

---------------------------------------------------------------- actions
env, quests, zones = Boot(); F = env.PlayerFrame
local clicked
zones:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "none" },
    actions = {
        { id = "read", text = "Read", onClick = function(clip) clicked = "read:" .. clip.key end },
        { id = "report", text = function() return "Report" end, onClick = function() clicked = "report" end },
    } } }))
Expect("two actions make two buttons", F.frame.actions.shown, 2)
Expect("...labelled", F.frame.actions.buttons[1]:GetText(), "Read")
Expect("...a text function is called", F.frame.actions.buttons[2]:GetText(), "Report")
F.frame.actions.buttons[1]:Click()
Expect("clicking passes the clip", clicked ~= nil and clicked:sub(1, 5), "read:")
env.SoundQueue:RemoveAllSoundsFromQueue()
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "none" } } }))
Expect("no actions, no strip", F.frame.actions.shown, 0)

---------------------------------------------------------------- one minimap button
env, quests, zones = Boot()
Expect("exactly one LDB object, named Spoken", stub.ldbObjects.Spoken ~= nil and stub.dbIcons.Spoken ~= nil, true)
Expect("...registered against the player's saved position", stub.dbIcons.Spoken.db, env.Addon.db.profile.Minimap.LibDBIcon)
-- The frame the lib keeps for the addon; the lib's clicks pass it, and it is the anchor
-- the addon holds for the compartment's clicks too.
local mmButton = stub.dbIcons.Spoken.button
env.Minimap:AddEntry("zones", { id = "lore", text = "Open lore window", order = 1, onClick = function() end })
env.Minimap:AddEntry("quests", { id = "opts", text = "Quest settings", order = 1, onClick = function() end })
local menu = env.Minimap:BuildMenu()
local labels = {}
for _, entry in ipairs(menu) do table.insert(labels, entry.text) end
Expect("the menu is the player's entries then each source's in order", table.concat(labels, "|"),
    "Stop or Replay|Stop All|Settings|Quest settings|Open lore window")
env.Minimap:RemoveEntry("zones", "lore")
Expect("RemoveEntry", getn(env.Minimap:BuildMenu()), 4)

-- A click on the icon opens the settings at once; the menu is a right-click away.
local openSettings, settingsOpened = env.Options.Open, false
env.Options.Open = function() settingsOpened = true end
stub.ResetDropDowns()
stub.ldbObjects.Spoken.OnClick(mmButton, "LeftButton")
Expect("left-clicking the button opens the settings", settingsOpened, true)
Expect("...and no menu", stub.openDropDown, nil)
env.Options.Open = openSettings

-- Opening it on a Blizzard client: the client's own context menu, which brings its
-- background, its highlight under the cursor, its closing on a click elsewhere and its
-- toggling with it. Nothing here reimplements any of that.
stub.ResetDropDowns()
stub.ldbObjects.Spoken.OnClick(mmButton, "RightButton")
Expect("right-clicking opens the client's menu", stub.openDropDown ~= nil, true)
local shown = {}
for _, entry in ipairs(stub.dropDownEntries) do
    table.insert(shown, entry.isSeparator and "---"
        or (entry.isTitle and "[" .. entry.text .. "]" or entry.text))
end
-- A rule before each addon's heading. Without one the headings are the only thing
-- separating the groups, and a heading reads as a row of the group above it.
Expect("...listing the player's entries, then each source's under its name, ruled apart",
    table.concat(shown, "|"), "Stop or Replay|Stop All|Settings|---|[Quests]|Quest settings")
Expect("...anchored to the button", stub.openDropDown.dropdownAnchor, mmButton)

-- The menu opens under the cursor, which is still on the button, so the button's tooltip
-- is still up and the two overlap. The tooltip goes.
local tip = _G.GameTooltip
tip:SetText("stale")
tip:Show()
stub.ldbObjects.Spoken.OnTooltipShow(tip)
Expect("the tooltip says nothing while the menu is open", tip:NumLines(), 1)
Expect("...and hides itself if the cursor goes back over the button", tip:IsShown(), false)

stub.ldbObjects.Spoken.OnClick(mmButton, "RightButton")
stub.ldbObjects.Spoken.OnTooltipShow(tip)
Expect("with the menu closed it says what the clicks do again", tip:NumLines() > 3, true)
stub.ldbObjects.Spoken.OnClick(mmButton, "RightButton")

stub.ldbObjects.Spoken.OnClick(mmButton, "RightButton")
Expect("clicking the button again closes it", stub.openDropDown, nil)

stub.ldbObjects.Spoken.OnClick(mmButton, "RightButton")
local chose = false
for _, entry in ipairs(stub.dropDownEntries) do
    if entry.text == "Quest settings" then
        entry.func = entry.func
        local original = entry.func
        entry.func = function() chose = true; original() end
        entry.func()
    end
end
Expect("choosing an entry runs it", chose, true)
Expect("...and the menu closes itself", stub.openDropDown, nil)

---------------------------------------------------------------- the menu where there is no menu API
-- The three legacy clients have no UIDropDownMenu worth the name, so the player
-- draws its own: a background, a highlight, a catcher for the click that dismisses it.
env, quests, zones = Boot("1.12")
mmButton = stub.dbIcons.Spoken.button
env.Minimap:AddEntry("quests", { id = "opts", text = "Quest settings", order = 1, onClick = function() end })
stub.ldbObjects.Spoken.OnClick(mmButton, "RightButton")
local frame = _G.SpokenMinimapMenu
Expect("a menu of its own opens", frame ~= nil and frame:IsShown(), true)
Expect("...on a background of its own", frame and frame:GetBackdrop() ~= nil, true)
Expect("...with an edge", frame and frame:GetBackdrop() and frame:GetBackdrop().edgeFile ~= nil, true)
local firstRow = frame.rows[1]
Expect("...rows that clear the border", firstRow and firstRow.anchor and firstRow.anchor.x >= 12, true)
Expect("...that highlight under the cursor", firstRow and firstRow:GetHighlightTexture() ~= nil
    and firstRow:GetHighlightTexture():GetTexture() ~= nil, true)
stub.ldbObjects.Spoken.OnClick(mmButton, "RightButton")
Expect("clicking the button again closes it", frame:IsShown(), false)
stub.ldbObjects.Spoken.OnClick(mmButton, "RightButton")
Expect("something catches a click outside", _G.SpokenMinimapMenuCatcher:IsShown(), true)
_G.SpokenMinimapMenuCatcher:Click()
Expect("...and that click closes the menu", frame:IsShown(), false)

---------------------------------------------------------------- settings
env = Boot()
-- Spoken's one entry in the game's settings: this page is its Home, and each feature addon's
-- page is nested under it.
Expect("a Settings category is registered, named for the whole family",
    stub.settingsCategories[1] and stub.settingsCategories[1].name, "Spoken")
Expect("...and exposed for feature addons to nest under", _G.Spoken:GetSettingsCategory(), stub.settingsCategories[1])

---------------------------------------------------------------- 1.12 loads too
env, quests, zones = Boot("1.12"); F = env.PlayerFrame
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "none" } } }))
Expect("1.12: the frame builds and shows", F.frame:IsShown(), true)
Expect("1.12: no Settings API, so no category", getn(stub.settingsCategories), 0)
Expect("1.12: GetSettingsCategory is nil rather than an error", _G.Spoken:GetSettingsCategory(), nil)

---------------------------------------------------------------- the panel keeps one rhythm
-- Every row used to place itself by adding a hand-tuned fudge to a running offset, so no
-- two sections were spaced alike. One layout owns the offset now: a row knows its own
-- height and the gap that follows it, and no caller does arithmetic.
Boot("11509")
-- On the settings canvas the rows live in the scroller's content, never on the panel itself.
local host = _G.SpokenOptionsPanel.content
local rows, headings = {}, {}
for _, child in ipairs(host.children) do
    if child.anchor and child.anchor.y then
        if child.layoutHeading then
            table.insert(headings, { y = child.layoutY, height = child.layoutHeight })
        elseif child.layoutHeight then
            -- A cell -- a module, a narrator style -- reaches past its row on every side, as a
            -- row's hover band does.
            local reach = (child.layoutCard or child.layoutTile) and 5 or 0
            table.insert(rows, { y = child.layoutY, height = child.layoutHeight, anchor = child.anchor.y, reach = reach,
                cell = reach > 0, own = child.GetHeight and child:GetHeight() or 0 })
        end
    end
end

local function Distinct(values)
    local seen, count = {}, 0
    for _, value in ipairs(values) do
        -- Rounded: the fractional halves of a row height are not a difference anyone sees.
        local key = string.format("%.1f", value)
        if not seen[key] then seen[key] = true; count = count + 1 end
    end
    return count
end

Expect("the panel has rows to space", #rows > 4, true)
-- The settings canvas neither scrolls nor clips, so the rows sit in a scroller whose content
-- reaches past the last of them; the contributions rows once pushed the minimap section off
-- the bottom of the window and over the game world.
Expect("on the settings canvas the rows sit in a scroller", host ~= nil, true)
local lowest = 0
for _, row in ipairs(rows) do lowest = math.max(lowest, -row.y + row.height) end
Expect("...tall enough to reach the last row", host:GetHeight() >= lowest, true)
-- Where each of the narrator style box's untitled sections starts, after its first.
local sectionStarts = {}
for _, item in ipairs(_G.SpokenOptionsPanel.layout.items) do
    if item.kind == "group" and item.shown then
        local seen = 0
        for _, section in ipairs(item.sections) do
            if section.shown then
                seen = seen + 1
                if seen > 1 then sectionStarts[string.format("%.1f", section.top)] = true end
            end
        end
    end
end
local gaps, sectionGaps = {}, {}
for index = 2, #rows do
    local previous = rows[index - 1]
    -- Top-anchored and downward, so the gap is the drop less the height already used.
    local gap = previous.y - rows[index].y - previous.height
    -- Only within a section: a heading in between adds its own space.
    -- Two settings side by side share one line: there is no gap between them to measure.
    local crossesHeading = previous.y == rows[index].y
    for _, heading in ipairs(headings) do
        if heading.y < previous.y and heading.y > rows[index].y then crossesHeading = true end
    end
    if sectionStarts[string.format("%.1f", rows[index].y)] then
        table.insert(sectionGaps, gap)
    elseif not crossesHeading then
        table.insert(gaps, gap)
    end
end
Expect("every row sits the same distance below the one above it", Distinct(gaps), 1)
-- Between the narrator style's sections, each one's small title: 16 under the rows above, 14 tall,
-- and its rows 10 under it.
Expect("...and the narrator style's sections their small titles apart, the same everywhere",
    #sectionGaps > 0 and Distinct(sectionGaps) == 1 and sectionGaps[1], 16 + 14 + 10)

-- Each control sits on its own row, centred on it as the game's settings centre theirs -- the 3
-- they nudge a slider and a dropdown up by aside (SettingsSliderControlMixin) -- which is how the
-- scale slider's label used to land on the row above. A card is its row, reaching past it.
local NUDGE = 3
local escaped = 0
for _, row in ipairs(rows) do
    if row.cell then
        if row.anchor > row.y + row.reach or row.anchor < row.y - row.height - row.reach then escaped = escaped + 1 end
    else
        local centre, middle = row.anchor - row.own / 2, row.y - row.height / 2
        if math.abs(centre - middle) > NUDGE + 1 then escaped = escaped + 1 end
    end
end
Expect("no control escapes the row it was given", escaped, 0)

-- Label on the left, control on the right, ending at the same edge for every row: a panel
-- whose controls end at different places reads as several panels. The narrator style's box
-- narrows its rows by its padding on both sides, so their middle, where the controls start,
-- stays where every other row's is.
local columns, captioned = {}, 0
for _, child in ipairs(host.children) do
    if child.layoutColumn then
        captioned = captioned + 1
        columns[string.format("%.1f", child.layoutColumn)] = true
    end
end
Expect("there are labelled controls to line up", captioned > 1, true)
local distinctColumns, columnsSeen = 0, nil
for key in pairs(columns) do distinctColumns = distinctColumns + 1; columnsSeen = tonumber(key) end
Expect("...and every one of them ends at the same edge, inside the box too", distinctColumns, 1)

-- From where each section ends -- the bottom of its box, or of its cards where it has no box --
-- to the next one's title. A group's title (the narrator style's settings) is a heading too, and
-- after the group comes the bottom of its box; its first section follows its title, not a section.
local headingGaps, last = {}, nil
local groups = 0
for _, item in ipairs(_G.SpokenOptionsPanel.layout.items) do
    if item.kind == "section" and item.shown then
        if last and last.bottom and item.heading then
            table.insert(headingGaps, last.bottom - item.heading.layoutY)
        end
        last = item
    elseif item.kind == "group" and item.shown then
        groups = groups + 1
        if last and last.bottom then
            table.insert(headingGaps, last.bottom - item.heading.layoutY)
        end
        last = nil
    elseif item.kind == "groupEnd" and item.group.shown then
        last = item.group
    end
end
Expect("every heading the same distance below the section or box above", Distinct(headingGaps), 1)
Expect("the narrator style's settings are a group of their own", groups, 1)
do
    local layout = _G.SpokenOptionsPanel.layout
    local group
    for _, item in ipairs(layout.items) do
        if item.kind == "group" and item.shown then group = item end
    end
    local shown = {}
    for _, section in ipairs(group and group.sections or {}) do
        if section.shown then table.insert(shown, section) end
    end
    local titled, small, divided = 0, 0, 0
    for _, section in ipairs(shown) do
        if section.heading then titled = titled + 1 end
        if section.small and section.small.shown ~= false then small = small + 1 end
        if section.divider and section.divider.shown ~= false then divided = divided + 1 end
    end
    Expect("its sections have small titles under the group's large one", titled .. " " .. small, "0 " .. #shown)
    Expect("...a line running on from each, the first's too", divided, #shown)
    Expect("...its rows where every other section's are, in from no box",
        shown[1] and (shown[1].left .. " " .. shown[1].width) or "no sections", layout.left .. " " .. layout:Width())
    local list
    for _, item in ipairs(layout.items) do
        for _, row in ipairs(item.rows or { item }) do
            if row.control and row.control.layoutRows and not list then list = row.control end
        end
    end
    -- Guarded, so a layout without small titles or their lines fails these rather than stopping.
    local divider, small = shown[2] and shown[2].divider, shown[2] and shown[2].small
    local first = shown[1] and shown[1].small
    Expect("...each title where its rows' labels start, its line on to where the modules' list ends",
        small and divider and (small.anchor.x .. " " .. (divider.anchor.x + divider.width)) or "no small title",
        (layout.left + 37) .. " " .. (list.anchor.x + list.width))
    Expect("...the first small title under the group's as a section's rows are under its own, its rows 10 under it",
        first and (group.heading.layoutY - first.layoutY) or "no small title", 45 + 9)
    Expect("...its rows 10 under it", first and (first.layoutY - 14 - shown[1].top) or "no small title", 10)
    local preview
    for _, item in ipairs(layout.items) do
        if item.button and item.kind == "section" then preview = item.button end
    end
    Expect("the Preview button by the styles' title ends where the lists do",
        preview ~= nil and preview.anchor.x, list.anchor.x + list.width)
end

-- A heading introduces the section under it. Sit it midway and it reads as belonging to
-- neither: the space above its words has to be the larger of the two. As the game's section
-- header has them, its words start 16 down its 45 and run 16 tall, so to 32.
local below
for _, heading in ipairs(headings) do
    local first
    for _, row in ipairs(rows) do
        if row.y < heading.y and (not first or row.y > first.y) then first = row end
    end
    if first then below = below or (heading.y - 32 - first.y) end
end
local above = headingGaps[1] and (headingGaps[1] + 16)
Expect("a heading sits nearer its own section than the one above",
    below ~= nil and above ~= nil and above > below, true)

---------------------------------------------------------------- every sound setting is on this panel
-- The two feature addons each used to carry a channel control of their own, so a player
-- with both had two settings for one thing and no way to tell which won. Everything about
-- how a line is played is read here, whichever addon queued it.
-- A feature addon declares its optional actions as it loads; the player builds its panel
-- at login. Same order here, or the panel is built before there is anything to put on it.
local function PanelLabelsSetup(client)
    stub.SetClient(client or "11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
    env = stub.LoadSpoken(SPOKEN)
    _G.Spoken:RegisterOptionalAction("report", "Report")
    env.Addon:Enable()
end

--- The panel's labels in the order they are drawn.
local function PanelOrder(client)
    PanelLabelsSetup(client)
    local ordered = {}
    for _, text in ipairs(stub.LabelsUnder(_G.SpokenOptionsPanel)) do
        if type(text) == "string" and text ~= "" then table.insert(ordered, text) end
    end
    return ordered
end

local function PanelLabels(client)
    PanelLabelsSetup(client)
    local labels = {}
    for _, text in ipairs(stub.LabelsUnder(_G.SpokenOptionsPanel)) do
        labels[text] = true
    end
    return labels
end

local labels = PanelLabels("11509")
-- "Up next" is the queue window's own title. As a settings heading it named nothing. In the
-- narrator style's settings the window's rows are under a small "Window" title.
Expect("the window settings are under a small Window title in the narrator style's settings", labels["Window"], true)
Expect("...nor the queue's title", labels["Up next"], nil)
-- The scale slider was built with no height and no orientation, so it drew nothing: the
-- setting sat on the panel invisible, with a gap where it should have been. The zones
-- addon's own sliders, which do render, set both.
-- Label on the left, control on the right, value beside it: one row, not two.
Expect("the scale slider is labelled", labels["Window Size"], true)
Expect("...with its value beside the bar", labels["70%"], true)
local scale
for _, child in ipairs(_G.SpokenOptionsPanel.content.children) do
    if child.layoutSlider and child.layoutSlider.frameType == "Slider" then scale = scale or child.layoutSlider end
end
Expect("the scale slider is a slider", scale ~= nil, true)
Expect("...with a height, or it draws nothing", scale and scale.height, 16)
Expect("...and an orientation", scale and scale:GetOrientation(), "HORIZONTAL")
Expect("an optional action is named on the panel", labels["Hide Report Button"], true)
-- Hiding the portrait and hiding one button are the same kind of choice, so they sit together.
local order = table.concat(PanelOrder("11509"), "|")
Expect("...beside hiding the portrait", string.find(order,
    "Hide Portrait|Hide Report Button", 1, true) ~= nil, true)
-- Nothing on screen at all is a way of showing lines, chosen with the others, not a switch
-- among the window's settings.
Expect("voice only is still one of the ways to show lines", _G.SpokenEnv.Options:Styles()[4], "none")
Expect("...and a narrator card of its own, a sound's bars rising and falling", labels["Voice Only"], true)
Expect("...and there is no separate switch to hide the window", labels["Hide Window"], nil)
Expect("there is no channel to choose: the voices play on Master", labels["Volume Follows"], nil)
Expect("...and the voice language, once for every module", labels["Voice Language"], true)
Expect("...and so is silencing the game's own dialogue",
    labels["Silence NPC Voices"], true)
Expect("a current client is offered nothing about the music channel",
    labels["Play through the music channel"], nil)

-- 2.4.3 and 3.3.5 route speech through the music channel, because those clients cannot
-- stop a sound any other way. Those settings existed from the start and had no row at
-- all: the only way to change one was to edit the saved variables by hand.
labels = PanelLabels("3.3.5")
Expect("a legacy client can reach the music channel", labels["Play through the music channel"], true)
Expect("...its volume", labels["Speech volume"], true)
Expect("...its fade, as a duration and not a percentage", labels["0.5s"], true)
Expect("...and the HD model patch", labels["HD model patch installed"], true)

---------------------------------------------------------------- an action in the corner, and hiding them
-- A button that only ever says "Report" earns an icon rather than a word, and it belongs
-- out of the way of the line being read: the top right corner, not the strip under it.
local ICON = [[Interface\HelpFrame\HelpIcon-Bug]]
local reported = 0
local function CornerClip()
    return H.Clip({ present = { header = "h", label = "l", bullet = "b",
        portrait = { kind = "none" }, actions = {
            { id = "report", icon = ICON, text = "R", anchor = "topright",
              onClick = function() reported = reported + 1 end },
        } } })
end

env, quests, zones = Boot("11509")
quests:Enqueue(CornerClip())
env.PlayerFrame:Update()
local corner = env.PlayerFrame.frame.actions.buttons[1]
Expect("the action is a button", corner ~= nil, true)
Expect("...showing its icon, not a word, in the player's round button", corner.glyph:GetTexture(), ICON)
Expect("...the ring round it, as the subtitle's controls have", corner.ring ~= nil, true)
Expect("...with no label", corner:GetText() or "", "")
Expect("...in the corner", corner.anchor and corner.anchor.point, "TOPRIGHT")
-- Sized to be aimed at. Pinned as a floor rather than a number, so it can be tuned but
-- cannot drift back to something you have to hunt for.
Expect("...big enough to hit", corner.width >= 20 and corner.height >= 20, true)
Expect("...and it still does what it is for", (corner:Click() or reported), 1)
-- The strip under the queue is what makes room for itself; a corner icon overlaps nothing.
Expect("a corner action asks for no strip", env.PlayerFrame.frame.actions.shown, 0)

-- The art this uses postdates the three legacy clients, where the icon would be a
-- blank square. There the action falls back to the letter it carries for the purpose.
env, quests, zones = Boot("1.12")
quests:Enqueue(CornerClip())
env.PlayerFrame:Update()
local legacy = env.PlayerFrame.frame.actions.buttons[1]
Expect("an old client gets a letter instead", legacy:GetText(), "R")
Expect("...and no icon at all", legacy:GetNormalTexture():GetTexture(), nil)
Expect("...still in the corner", legacy.anchor and legacy.anchor.point, "TOPRIGHT")
legacy:Click()
Expect("...and it still reports", reported, 2)

env, quests, zones = Boot("11509")
quests:Enqueue(CornerClip())
env.PlayerFrame:Update()
corner = env.PlayerFrame.frame.actions.buttons[1]
-- An addon may declare an action optional and name it; the player then offers a setting
-- for that action by name, without learning what the action does.
_G.Spoken:RegisterOptionalAction("report", "Report")
env.Addon.db.profile.Frame.HiddenActions.report = true
env.PlayerFrame:Update()
Expect("hidden by its own setting", corner:IsShown(), false)
env.Addon.db.profile.Frame.HiddenActions.report = false
env.PlayerFrame:Update()
Expect("...and back", corner:IsShown(), true)

---------------------------------------------------------------- one addon's actions are not another's
-- Both shipped addons call their action "report". Keyed by id alone they are one button,
-- so whichever addon created it first owns its click: reporting a quest line would file a
-- zone. Keyed by source they are two, and the other addon's are hidden when the head moves.
env, quests, zones = Boot()
local zoneClicks, questClicks = 0, 0
local function Clip(source, label, actions)
    return H.Clip({ present = { header = "h", label = label, bullet = "b",
        portrait = { kind = "none" }, actions = actions } })
end
local zoneClip = Clip(zones, "Durotar", {
    { id = "read", text = "Read", onClick = function() end },
    { id = "report", text = "Report", onClick = function() zoneClicks = zoneClicks + 1 end },
})
local questClip = Clip(quests, "Cutting Teeth", {
    { id = "report", text = "Report", onClick = function() questClicks = questClicks + 1 end },
})
zones:Enqueue(zoneClip)
env.PlayerFrame:Update()
Expect("the zone line brings two actions", env.PlayerFrame.frame.actions.shown, 2)
env.SoundQueue:RemoveSoundFromQueue(zoneClip)
quests:Enqueue(questClip)
env.PlayerFrame:Update()
Expect("the quest line brings one", env.PlayerFrame.frame.actions.shown, 1)
local visible = {}
for _, button in pairs(env.PlayerFrame.frame.actions.byId) do
    if button:IsShown() then table.insert(visible, button:GetText() or "?") end
end
Expect("...and only one is on screen", table.concat(visible, "|"), "Report")
env.PlayerFrame.frame.actions.buttons[1]:Click()
Expect("...whose click belongs to the addon that is speaking", questClicks, 1)
Expect("...not to the other one", zoneClicks, 0)

-- An addon may build its own button, and such a button keeps its own click handler. Shared
-- under one id, the first addon to build one would answer for both.
env, quests, zones = Boot()
local built = 0
local ownClip = Clip(quests, "Cutting Teeth", {
    { id = "report", create = function(parent)
        built = built + 1
        local button = CreateFrame("Button", nil, parent)
        button.builtBy = "quests"
        return button
    end },
})
local plainClip = Clip(zones, "Durotar", {
    { id = "report", text = "Report", onClick = function() zoneClicks = zoneClicks + 1 end },
})
quests:Enqueue(ownClip)
env.PlayerFrame:Update()
env.SoundQueue:RemoveSoundFromQueue(ownClip)
zones:Enqueue(plainClip)
env.PlayerFrame:Update()
Expect("the other addon does not inherit a button built by this one",
    env.PlayerFrame.frame.actions.buttons[1].builtBy, nil)

---------------------------------------------------------------- a model portrait on a current client
-- The portrait is configured before the rows, so an error raised while resolving it
-- abandons the rest of the update: the header, every row and the actions. The frame then
-- shows a portrait over an empty band, which reads as an empty queue.
--
-- Model:GetModel returned a path and was removed from the current clients, which answer
-- GetModelFileID instead. Asking for the one this client lacks is an error, not a nil.
for _, client in ipairs({ "11509", "1.12" }) do
    env, quests, zones = Boot(client)
    local clip = H.Clip({ present = { header = "Gornek", label = "Cutting Teeth", bullet = "b",
        portrait = { kind = "model", creatureID = 3143, animation = 60,
            fallback = { kind = "texture", texture = "Book" } } } })
    local ok, err = pcall(function() quests:Enqueue(clip) end)
    Expect(client .. ": a model portrait does not abandon the update", ok, true)
    if not ok then Expect(client .. ": ...", tostring(err), "no error") end
    Expect(client .. ": ...so the header is still drawn",
        env.PlayerFrame.frame.container.name:GetText(), "Gornek")
    Expect(client .. ": ...and the row with it",
        env.PlayerFrame.frame.container.buttons[1].textWidget:GetText(), "Cutting Teeth")
end

---------------------------------------------------------------- the slash command reaches the client
-- Every file here runs inside a private environment whose metatable falls back to _G.
-- Reads fall through; writes do not. A bare `SLASH_SPOKEN1 = "/spoken"` therefore lands in
-- the environment and the client never hears of the command.
env = Boot()
Expect("the handler is registered", type(SlashCmdList.SPOKEN), "function")
Expect("...and so is the word that reaches it", rawget(_G, "SLASH_SPOKEN1"), "/spoken")

---------------------------------------------------------------- what the frame reports
-- A row that is present but drawn nowhere looks, from outside, exactly like a row that was
-- never built. /spoken diagnostics tells the two apart.
env, quests, zones = Boot()
quests:Enqueue(H.Clip({ present = { header = "Gornek", label = "Cutting Teeth", bullet = "b",
    portrait = { kind = "none" } } }))
env.PlayerFrame:Update()
local report = table.concat(env.PlayerFrame:Describe(), "\n")
Expect("it reports the header it drew", string.find(report, 'header="Gornek"', 1, true) ~= nil, true)
Expect("...the row and its width", string.find(report, 'text="Cutting Teeth"', 1, true) ~= nil, true)
Expect("...which portrait renderer is in use", string.find(report, "portrait kind=none", 1, true) ~= nil, true)
Expect("...and how much is queued", string.find(report, "queue=1", 1, true) ~= nil, true)

---------------------------------------------------------------- after PLAYER_LOGOUT
-- AceDB strips a subtable that holds only defaults when the player logs out, and the frame
-- goes on resizing while the UI is torn down. Its layout used to index the missing table.
env, quests = Boot()
quests:Enqueue(H.Clip({ present = { header = "Gornek", label = "Cutting Teeth", bullet = "b",
    portrait = { kind = "none" } } }))
env.PlayerFrame:Update()
env.Addon.db.profile.Frame = nil
local ok, err = pcall(function()
    env.MinimalPlayer:LayoutQueue()
    env.PlayerFrame:Update()
end)
Expect("the layout survives the logout's stripped settings", ok and "no error" or tostring(err), "no error")

---------------------------------------------------------------- the layout outlives the login
-- AceDB keys the profile by the name UnitName gave when its file loaded, and the Forever
-- client answers "Unknown" there on some logins and the name on others. A place, a width or
-- an expanded caption kept in the profile came back on one login and not the next.
_G.SpokenSettings = nil
env = Boot()
local frame = env.PlayerFrame.frame
frame:SetWidth(500)
frame.mover.hooks.OnMouseUp[1]()
local saved = _G.SpokenSettings.global.Layout.Player
Expect("a drag saves where the player sits", saved and saved.left .. "," .. saved.top, "0,100")
Expect("...and its width", saved and saved.width, 500)
env.Transcript:ToggleExpanded()
Expect("expanding the captions is saved account-wide", _G.SpokenSettings.global.Layout.CaptionsExpanded, true)
_G.SpokenSettings.profiles = {}   -- the next login's profile is a different one
env = Boot()
frame = env.PlayerFrame.frame
local point, relative, relativePoint, x, y = frame:GetPoint()
Expect("the next login puts the player back", table.concat({ point, relativePoint, x, y }, " "), "TOPLEFT BOTTOMLEFT 0 100")
Expect("...against the screen", relative, _G.UIParent)
Expect("...at the saved width", frame:GetWidth(), 500)
Expect("...with the captions still expanded", env.Transcript.expand:GetNormalTexture():GetTexture(),
    [[Interface\Buttons\UI-MinusButton-Up]])
env.PlayerFrame:Reset()
Expect("reset forgets the saved place", _G.SpokenSettings.global.Layout.Player, nil)
-- The minimal player saves its own place beside this one: tests/minimal-classic.

---------------------------------------------------------------- a sample line, for the welcome window
-- Choosing a window as the narrator style shows it at once with a sample line in it, as the
-- subtitles show theirs; the first real line puts the sample away.
local quests
env, quests = Boot()
local F = env.PlayerFrame
local function Shown(f) return f:IsShown() and true or false end
Expect("with nothing playing the window is hidden", Shown(F.frame), false)
F:ShowSample(true)
Expect("a sample shows the window", Shown(F.frame), true)
Expect("...with the sample speaker", F.frame.container.name:GetText(), env.L.SAMPLE_SPEAKER)
quests:Enqueue(H.Clip({ present = { header = "Thrall", label = "Warchief", portrait = { kind = "none" } } }))
Expect("a real line puts the sample away", F:IsShowingSample(), false)
Expect("...and the window shows the line", F.frame.container.name:GetText(), "Thrall")
env.SoundQueue:RemoveAllSoundsFromQueue()
Expect("...and closes after it, with no sample left to come back to", Shown(F.frame), false)

_G.UISpecialFrames = _G.UISpecialFrames or {}
env.Addon:SetPlayerStyle("minimal")
F:RefreshConfig()
F:ShowSample(true)
Expect("the small window shows the sample too", env.MinimalPlayer.clip == F.sample, true)
Expect("...its speaker", env.MinimalPlayer.name:GetText(), env.L.SAMPLE_SPEAKER)
F:ShowSample(false)
Expect("...and puts it away", env.MinimalPlayer.wanted, false)

-- The welcome window's narrator tiles: a click chooses, and a Preview button on each style but
-- Voice Only shows that style with a sample line, whichever is chosen, until it is hidden again,
-- a style is chosen or the window closes.
local W = env.Welcome
-- The subtitle's own sample is drawn in tests/captions; here only what the welcome asks of it.
local subtitleSample = false
env.Subtitle.ShowSample = function(_, shown) subtitleSample = shown and true or false end
env.Subtitle.IsShowingSample = function() return subtitleSample end
W:Build()
local tiles = W.styles
local function Tile(value)
    for _, tile in ipairs(tiles) do if tile.layoutTile.value == value then return tile end end
end
local preview = W.preview
local function Label() return preview:GetText() end
Expect("one Preview button for the styles", preview ~= nil and Tile("classic").previewButton == nil, true)
Expect("...at the end of their question's line, as on Spoken's settings page", (function()
    local section = W.layout.items[#W.layout.items]
    local heading = section.heading
    if section.button ~= preview or not (heading and preview.anchor) then return false end
    -- Their middles level: the question's 17-high line, the button's 22.
    return preview.anchor.point == "TOPRIGHT"
        and math.abs((preview.anchor.y - 11) - (heading.anchor.y - 8.5)) <= 1
end)(), true)
env.Addon:SetPlayerStyle("subtitle")
W.layout:Refresh()
Expect("...reading Preview", Label(), env.L.STYLE_PREVIEW)
Tile("classic"):Click()
Expect("choosing a style shows no sample", F:IsShowingSample() or subtitleSample, false)
preview:Click()
Expect("Preview turns preview mode on: the chosen style with a sample line", F:IsShowingSample() and Shown(F.frame), true)
Expect("...and the button turns it off again", Label(), env.L.STYLE_PREVIEW_HIDE)
Tile("subtitle"):Click()
Expect("in preview mode, choosing another style swaps to it", subtitleSample and not F:IsShowingSample(), true)
Expect("...and the mode stays on", Label(), env.L.STYLE_PREVIEW_HIDE)
Tile("none"):Click()
Expect("Voice Only in preview mode shows nothing", subtitleSample or F:IsShowingSample(), false)
Expect("...and the button can still turn the mode off", preview:IsEnabled() and true or false, true)
Tile("minimal"):Click()
Expect("...until another style is chosen", env.MinimalPlayer.clip == F.sample and F:IsShowingSample(), true)
preview:Click()
Expect("Hide Preview turns the mode off and the samples go", F:IsShowingSample() or subtitleSample or env.Addon.previewStyle ~= nil, false)
Expect("...and it reads Preview again", Label(), env.L.STYLE_PREVIEW)
Tile("none"):Click()
Expect("with Voice Only chosen and the mode off there is nothing to preview", preview:IsEnabled() and true or false, false)
Tile("classic"):Click()
preview:Click()
W.frame:GetScript("OnHide")(W.frame)
Expect("closing the welcome turns preview mode off", env.Options.previewing or env.Addon.previewStyle ~= nil or F:IsShowingSample(), false)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll player frame tests passed")
