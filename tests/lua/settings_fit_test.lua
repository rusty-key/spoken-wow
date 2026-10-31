-- Every Spoken settings page, built with Waypoint UI's art at the width a page gets beside
-- the tab sidebar and at a wide one: no row, label, control, card, tile, badge or button may
-- run past the edges of its box, and every control on the right ends where the others do.
-- A button pair once ran out past its box's left edge on a narrow page; this is the check that
-- would have caught it.
--
-- In each of the client languages: `luajit settings_fit_test.lua deDE` builds every page in
-- German. A setting's name, a card's title and a badge do not wrap, so a translation longer
-- than its room is cut off with "..." rather than pushing the control along; every such text is
-- named here. Widths are estimated from the characters and the font's size, not drawn by the
-- game's fonts, so a text that only just fits is still worth a look in game. `make test-player`
-- runs all nine.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local LANG = arg[1] or "enUS"

-- Roughly how wide the game draws a text: Friz Quadrata's letters average a little over half the
-- font's size, a space about a quarter, and the Chinese and Korean fonts' characters are square.
local FONT_SIZE = { GameFontNormalSmall = 10, GameFontHighlightSmall = 10, GameFontDisableSmall = 10,
    GameFontNormalLarge = 16, GameFontHighlightLarge = 16, GameFontNormalHuge = 20 }
stub.TextWidth = function(fs)
    local text = tostring(fs.text or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
    local size = FONT_SIZE[fs.font] or 12
    local width = 0
    -- One character at a time, by the length its first byte gives it in UTF-8.
    local i, count = 1, #text
    while i <= count do
        local lead = text:byte(i)
        if lead == 32 then
            width = width + size * 0.28
        elseif lead >= 0xE3 and lead <= 0xEF then
            width = width + size
        else
            width = width + size * 0.58
        end
        i = i + (lead < 0x80 and 1 or lead < 0xE0 and 2 or lead < 0xF0 and 3 or 4)
    end
    return width
end
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local READABLES = here .. "/../../addons/Spoken_Readables/"
local PLACES = here .. "/../../addons/Spoken_Places/"
_G.UISpecialFrames = _G.UISpecialFrames or {}

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.SetLocale(LANG)
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
stub.world.questID = 0; stub.ShowPanel(nil)
-- Waypoint's art, as on a client that can nine-slice with the player loaded.
_G.Enum = _G.Enum or {}
_G.Enum.UITextureSliceMode = { Stretched = 0 }
_G.C_AddOns = { IsAddOnLoaded = function() return true end }

local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
local env = _G.SpokenEnv
env.Sources:Register("readables", { title = "Spoken Readables", addon = "Spoken_Readables", order = 4,
    packs = function() return { "SpokenReadablesAudio" } end })
env.Sources:Register("places", { title = "Spoken Places", addon = "Spoken_Places", order = 3,
    packs = function() return { "SpokenPlacesAudio" } end })
_G.Spoken:RegisterOptionalAction("report", "Report")
env.Addon:Enable()
local QuestsPanel = stub.LoadQuestsPanel(QUESTS, VO)
QuestsPanel:Setup()
VO.GossipSettingsPanel:Setup()
VO.ChatterSettingsPanel:Setup()
local B = {}
for _, file in ipairs({ "Locale/enUS", "Locale/deDE", "Locale/esES", "Locale/frFR", "Locale/ptBR", "Locale/ruRU",
    "Locale/koKR", "Locale/zhCN", "Locale/zhTW", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
    "UI/Readables", "UI/Options", "Events", "Commands" }) do
    assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B)
end
B:InitDB(); B:SetupOptions()
-- Two of the Compendium's tabs, so Spoken's page shows their Unlock switches.
B:SetupReadables()
for _, file in ipairs({ "Data/Compendium", "Data/QuestText", "UI/QuestsTab" }) do
    assert(loadfile(QUESTS .. file .. ".lua"))("Spoken_Quests", {})
end
VO.QuestsTab:Setup()
local Z = H.NewZoneLore()
for _, file in ipairs({ "UI/Options" }) do
    assert(loadfile(PLACES .. file .. ".lua"))("Spoken_Places", Z)
