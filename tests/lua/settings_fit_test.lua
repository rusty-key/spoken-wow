-- Every Spoken settings page, built with Waypoint UI's art at the width a page gets beside
-- the tab sidebar and at a wide one: no row, label, control, card, tile, badge or button may
-- run past the edges of its box, and every control on the right ends where the others do.
-- A button pair once ran out past its box's left edge on a narrow page; this is the check that
-- would have caught it. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local QUESTS = here .. "/../../addons/SpokenQuests/"
local BOOKS = here .. "/../../addons/SpokenBooks/"
local ZONES = here .. "/../../addons/SpokenZones/"
_G.UISpecialFrames = _G.UISpecialFrames or {}

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
stub.world.questID = 0; stub.ShowPanel(nil)
-- Waypoint's art, as on a client that can nine-slice with the player loaded.
_G.Enum = _G.Enum or {}
_G.Enum.UITextureSliceMode = { Stretched = 0 }
_G.C_AddOns = { IsAddOnLoaded = function() return true end }

local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
local env = _G.SpokenEnv
env.Sources:Register("books", { title = "Spoken Books", addon = "SpokenBooks", order = 2,
    packs = function() return { "SpokenBooksAudio" } end })
env.Sources:Register("zones", { title = "Spoken Zones", addon = "SpokenZones", order = 3,
    packs = function() return { "SpokenZonesAudio" } end })
_G.Spoken:RegisterOptionalAction("report", "Report")
env.Addon:Enable()
local QuestsPanel = stub.LoadQuestsPanel(QUESTS, VO)
QuestsPanel:Setup()
local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
    "UI/Layout", "UI/Options", "Events", "Commands" }) do
    assert(loadfile(BOOKS .. file .. ".lua"))("SpokenBooks", B)
end
B:InitDB(); B:SetupOptions()
local Z = H.NewZoneLore()
for _, file in ipairs({ "UI/Layout", "UI/Options" }) do
    assert(loadfile(ZONES .. file .. ".lua"))("SpokenZones", Z)
end
Z:SetupOptions()

local Layout = _G.SpokenLayout
local pages = { { name = "General", layout = _G.SpokenOptionsPanel.layout } }
for _, page in ipairs(env.Options.pages or {}) do
    table.insert(pages, { name = page.name, layout = page.layout })
end
Expect("General and the three parts' pages are all here", #pages, 4)

local BOX = Layout.BOX_MARGIN
local function Label(row)
    local control = row.control
    local text = control.layoutLabel and control.layoutLabel.text or control.text
    return type(text) == "string" and text or tostring(control.frameType or control.kind)
end

-- Every region a row placed against the page itself, inside [left, right].
local function Escapes(layout, row, left, right, out)
    for _, region in ipairs(row.regions) do
        local anchor = region.anchor
        if anchor and anchor.relativeTo == layout.parent and anchor.point == "TOPLEFT" and region.width then
            if anchor.x < left - 0.01 or anchor.x + region.width > right + 0.01 then
                table.insert(out, string.format("%s (%s at %.1f, %.1f wide; box %.1f to %.1f)", Label(row),
                    tostring(region.frameType or region.kind), anchor.x, region.width, left, right))
            end
        end
    end
end

for _, width in ipairs({ 470, 740 }) do
    for _, page in ipairs(pages) do
        local layout = page.layout
        layout.parent:SetWidth(width)
        layout:Refresh()
        local escaped, misaligned, columns = {}, {}, {}
        local left, right = layout.left - BOX, layout.left + layout:Width() + BOX
        for _, item in ipairs(layout.items) do
            -- A boxed section's rows inside its box; a plain one's cards inside the boxes' width.
            if item.kind == "section" and item.shown then
                for _, row in ipairs(item.rows) do
                    if row.shown then Escapes(layout, row, left, right, escaped) end
                end
            elseif item.kind == "row" and item.shown ~= false then
                -- Rows outside a box -- the search box -- may reach out to the boxes' edges.
                Escapes(layout, item, left, right, escaped)
            end
        end
        -- Every control on the right of a row ends at the one column.
        for _, item in ipairs(layout.items) do
            for _, row in ipairs(item.rows or {}) do
                local control = row.control
                -- A dropdown starts 48 left of the middle, as the game's does; the rest at the column.
                if row.shown and control.layoutColumn and control.anchor and not control.layoutChoose then
                    columns[string.format("%.1f", control.layoutColumn)] = true
                    if math.abs(control.anchor.x - control.layoutColumn) > 0.01 then
                        table.insert(misaligned, Label(row))
                    end
                end
            end
        end
        local distinct = 0
        for _ in pairs(columns) do distinct = distinct + 1 end
        local where = page.name .. " at " .. width .. " wide"
        Expect(where .. ": nothing runs past its box", table.concat(escaped, "; "), "")
        Expect(where .. ": every control starts where the others do", table.concat(misaligned, "; "), "")
        Expect(where .. ": ...at one column", distinct <= 1, true)
    end
end
---------------------------------------------------------------- the welcome window
-- The same boxes, cards and pictures, centred in the window: as far from its left side as
-- from its right, and nothing past a box's edges.
local Welcome = env.Welcome
Welcome:Build(); Welcome:Sync()
local welcome = Welcome.layout
local frameWidth = Welcome.frame.width
local boxLeft, boxRight = welcome.left - BOX, welcome.left + welcome:Width() + BOX
Expect("the welcome's cards are centred in its window", math.abs(boxLeft - (frameWidth - boxRight)) < 0.6, true)
local outside = {}
for _, item in ipairs(welcome.items) do
    if item.kind == "section" and item.shown then
        for _, row in ipairs(item.rows) do
            if row.shown then Escapes(welcome, row, boxLeft, boxRight, outside) end
        end
    end
end
Expect("...and nothing in them runs past their edges", table.concat(outside, "; "), "")
Expect("...nor does the window run off the screen at the default UI scale", Welcome.frame.height < 768, true)

Expect("nothing went wrong in a callback", #env.Callbacks.errors, 0)

print(Failures() == 0 and "settings_fit_test: ok" or "settings_fit_test: FAILED")
os.exit(Failures() == 0 and 0 or 1)