end
Z:SetupOptions()
-- The Spoken_Developer module and its page.
local Dev = stub.LoadDeveloper(here .. "/../../addons/Spoken_Developer/")
Dev:SetupOptions()
local entries = {}
for _, category in ipairs(stub.settingsCategories) do
    if category.parent and category.name == env.L.OPT_STYLE_DIALOGUEUI then table.insert(entries, category.name) end
end
Expect("no DialogueUI entry under Spoken: its settings are on Spoken's page", table.getn(entries), 0)

local Layout = _G.SpokenLayout
local pages = { { name = "General", layout = _G.SpokenOptionsPanel.layout } }
for _, page in ipairs(env.Options.pages or {}) do
    table.insert(pages, { name = page.name, layout = page.layout })
end
Expect("General, the five parts' pages, Contribute and the Developer page are all here", #pages, 8)
local ordered, shared = {}, {}
for _, page in ipairs(env.Options.pages or {}) do
    if ordered[page.order] then table.insert(shared, page.name) end
    ordered[page.order] = true
end
Expect("no two pages share an order, which is how Settings opens one", table.concat(shared, ", "), "")

local BOX = Layout.BOX_MARGIN
local function Label(row)
    local control = row.control
    local text = control.layoutLabel and control.layoutLabel.text or control.text
    return type(text) == "string" and text or tostring(control.frameType or control.kind)
end

-- Every text on screen that does not wrap and is narrower than what it says: the game draws it
-- cut short. Hidden frames and everything in them are skipped.
local function CutOff(frame, out)
    if frame.shown == false then return end
    if frame.kind == "FontString" and frame.wordWrap == false and (frame.width or 0) > 0 then
        local text = frame.text
        if type(text) == "string" and text ~= "" and frame:GetStringWidth() > frame.width + 0.5 then
            table.insert(out, string.format("%q needs %.0f, has %.0f", text, frame:GetStringWidth(), frame.width))
        end
    end
    for _, child in ipairs(frame.children or {}) do CutOff(child, out) end
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

-- 470 is a page squeezed beside another addon's tab sidebar, where even the English names are
-- cut short; about 680 is what the game's own settings window gives a page.
for _, width in ipairs({ 470, 680, 740 }) do
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
        local where = LANG .. ": " .. page.name .. " at " .. width .. " wide"
        if width >= 680 then
            local cut = {}
            CutOff(layout.parent, cut)
            Expect(where .. ": no text is cut off", table.concat(cut, "; "), "")
        end
        Expect(where .. ": nothing runs past its box", table.concat(escaped, "; "), "")
        Expect(where .. ": every control starts where the others do", table.concat(misaligned, "; "), "")
        Expect(where .. ": ...at one column", distinct <= 1, true)
    end
end
---------------------------------------------------------------- the welcome window
-- The same boxes, cards and pictures as a settings page, in a scroller: nothing past a box's edges, and
-- the window no taller than the screen however much there is.
local Welcome = env.Welcome
Welcome:Build(); Welcome:Sync()
local welcome = Welcome.layout
local boxLeft, boxRight = welcome.left - BOX, welcome.left + welcome:Width() + BOX
Expect("the welcome's rows scroll, as a settings page's do", welcome.parent.layoutScroller == Welcome.scroller, true)
local outside = {}
for _, item in ipairs(welcome.items) do
    if item.kind == "section" and item.shown then
        for _, row in ipairs(item.rows) do
            if row.shown then Escapes(welcome, row, boxLeft, boxRight, outside) end
        end
    end
end
Expect("...and nothing in them runs past their edges", table.concat(outside, "; "), "")
local cut = {}
CutOff(Welcome.frame, cut)
Expect(LANG .. ": no text in the welcome window is cut off", table.concat(cut, "; "), "")
Expect("...nor does the window run off the screen at the default UI scale", Welcome.frame.height < 768, true)

Expect("nothing went wrong in a callback", #env.Callbacks.errors, 0)

print(Failures() == 0 and "settings_fit_test: ok" or "settings_fit_test: FAILED")
os.exit(Failures() == 0 and 0 or 1)
