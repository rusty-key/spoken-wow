-- The settings layout every Spoken addon builds its panel with.
--
-- BYTE-IDENTICAL IN EVERY SPOKEN ADDON. A copy lives in SpokenPlayer, SpokenQuests,
-- SpokenZones and SpokenBooks, and the packaging tests assert the copies are the same file.
-- The addons cannot share a file at runtime -- each is installed on its own, and the player is
-- only an optional dependency of the others -- so they share it by carrying it, the way
-- vendored libraries do. Edit one copy and copy it over the others; do not edit in place.
--
-- Deliberately idiom-free: no setfenv, no addon table, no localisation. Every label and
-- every accessor is passed in, so the same file suits an addon that runs in a private
-- environment and one that does not.
--
-- Lua 5.0 rules, because this loads on 1.12: no `#`, no literal-string method calls.
--
-- A page is a list of items -- its header, its sections, and the rows in them -- recorded as
-- they are built and placed by Reflow, top to bottom. Placing them all in one pass is what lets
-- a row be hidden (ShowWhen) and everything under it close up, rather than leaving a hole.

local VERSION = 44

-- LibStub's contract, for LibStub's reason: several addons load this file and the newest
-- copy must win, whichever of them the client happens to load last.
if SpokenLayout and SpokenLayout.VERSION and SpokenLayout.VERSION >= VERSION then
    return
end

local format = string.format

local function Count(list)
    local n = 0
    for _ in ipairs(list) do
        n = n + 1
    end
    return n
end

-- One rhythm, kept here rather than at the call sites: the game's own settings list's, read from
-- its code (Blizzard_Settings_Shared: SettingsListTemplate, SettingsListSectionHeaderTemplate,
-- SettingsListElementTemplate and SettingsListElementMixin, the control mixins; wow-ui-source,
-- forever branch). A row is 26 tall and 9 from the next; its label starts 37 in, in the game's
-- gold; its control starts just left of the row's middle, the label stopping 85 short of it.
local ROW_HEIGHT = 26         -- SettingsListElementTemplate: 280 x 26
local ROW_GAP = 9             -- SettingsListMixin: the list view's spacing
local BUTTON_ROW = 26
local SECTION_HEIGHT = 45     -- SettingsListSectionHeaderTemplate
local SECTION_TITLE_X = 7     -- ...its title, GameFontHighlightLarge, at 7, -16
local SECTION_TITLE_Y = 16
local HEADER_HEIGHT = 50      -- SettingsListTemplate's Header: title at 7, -22, divider at -50
local HEADER_PAD = 10         -- the list's verticalPad under it
local LABEL_X = 37            -- SettingsListElementMixin: Text at indent + 37...
local LABEL_END = 85          -- ...to 85 short of the row's middle
local INDENT_STEP = 15        -- indentSize, and a child option's label is GameFontNormalSmall
local CONTROL_X = -80         -- a checkbox or a slider starts 80 left of the middle
local DROPDOWN_X = -48        -- a dropdown with its steppers, 48
local CHECKBOX_W, CHECKBOX_H = 30, 29   -- SettingsCheckboxTemplate
local SLIDER_WIDTH = 250      -- SettingsSliderControlMixin
local DROPDOWN_WIDTH = 220    -- SettingsDropdownControlMixin
local BUTTON_WIDTH = 200      -- SettingButtonControlTemplate
local BUTTON_HEIGHT = 22      -- UIPanelButtonTemplate
local BUTTON_GAP = 10         -- between buttons set side by side on one row
local DEFAULTS_WIDTH = 96     -- the header's Defaults button: 96 x 22, at -36, -16
local DIMMED = 0.5            -- how far a control that does nothing right now is faded
local PAGE_WIDTH = 420        -- the narrowest a page lays out at
local MAX_WIDTH = 2000
local RIGHT_MARGIN = 10       -- room for the scroll bar
local LABEL_PADDING = 24      -- room a button's end caps take either side of its label
local BOX_MARGIN = 0          -- the rows' own edges: frames a page draws itself line up with them
local GOLD = { 1, 0.82, 0 }      -- NORMAL_FONT_COLOR: a setting's name
local WHITE = { 1, 1, 1 }        -- HIGHLIGHT_FONT_COLOR: a page's and a section's title
local GREY = { 0.5, 0.5, 0.5 }   -- GameFontDisable: a setting greyed out

local Layout = { VERSION = VERSION }
Layout.__index = Layout

--- Widen a button to its label, never below `width`. The widths the panels ask for were
--- sized to the English labels, and a translation can run half as long again; a button
--- only ever grows rightward from its row's left edge, into the panel's empty side.
local function FitToLabel(button, width)
    local textWidth = button:GetTextWidth() or 0
    button:SetWidth(math.max(width, textWidth + LABEL_PADDING))
end

--- Render a slider's value. Passed to Slider; the default reads it as a percentage.
function Layout.Percent(value) return format("%d%%", value * 100) end
function Layout.Seconds(value) return format("%.1fs", value) end
function Layout.Number(value) return format("%d", math.floor(value + 0.5)) end

-- Where a font the game may not have falls back to one it does: 1.12 names fewer of them.
local function Font(name, fallback)
    if _G[name] then return name end
    return fallback
end

-- The tooltip a row shows anywhere along it: what it is, what it does, and -- greyed out --
-- why, under that. A control that does nothing, with no word on what would make it work,
-- reads as broken.
local function ShowTip(frame, title, body)
    local band = frame.layoutBand or (frame.layoutHit and frame.layoutHit.layoutBand)
    if band then band:Show() end
    if not body and not title then return end
    GameTooltip:SetOwner(frame, "ANCHOR_RIGHT")
    if title then
        GameTooltip:SetText(title)
    else
        GameTooltip:SetText(body, 1, 1, 1, 1, true)
    end
    if title and body then
        GameTooltip:AddLine(body, 1, 1, 1, true)
    end
    local reason = frame.layoutReason or (frame.layoutControl and frame.layoutControl.layoutReason)
    if reason then
        GameTooltip:AddLine(reason, 1, 0.5, 0.25, true)
    end
    -- What a click on it will do, for an option with no control of its own to say so.
    if frame.layoutHint then
        GameTooltip:AddLine(frame.layoutHint, 0.6, 0.6, 0.6, true)
    end
    GameTooltip:Show()
end

local function HideTip(frame)
    local band = frame.layoutBand or (frame.layoutHit and frame.layoutHit.layoutBand)
    if band then band:Hide() end
    GameTooltip:Hide()
end

-- 1.12 and 2.4.3 hand a script handler nothing: the frame is in `this` and its arguments in
-- `arg1` and `arg2`. This file has no environment, so its frames come from the client's own
-- CreateFrame and not a wrapper that would pass them on: every handler here is set through
-- Script or Hook, which do it themselves. Asked each time rather than once as the file loads,
-- so a test that switches clients after loading it gets the client it switched to. 1.12's
-- GetBuildInfo has no interface number at all.
local function Legacy()
    if WOW_PROJECT_ID ~= nil or not GetBuildInfo then return false end
    local _, _, _, interface = GetBuildInfo()
    return interface == nil or interface < 30000
end

local function Wrap(fn)
    if not fn or not Legacy() then return fn end
    return function() return fn(this, arg1, arg2) end
end

local function Script(frame, script, fn)
    frame:SetScript(script, Wrap(fn))
end

local function Hook(frame, script, fn)
    frame:HookScript(script, Wrap(fn))
end

-- Run `fn` after whatever `frame` already does on `script`, so a button's own hover face and a
-- row's tooltip can share one OnEnter. Two arguments, not `...`: 1.12 loads this file too.
local function Chain(frame, script, fn)
    local before = frame.GetScript and frame:GetScript(script)
    if before then
        Script(frame, script, function(a, b) before(a, b); fn(a, b) end)
    else
        Script(frame, script, fn)
    end
end

local function Tooltip(frame, title, body)
    -- A disabled button fires no OnEnter unless told to, and the reason is for exactly then.
    if frame.SetMotionScriptsWhileDisabled then
        frame:SetMotionScriptsWhileDisabled(true)
    end
    Chain(frame, "OnEnter", function(self) ShowTip(self, title, body) end)
    Chain(frame, "OnLeave", function(self) HideTip(self) end)
end

-- A flat rectangle in the page's own layers: a colour, not a texture file.
local function Flat(parent, layer, r, g, b, a)
    local texture = parent:CreateTexture(nil, layer)
    if texture.SetColorTexture then
        texture:SetColorTexture(r, g, b, a)
    else
        texture:SetTexture(r, g, b, a)
    end
    return texture
end

--------------------------------------------------------------------------------
-- The game's own art
--------------------------------------------------------------------------------
--
-- Every control is the game's own, as its settings draw them: the minimal checkbox, the slider
-- with steppers, the dropdown with steppers, the red panel button. A client without one of them
-- -- the legacy clients this file also loads on -- gets the classic template in its place.

local function HasAtlas(name)
    return C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(name) ~= nil or false
end

-- A texture on `frame` painted with `atlas` at its own size, or nil where the client has not got it.
local function AtlasTexture(frame, layer, atlas, useAtlasSize)
    if not HasAtlas(atlas) then return nil end
    local texture = frame:CreateTexture(nil, layer)
    texture:SetAtlas(atlas, useAtlasSize)
    texture.layoutAtlas = atlas
    return texture
end

-- The settings' own sounds: the checkbox's on and off, as the game's settings play them.
local function Sound(name)
    local kit = SOUNDKIT and SOUNDKIT[name]
    if kit and PlaySound then PlaySound(kit) end
end
local CLICK, ON, OFF, TICK = "IG_MAINMENU_OPTION_CHECKBOX_ON", "IG_MAINMENU_OPTION_CHECKBOX_ON",
    "IG_MAINMENU_OPTION_CHECKBOX_OFF", "U_CHAT_SCROLL_BUTTON"
Layout.Sound = Sound

Layout.BOX_MARGIN, Layout.RIGHT_MARGIN = BOX_MARGIN, RIGHT_MARGIN

-- Put a region at x, y from the page's top left, whatever it was anchored to before.
local function Put(region, parent, x, y)
    region:ClearAllPoints()
    region:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
end

--- A panel's rows, top-anchored and running downward from `top`.
function Layout.New(parent, x, top)
    local layout = setmetatable({ parent = parent, x = x, left = x, top = top, y = top, empty = true,
        entries = {}, dependent = {}, items = {}, lines = 0 }, Layout)
    -- The settings canvas has no width until the window lays it out, and a player can make
    -- the window wider: lay the page out again whenever its width changes.
    if parent.HookScript then
        Hook(parent, "OnSizeChanged", function()
            if layout.flowedWidth and layout.flowedWidth ~= layout:Width() then
                layout:Reflow()
                if layout.onResize then layout.onResize(layout.top - layout.y) end
            end
        end)
    end
    return layout
end

--- How wide the page's rows run: the canvas's width less its margins, never narrower than
--- the page was designed at, nor so wide that a row is hard to read across.
function Layout:Width()
    local available = self.parent.GetWidth and self.parent:GetWidth() or 0
    local width = (available or 0) - self.left - RIGHT_MARGIN
    if width < PAGE_WIDTH then return PAGE_WIDTH end
    if width > MAX_WIDTH then return MAX_WIDTH end
    return math.floor(width)
end

--- Remember a row for search: what it is called, what its tooltip says, and where it sits.
--- Every control below indexes itself, so a page is searchable by being built.
function Layout:Index(frame, label, tooltip)
    table.insert(self.entries, { frame = frame, label = label, tooltip = tooltip,
        section = self.section, page = self.page })
    return frame
end

-- The middle of a row, which the game's settings place every control against.
function Layout:Middle()
    return self.left + math.floor(self:Width() / 2)
end

-- Where a control starts, whatever the indent of its label: 80 left of the row's middle, as the
-- game's checkboxes and sliders do, so every control on a page starts in one column.
function Layout:Column()
    return self:Middle() + CONTROL_X
end

-- How wide a label at the page's left may run: to 85 short of the middle.
function Layout:LabelWidth()
    return self:Middle() - LABEL_END - (self.left + LABEL_X)
end

--- Record the row a control was given. A control may sit inside its row -- a slider's bar
--- hangs below its own label -- but never outside it.
function Layout:Row(frame, top, height)
    frame.layoutY, frame.layoutHeight = top, height
    return frame
end

--- Step the following rows in, for options that qualify the one above them, and back out.
--- Only the label moves: the control stays in the column every other control is in.
function Layout:Indent()
    self.x = self.x + INDENT_STEP
    return self
end

function Layout:Outdent()
    self.x = self.x - INDENT_STEP
    return self
end

--- Set the buttons that follow side by side, `count` to a line; Columns() goes back to one.
--- Anything else ends them itself, and so does the next section.
function Layout:Columns(count)
    if count and count > 1 then
        self.columns, self.slot = count, 0
    else
        self.columns, self.slot = nil, nil
    end
    return self
end

-- A row, recorded: how tall it is, what it holds, and `place(top, x)`, which puts it there.
-- `control` is the frame its layoutY is kept on. Rows on one line of columns share `line`.
function Layout:AddRow(height, control, regions, place)
    self.empty = false
    local line
    if self.columns then
        self.slot = (self.slot or 0) + 1
        if self.slot > self.columns or self.slot == 1 then
            self.slot = 1
            self.lines = self.lines + 1
        end
        line = self.lines
    else
        self.lines = self.lines + 1
        line = self.lines
    end
    local row = { kind = "row", height = height, control = control, regions = regions, place = place,
        x = self.x, line = line, columns = self.columns }
    if self.current then
        table.insert(self.current.rows, row)
    else
        table.insert(self.items, row)
    end
    control.layoutRow = row
    self.dirty = true
    return row
end

--- Show `row` -- the control a builder returned -- only while `applies()` is true. Hidden, it
--- takes no space, and a section left with nothing showing hides with it.
function Layout:ShowWhen(control, applies)
    local row = control.layoutRow
    if row then
        row.conditions = row.conditions or {}
        table.insert(row.conditions, applies)
    end
    self.dirty = true
    return control
end

local function Visible(row)
    for _, applies in ipairs(row.conditions or {}) do
        if not applies() then return false end
    end
    return true
end

local function ShowRegions(row, shown)
    for _, region in ipairs(row.regions) do
        if shown then region:Show() else region:Hide() end
    end
end

-- Lay a run of rows out from `y`, lines of columns side by side, and hand back where the run
-- ended: the bottom of its last row.
local function PlaceRows(layout, rows, y)
    local bottom = y
    local currentLine, slot, lineTop, lineHeight
    for _, row in ipairs(rows) do
        local shown = Visible(row)
        row.shown = shown
        ShowRegions(row, shown)
        if shown then
            if row.measure then row.height = row.measure() end
            if row.columns and row.line == currentLine and slot < row.columns then
                slot = slot + 1
                if row.height > lineHeight then lineHeight = row.height end
            else
                currentLine, slot, lineTop, lineHeight = row.line, 1, bottom, row.height
                if lineTop ~= y then lineTop = lineTop - ROW_GAP end
            end
            local line = {}
            if row.columns then
                for _, other in ipairs(rows) do
                    if other.line == row.line and Visible(other) then table.insert(line, other) end
                end
            end
            row.place(lineTop, row.x + (slot - 1) * math.floor(layout:Width() / 2), slot, row.columns and line or nil)
            row.control.layoutY, row.control.layoutHeight = lineTop, row.height
            -- A row of cards is one row holding several frames, and search lands on any of them.
            for _, member in ipairs(row.members or {}) do
                member.layoutY, member.layoutHeight = lineTop, row.height
            end
            bottom = lineTop - lineHeight
        end
    end
    return bottom
end

--- Place every item, top to bottom, closing up whatever is hidden. Called by Height and by
--- Refresh; nothing needs to call it after building.
function Layout:Reflow()
    self.flowedWidth = self:Width()
    local y = self.top
    local started = false
    local loose
    local function EndLoose(rows, top)
        local bottom = PlaceRows(self, rows, top)
        for _, row in ipairs(rows) do
            if row.shown then
                started = true
                return bottom
            end
        end
        return top
    end
    for _, item in ipairs(self.items) do
        if item.kind == "intro" then
            for _, region in ipairs(item.regions) do region:Show() end
            item.place(y)
            -- The game's header is its own frame at the canvas's top, the list 10 under it. Fixed
            -- over a scrolling page, the list's own top is already 2 under the divider.
            y = self.intro.fixed and -(HEADER_PAD - 2) or -(HEADER_HEIGHT + HEADER_PAD)
            if item.body then y = item.body(y) end
            started = false
        elseif item.kind == "header" then
            if self.headerHidden then
                for _, region in ipairs(item.regions or {}) do region:Hide() end
            else
                item.place(y)
                y = y - item.height - HEADER_PAD
            end
        elseif item.kind == "row" then
            -- Rows outside any section -- a page's search box, its status, its main switch --
            -- placed as one run, so they space like the rows in a box.
            loose = loose or {}
            table.insert(loose, item)
        else
            if loose then
                y = EndLoose(loose, y)
                loose = nil
            end
            local any = false
            for _, row in ipairs(item.rows) do
                if Visible(row) then any = true end
            end
            item.shown = any
            if not any then
                item.hide()
                for _, row in ipairs(item.rows) do ShowRegions(row, false); row.shown = false end
            else
                -- Each a list element, 9 from the one before: the section's title in its own 45,
                -- and its rows under it.
                if started then y = y - ROW_GAP end
                item.place(y)
                local rowsTop = y - item.band - (item.band > 0 and ROW_GAP or 0)
                local bottom = PlaceRows(self, item.rows, rowsTop)
                item.frame(rowsTop, bottom)
                y = bottom
                started = true
            end
        end
    end
    if loose then y = EndLoose(loose, y) end
    self.y = y
    self.dirty = false
    return y
end

--- Drop the page's title and description: a tab shows the page's name already.
function Layout:HideHeader()
    self.headerHidden = true
    self.dirty = true
end

--- How tall the panel has grown. For a scrolling host that must size its content.
function Layout:Height()
    self:Reflow()
    return self.top - self.y
end

--- The top of a page: its icon, its name, and one sentence saying what the page is for.
--- Neither is a row: the panel tests measure rows and sections, and a title is neither.
function Layout:Header(title, description, width, icon)
    local parent, left = self.parent, self.left
    local texture
    if icon then
        texture = parent:CreateTexture(nil, "ARTWORK")
        texture:SetWidth(40)
        texture:SetHeight(40)
        texture:SetTexture(icon)
        self.icon = texture
    end
    local textX = icon and 40 + 12 or 0
    local fs = parent:CreateFontString(nil, "ARTWORK", Font("GameFontHighlightHuge", "GameFontHighlightLarge"))
    fs:SetJustifyH("LEFT")
    fs:SetText(title)
    fs.layoutTitle = true
    self.page = title
    local line
    if description then
        -- Smaller and softer than the title, so the eye reads it as what the page is about
        -- rather than as one more setting.
        line = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
        line:SetJustifyH("LEFT")
        line:SetJustifyV("TOP")
        line:SetTextColor(0.78, 0.78, 0.78)
        line:SetHeight(32)
        line:SetText(description)
    end
    local height = 26 + (description and 32 or 0)
    if icon and height < 40 then height = 40 end
    local layout = self
    local regions = { fs }
    if texture then table.insert(regions, texture) end
    if line then table.insert(regions, line) end
    table.insert(self.items, { kind = "header", height = height, regions = regions, place = function(top)
        if texture then Put(texture, parent, left, top) end
        Put(fs, parent, left + textX, top - 2)
        if line then
            line:SetWidth(width or (layout:Width() - textX))
            Put(line, parent, left + textX, top - 26)
        end
    end })
    self.dirty = true
    return fs
end

-- The game's own settings divider (SettingsListSectionHeader), faded at both ends, where the
-- client has it; a faint gold line where it does not.
local DIVIDER_ATLAS = "Options_HorizontalDivider"
local function Rule(parent)
    local rule = parent:CreateTexture(nil, "ARTWORK")
    local info = C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(DIVIDER_ATLAS)
    if info and rule.SetAtlas then
        -- At its own size, as the game's header draws it (useAtlasSize).
        rule:SetAtlas(DIVIDER_ATLAS, true)
        rule:SetHeight(info.height or 2)
        rule.layoutAtlas = DIVIDER_ATLAS
    else
        if rule.SetColorTexture then rule:SetColorTexture(GOLD[1], GOLD[2], GOLD[3], 0.3) end
        rule:SetHeight(1)
    end
    return rule
end

--- A new section: its title in the game's section header -- GameFontHighlightLarge, white, 7 in
--- and 16 down in a 45-tall element -- and its rows under it, as the game's settings lay a page
--- out. `plain` is a section of cards, laid out the same way.
function Layout:Section(text, plain)
    self:Columns(nil)
    self.section = text
    local parent, left = self.parent, self.left
    local fs
    if text then
        fs = parent:CreateFontString(nil, "ARTWORK", Font("GameFontHighlightLarge", "GameFontNormalLarge"))
        fs:SetJustifyH("LEFT")
        fs:SetJustifyV("TOP")
        fs:SetTextColor(WHITE[1], WHITE[2], WHITE[3])
        fs:SetText(text)
        fs.layoutHeading, fs.layoutHeight = true, SECTION_HEIGHT
    end
    local layout = self
    local section = { kind = "section", text = text, rows = {}, heading = fs,
        band = text and SECTION_HEIGHT or 0, plain = plain }
    section.place = function(top)
        if fs then
            fs:Show()
            Put(fs, parent, left + SECTION_TITLE_X, top - SECTION_TITLE_Y)
            fs.layoutY = top
        end
    end
    section.frame = function(top, bottom)
        -- Where its rows start and end, read back as a box's would be.
        section.top, section.bottom = top, bottom
    end
    section.hide = function()
        if fs then fs:Hide() end
    end
    table.insert(self.items, section)
    self.current = section
    self.empty = false
    self.dirty = true
    -- Kept, so a test or a preview can ask where each section's rows ended up.
    self.boxes = self.boxes or {}
    if not plain then
        local record = { section = section }
        setmetatable(record, { __index = function(_, key)
            if key == "left" then return left end
            if key == "top" then return section.top end
            if key == "bottom" then return section.bottom end
            if key == "width" then return layout:Width() end
            if key == "shown" then return section.shown end
        end })
        table.insert(self.boxes, record)
    end
    return fs
end

-- A row's hover: the game's HoverBackground, white at a tenth, from 10 left of the row to 5 short
-- of its right, shown while the pointer is on the row -- and the frame that shows the row's
-- tooltip there. Clicking it does what clicking the control would, when there is one thing to
-- click.
local function Band(parent, height)
    local hit = CreateFrame("Button", nil, parent)
    hit:SetHeight(height)
    local band = Flat(hit, "BACKGROUND", 1, 1, 1, 0.1)
    band:SetPoint("TOPLEFT", hit, "TOPLEFT", -10, 0)
    band:SetPoint("BOTTOMRIGHT", hit, "BOTTOMRIGHT", -5, 0)
    band:Hide()
    hit.layoutBand = band
    local level = parent.GetFrameLevel and parent:GetFrameLevel() or 1
    if hit.SetFrameLevel then hit:SetFrameLevel(level + 1) end
    return hit
end

-- Put a row's band across the row.
local function PlaceBand(layout, hit, top)
    hit:SetWidth(layout:Width())
    Put(hit, layout.parent, layout.left, top)
end

-- A checkbox: the game's settings checkbox (SettingsCheckboxTemplate), 30 by 29 -- the minimal
-- box and its tick, and the greyed tick for one switched off -- or the classic template where
-- the client has not got the atlases. `size` is the classic one's.
local function NewCheck(parent, size)
    if not HasAtlas("checkbox-minimal") then
        local box = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
        box:SetSize(size or 26, size or 26)
        box.layoutSize = size or 26
        return box
    end
    local box = CreateFrame("CheckButton", nil, parent)
    box:SetSize(CHECKBOX_W, CHECKBOX_H)
    box.layoutSize = CHECKBOX_W
    box:SetNormalTexture(AtlasTexture(box, "ARTWORK", "checkbox-minimal", true))
    box:SetPushedTexture(AtlasTexture(box, "ARTWORK", "checkbox-minimal", true))
    box:SetCheckedTexture(AtlasTexture(box, "OVERLAY", "checkmark-minimal", true))
    local greyed = AtlasTexture(box, "OVERLAY", "checkmark-minimal-disabled", true)
    if greyed then box:SetDisabledCheckedTexture(greyed) end
    return box
end

Layout.NewCheck = NewCheck

-- A control's level: above its row's band, so the band never takes its clicks.
local function Above(frame, parent)
    local level = parent.GetFrameLevel and parent:GetFrameLevel() or 1
    if frame.SetFrameLevel then frame:SetFrameLevel(level + 2) end
end

--- A button: the game's red panel button (UIPanelButtonTemplate).
local function NewButton(parent, label)
    local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    button:SetHeight(BUTTON_HEIGHT)
    button:SetText(label)
    return button
end
Layout.NewButton = NewButton

--- A setting's name: the game's gold, GameFontNormal, or GameFontNormalSmall for an option
--- under another (SettingsListElementMixin).
local function Caption(parent, text)
    local fs = parent:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    fs:SetHeight(ROW_HEIGHT)
    fs:SetJustifyH("LEFT")
    fs:SetJustifyV("MIDDLE")
    if fs.SetWordWrap then fs:SetWordWrap(false) end
    fs:SetText(text)
    fs.layoutColor = GOLD
    return fs
end

-- Put a row's label where the game's settings put it: 37 in, 15 more for each indent, running to
-- 85 short of the row's middle; small for an option under another.
local function PlaceLabel(layout, caption, x, top)
    local start = x + LABEL_X
    -- The font object itself: the legacy clients take no font by its name here.
    local font = x > layout.left and "GameFontNormalSmall" or "GameFontNormal"
    caption:SetFontObject(_G[font] or font)
    caption:SetWidth(math.max(40, layout:Middle() - LABEL_END - start))
    Put(caption, layout.parent, start, top)
end

--- Grey `row` out whenever `applies()` is false, and add `reason` to its tooltip, so a
--- player can see what to change first. A row may carry several; the first that fails is
--- the one it explains. Refresh re-tests them all.
function Layout:Requires(row, applies, reason)
    if not row.layoutConditions then
        row.layoutConditions = {}
        table.insert(self.dependent, row)
    end
    table.insert(row.layoutConditions, { applies = applies, reason = reason })
    return row
end

--- Grey out every row on the page but `except` -- a module's own switch -- while `applies()`
--- is false: settings, buttons, notes, voice packs, all of it. A module switched off is off.
-- Every row on the page, in or out of a section, handed to `fn`.
local function EachRow(layout, fn)
    for _, item in ipairs(layout.items) do
        if item.kind == "row" then
            fn(item)
        elseif item.rows then
            for _, row in ipairs(item.rows) do fn(row) end
        end
    end
end

function Layout:RequiresAll(applies, reason, except)
    EachRow(self, function(row)
        local control = row.control
        if control and control ~= except and not control.layoutCard then
            self:Requires(control, applies, reason)
        end
    end)
    -- The header's Defaults too: there is nothing on the page to put back.
    if self.defaults then self:Requires(self.defaults, applies, reason) end
end

local function Fade(row, alpha)
    -- A note keeps its own half strength, and greys from there.
    row:SetAlpha(alpha * (row.layoutBaseAlpha or 1))
    -- A setting's name in the game's grey while it does nothing, as the game's settings do.
    local label = row.layoutLabel
    if label then
        local color = alpha < 1 and GREY or label.layoutColor or GOLD
        label:SetTextColor(color[1], color[2], color[3])
        label.layoutGreyed = alpha < 1
    end
    if row.layoutValue then row.layoutValue:SetAlpha(alpha) end
    -- A voice pack's Download button, while it is the one showing.
    if row.layoutButton and row.layoutGet then row.layoutButton:SetAlpha(alpha) end
end

function Layout:Refresh()
    -- Cards, tiles and status lines redraw themselves from their settings first.
    for _, update in ipairs(self.updaters or {}) do update() end
    -- Then every control reads its setting again. Each does on OnShow too, but the client fires
    -- no OnShow for a page already showing, so after the page's Defaults, or a profile switched
    -- or copied on Spoken's page, the controls would go on showing the values from before.
    EachRow(self, function(row)
        local sync = row.control and row.control.layoutSync
        if sync then sync() end
    end)
    for _, row in ipairs(self.dependent) do
        local reason
        for _, condition in ipairs(row.layoutConditions) do
            if not condition.applies() then
                reason = condition.reason or ""
                break
            end
        end
        row.layoutReason = reason ~= "" and reason or nil
        Fade(row, reason and DIMMED or 1)
        if row.layoutButton then
            if reason then row.layoutButton:Disable() else row.layoutButton:Enable() end
        end
        if row.layoutSetEnabled then
            row.layoutSetEnabled(not reason)
        elseif row.layoutDropdown then
            if reason and UIDropDownMenu_DisableDropDown then
                UIDropDownMenu_DisableDropDown(row)
            elseif not reason and UIDropDownMenu_EnableDropDown then
                UIDropDownMenu_EnableDropDown(row)
            end
        elseif reason and row.Disable then
            row:Disable()
        elseif not reason and row.Enable then
            row:Enable()
        end
    end
    -- A group whose every setting is greyed out -- a module switched off -- greys its title too.
    for _, item in ipairs(self.items) do
        if item.kind == "section" and item.heading then
            local any, live = false, false
            for _, row in ipairs(item.rows) do
                local control = row.control
                if control and control.layoutConditions then
                    any = true
                    if not control.layoutReason then live = true end
                end
            end
            local grey = any and not live
            local color = grey and GREY or WHITE
            item.heading:SetTextColor(color[1], color[2], color[3])
            item.greyed = grey
        end
    end
    -- What is shown may have changed with the settings: lay the page out again, and let the
    -- page resize its scroller to what is left.
    self:Reflow()
    if self.onResize then self.onResize(self.top - self.y) end
end

--- Draw the eye to one row, after a search lands on it: a gold wash behind the whole row
--- that fades over two seconds.
function Layout:Highlight(row)
    local glow = self.glow
    if not glow then
        glow = CreateFrame("Frame", nil, self.parent)
        glow.texture = glow:CreateTexture(nil, "BACKGROUND")
        glow.texture:SetAllPoints()
        if glow.texture.SetColorTexture then glow.texture:SetColorTexture(1, 0.82, 0, 1) end
        Script(glow, "OnUpdate", function(frame, elapsed)
            frame.left = frame.left - (elapsed or arg1 or 0)
            if frame.left <= 0 then
                frame:Hide()
                return
            end
            frame:SetAlpha(0.35 * frame.left / 2)
        end)
        self.glow = glow
    end
    glow:ClearAllPoints()
    glow:SetPoint("TOPLEFT", self.parent, "TOPLEFT", self.left - 10, (row.layoutY or 0) + 4)
    glow:SetWidth(self:Width() + 15)
    glow:SetHeight((row.layoutHeight or ROW_HEIGHT) + 8)
    glow.left = 2
    glow:SetAlpha(0.35)
    glow:Show()
end

-- One popup each for every panel that loads this file, so the names are the file's own.
-- The callback lives here rather than on the dialog: how a dialog hands its data back to
-- OnAccept differs across the clients this file loads on.
local pendingAccept

--- Ask before doing something that cannot be undone. `accept` runs on the first button.
function Layout.Confirm(question, acceptLabel, cancelLabel, accept)
    if not (StaticPopupDialogs and StaticPopup_Show) then
        accept()
        return
    end
    StaticPopupDialogs.SPOKEN_LAYOUT_CONFIRM = {
        text = "%s", button1 = acceptLabel, button2 = cancelLabel,
        OnAccept = function()
            local run = pendingAccept
            pendingAccept = nil
            if run then run() end
        end,
        OnCancel = function() pendingAccept = nil end,
        timeout = 0, whileDead = 1, hideOnEscape = 1,
    }
    pendingAccept = accept
    StaticPopup_Show("SPOKEN_LAYOUT_CONFIRM", question)
end

--- A change that takes effect only after a reload: say so, and offer to do it now.
function Layout.AskReload(message, reloadLabel, laterLabel)
    Layout.Confirm(message, reloadLabel, laterLabel, function() ReloadUI() end)
end

--- Prose, not a setting: wraps to `width`, and occupies a row like anything else.
function Layout:Note(text, width, height)
    height = height or 28
    self:Columns(nil)
    local parent = self.parent
    local fs = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    fs:SetJustifyH("LEFT")
    fs:SetJustifyV("TOP")
    fs:SetAlpha(0.7)
    fs.layoutBaseAlpha = 0.7
    fs:SetText(text)
    self:AddRow(height, fs, { fs }, function(top, x)
        local room = self.left + self:Width() - (x + LABEL_X)
        fs:SetWidth(math.min(width or room, room))
        Put(fs, parent, x + LABEL_X, top - 4)
    end)
    return fs
end

function Layout:Checkbox(label, tooltip, read, write, apply)
    self:Columns(nil)
    local parent = self.parent
    local hit = Band(parent, ROW_HEIGHT)
    local box = NewCheck(parent)
    Above(box, parent)
    box.text = Caption(parent, label)
    -- Greyed with the box when the box is (Fade), as every control's label is.
    box.layoutLabel = box.text
    Script(box, "OnShow", function(self) self:SetChecked(read() and true or false) end)
    Script(box, "OnClick", function(self)
        Sound(self:GetChecked() and ON or OFF)
        write(self:GetChecked() and true or false)
        if apply then apply() end
    end)
    box:SetChecked(read() and true or false)
    box.layoutRead = read
    box.layoutSync = function() box:SetChecked(read() and true or false) end
    -- Anywhere on the row ticks it, not just the box.
    Script(hit, "OnClick", function()
        if box:IsEnabled() and box.Click then box:Click() end
    end)
    hit.layoutControl, box.layoutHit = box, hit
    Tooltip(box, label, tooltip)
    Tooltip(hit, label, tooltip)
    self:Index(box, label, tooltip)
    self:AddRow(ROW_HEIGHT, box, { hit, box, box.text }, function(top, x)
        PlaceBand(self, hit, top)
        PlaceLabel(self, box.text, x, top)
        local column = self:Column()
        Put(box, parent, column, top - math.floor((ROW_HEIGHT - box:GetHeight()) / 2))
        box.layoutColumn = column
    end)
    return box
end

--- A slider: the game's slider with steppers (MinimalSliderWithSteppersTemplate), 250 wide and
--- 80 left of the row's middle, its value on its right, as the game's settings have it. The
--- classic slider where the client has not got it.
function Layout:Slider(label, minValue, maxValue, step, read, write, apply, show, tooltip)
    show = show or Layout.Percent
    self:Columns(nil)
    local parent = self.parent
    local hit = Band(parent, ROW_HEIGHT)
    local caption = Caption(parent, label)
    local function Take(current)
        current = math.floor(current / step + 0.5) * step
        if math.abs(current - read()) >= step / 2 then
            write(current)
            if apply then apply() end
        end
        return current
    end

    local frame, slider, value, setEnabled, sync
    local ok, made = pcall(CreateFrame, "Frame", nil, parent, "MinimalSliderWithSteppersTemplate")
    if ok and made and made.Init and MinimalSliderWithSteppersMixin and made.RegisterCallback then
        frame = made
        frame:SetWidth(SLIDER_WIDTH)
        local formatters = {}
        local labels = MinimalSliderWithSteppersMixin.Label
        if labels then formatters[labels.Right] = function(current) return show(current) end end
        frame:Init(read(), minValue, maxValue, math.floor((maxValue - minValue) / step + 0.5), formatters)
        frame:RegisterCallback(MinimalSliderWithSteppersMixin.Event.OnValueChanged,
            function(_, current) Take(current) end, frame)
        sync = function() frame:SetValue(read()) end
        Hook(frame, "OnShow", sync)
        slider = frame.Slider
        setEnabled = function(on) frame:SetEnabled(on) end
    else
        frame = CreateFrame("Frame", nil, parent)
        frame:SetWidth(SLIDER_WIDTH)
        frame:SetHeight(20)
        -- OptionsSliderTemplate is the legacy clients' name for it; WOW_PROJECT_ID exists on
        -- every client that calls it UISliderTemplate.
        local template = WOW_PROJECT_ID == nil and "OptionsSliderTemplate" or "UISliderTemplate"
        slider = CreateFrame("Slider", nil, frame, template)
        -- Both load-bearing: a slider given neither draws nothing at all.
        slider:SetHeight(16)
        slider:SetWidth(SLIDER_WIDTH - 50)
        slider:SetOrientation("HORIZONTAL")
        slider:SetPoint("LEFT", frame, "LEFT", 0, 0)
        slider:SetMinMaxValues(minValue, maxValue)
        slider:SetValueStep(step)
        if slider.SetObeyStepOnDrag then slider:SetObeyStepOnDrag(true) end
        value = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
        value:SetPoint("LEFT", slider, "RIGHT", 10, 0)
        value:SetText(show(read()))
        Script(slider, "OnValueChanged", function(_, current) value:SetText(show(Take(current))) end)
        slider:SetValue(read())
        sync = function()
            slider:SetValue(read())
            value:SetText(show(read()))
        end
        Script(frame, "OnShow", sync)
        -- A slider has no SetEnabled on 2.4.3 and 3.3.5, and Refresh calls this for every slider
        -- with a Requires: Enable and Disable where it has those, and where it has neither, it
        -- at least stops taking the mouse.
        setEnabled = function(on)
            if slider.SetEnabled then
                slider:SetEnabled(on)
            elseif slider.Enable and slider.Disable then
                if on then slider:Enable() else slider:Disable() end
            elseif slider.EnableMouse then
                slider:EnableMouse(on and true or false)
            end
        end
    end
    frame.layoutSync = sync
    Above(frame, parent)
    -- Its range and its setting, for a test to drive it as a player would.
    frame.layoutSlider, frame.layoutRange, frame.layoutRead = slider, { minValue, maxValue, step }, read
    frame.layoutSetEnabled = setEnabled
    frame.layoutLabel, frame.layoutValue = caption, value
    hit.layoutControl, frame.layoutHit, slider.layoutHit = frame, hit, hit
    Tooltip(hit, label, tooltip)
    Tooltip(frame, label, tooltip)
    Tooltip(slider, label, tooltip)
    self:Index(frame, label, tooltip)
    self:AddRow(ROW_HEIGHT, frame, { hit, frame, caption }, function(top, x)
        PlaceBand(self, hit, top)
        PlaceLabel(self, caption, x, top)
        local column = self:Column()
        Put(frame, parent, column, top - math.floor((ROW_HEIGHT - (frame:GetHeight() or 20)) / 2) + 3)
        frame.layoutColumn = column
    end)
    return frame
end

local function Resolve(values)
    if type(values) == "function" then
        return values()
    end
    return values
end

--- A button that cycles through `values`, for a client with no dropdown to offer. What it
--- shows and what it compares are both `describe(value)`, so it can always find where in
--- the list it currently is; comparing a label against a value is how a cycle sticks.
function Layout:Cycle(label, tooltip, values, read, write, apply, describe)
    describe = describe or tostring
    self:Columns(nil)
    local parent = self.parent
    local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    button:SetSize(240, BUTTON_HEIGHT)
    local function Sync()
        button:SetText(format(label, describe(read())))
        FitToLabel(button, math.max(240, BUTTON_WIDTH))
    end
    Script(button, "OnClick", function()
        local list = Resolve(values)
        local count = Count(list)
        if count == 0 then
            return
        end
        local index = 1
        for i = 1, count do
            if list[i] == read() then
                index = i
                break
            end
        end
        -- Not math.mod: 1.12's Lua has it, LuaJIT does not, and the harness runs on
        -- LuaJIT. Plain arithmetic is the same wrap on every one of them.
        local following = index + 1
        if following > count then
            following = 1
        end
        write(list[following])
        if apply then apply() end
        Sync()
    end)
    Script(button, "OnShow", Sync)
    button.layoutSync = Sync
    Tooltip(button, nil, tooltip)
    self:Index(button, label, tooltip)
    Sync()
    self:AddRow(BUTTON_ROW, button, { button }, function(top, x)
        Put(button, parent, x + LABEL_X, top - (BUTTON_ROW - BUTTON_HEIGHT) / 2)
    end)
    return button
end

local dropdowns = 0

--- A dropdown: the game's settings dropdown, with steppers either side (SettingsDropdownWithButtons
--- Template, the dropdown 220 wide, 48 left of the row's middle), its list the game's own menu.
--- The plain dropdown where the steppers are missing, the classic one where the menu is, and a
--- cycle button where there is no dropdown at all. The list may be a function, for a choice
--- whose options depend on what is installed.
function Layout:Dropdown(label, tooltip, values, read, write, apply, describe)
    describe = describe or tostring
    local modern = CreateFrame and MenuUtil ~= nil
    if not modern and not (UIDropDownMenu_Initialize and UIDropDownMenu_AddButton and CreateFrame) then
        return self:Cycle(label .. ": %s", tooltip, values, read, write, apply, describe)
    end
    self:Columns(nil)
    local parent = self.parent
    local hit = Band(parent, ROW_HEIGHT)
    local caption = Caption(parent, label)

    local control, dropdown, Sync, setEnabled, offset
    local function Choose(value)
        write(value)
        if apply then apply() end
        Sync()
    end
    if modern then
        local ok, made = pcall(CreateFrame, "Frame", nil, parent, "SettingsDropdownWithButtonsTemplate")
        if ok and made and made.Dropdown and made.Dropdown.SetupMenu then
            control, dropdown, offset = made, made.Dropdown, DROPDOWN_X
        else
            ok, made = pcall(CreateFrame, "DropdownButton", nil, parent, "WowStyle1DropdownTemplate")
            if ok and made and made.SetupMenu then control, dropdown, offset = made, made, CONTROL_X end
        end
    end
    if dropdown then
        dropdown:SetWidth(DROPDOWN_WIDTH)
        -- Compared by what it says: a list built afresh each time hands back an equal entry, not
        -- the same table.
        dropdown:SetupMenu(function(_, root)
            for _, value in ipairs(Resolve(values)) do
                root:CreateRadio(describe(value), function() return describe(read()) == describe(value) end,
                    function() Choose(value) end, value)
            end
        end)
        Sync = function() if dropdown.GenerateMenu then dropdown:GenerateMenu() end end
        setEnabled = function(on)
            if control.SetEnabled then control:SetEnabled(on) else dropdown:SetEnabled(on) end
        end
    else
        dropdowns = dropdowns + 1
        control = CreateFrame("Frame", "SpokenLayoutDropdown" .. dropdowns, parent, "UIDropDownMenuTemplate")
        offset = CONTROL_X - 16
        Sync = function() UIDropDownMenu_SetText(control, describe(read())) end
        UIDropDownMenu_Initialize(control, function(_, level)
            local current = read()
            for _, value in ipairs(Resolve(values)) do
                local info = UIDropDownMenu_CreateInfo()
                info.text = describe(value)
                info.checked = describe(value) == describe(current)
                info.func = function()
                    Choose(value)
                    if CloseDropDownMenus then CloseDropDownMenus() end
                end
                UIDropDownMenu_AddButton(info, level)
            end
        end)
        if UIDropDownMenu_SetWidth then UIDropDownMenu_SetWidth(control, DROPDOWN_WIDTH - 40) end
        control.layoutDropdown = true
    end
    Above(control, parent)
    -- The game's dropdowns have an OnShow of their own to keep; the classic one has none.
    if dropdown then Hook(control, "OnShow", function() Sync() end) else Script(control, "OnShow", Sync) end
    -- What a choice in its list does, and what it offers, for a test to drive it as a player would.
    control.layoutChoose, control.layoutValues, control.layoutRead = Choose, values, read
    control.layoutSync = Sync
    control.layoutSetEnabled = setEnabled
    control.layoutLabel = caption
    hit.layoutControl, control.layoutHit = control, hit
    Tooltip(hit, label, tooltip)
    self:Index(control, label, tooltip)
    Sync()
    self:AddRow(ROW_HEIGHT, control, { hit, control, caption }, function(top, x)
        PlaceBand(self, hit, top)
        PlaceLabel(self, caption, x, top)
        local start = self:Middle() + offset
        Put(control, parent, start, top - math.floor((ROW_HEIGHT - (control:GetHeight() or 26)) / 2) + 3)
        control.layoutColumn = self:Column()
    end)
    return control
end

--- A button, as the game's settings place one that names its own action: at the label's start,
--- 200 wide (SettingButtonControlMixin), the red panel button. Several set side by side with
--- Columns run on from there, 10 apart.
function Layout:Button(label, width, onClick, tooltip)
    local parent = self.parent
    local button = NewButton(parent, label)
    FitToLabel(button, math.max(width or 0, BUTTON_WIDTH))
    button.layoutNatural = button:GetWidth()
    Script(button, "OnClick", onClick)
    Above(button, parent)
    Tooltip(button, label, tooltip)
    self:Index(button, label, tooltip)
    self:AddRow(BUTTON_ROW, button, { button }, function(top, x, slot, line)
        local start = self.left + LABEL_X
        local width = button.layoutNatural
        if line then
            local widths = self:LineWidths(line)
            width = widths[slot or 1]
            for index = 1, (slot or 1) - 1 do start = start + widths[index] + BUTTON_GAP end
        end
        button:SetWidth(width)
        Put(button, parent, start, top - math.floor((BUTTON_ROW - BUTTON_HEIGHT) / 2))
    end)
    return button
end

--- The widths of a line of buttons side by side: each its own, but never so wide together that
--- the line runs past the row.
function Layout:LineWidths(line)
    local count = Count(line)
    local room = self.left + self:Width() - (self.left + LABEL_X) - BUTTON_GAP * (count - 1)
    local widths, total = {}, 0
    for index, row in ipairs(line) do
        widths[index] = row.control.layoutNatural or BUTTON_WIDTH
        total = total + widths[index]
    end
    if total > room then
        local each = math.floor(room / count)
        for index = 1, count do widths[index] = each end
    end
    return widths
end

--- A control this file does not build: placed in a row of its own, at `height`. `fit(width)`,
--- when given, sizes it to the page each time it is placed; `frame.layoutReach` lets it reach
--- out past the rows to the boxes' edges, as the search box does.
function Layout:Custom(frame, height, fit)
    self:Columns(nil)
    local parent = self.parent
    self:AddRow(height, frame, { frame }, function(top, x)
        local reach = frame.layoutReach or 0
        if fit then fit(self:Width() + reach * 2) end
        Put(frame, parent, x - reach, top)
    end)
    return frame
end

--------------------------------------------------------------------------------
-- Cards, tiles and status lines
--------------------------------------------------------------------------------
--
-- For the choices a page is really about, where a column of switches would bury them: the
-- modules, and the narrator's style. Each option is a card of its own, in the game's tooltip
-- border, three to a line under the section's title, the row as wide as the rows below. The
-- chosen or enabled cards stand at full strength, gold round them, with a faint wash; the rest
-- stand back at lower opacity and come forward under the pointer. Everything on a card is drawn
-- with what the rest of the page uses: the game's checkbox and red button, a dark screen round
-- a picture.

local CARD_GAP = 10           -- between cards
local CARD_PAD = 12            -- inside a card, in whole pixels so its edges line up
local DIM = 0.55              -- a card neither chosen nor enabled
local DIM_OVER = 0.85         -- ...under the pointer
local DIM_OFF = 0.4           -- one that cannot be had: a module not installed
local SKETCH_WIDTH = 110      -- a narrator style's sketch, drawn at this size, scaled to its screen
local SKETCH_HEIGHT = 58
local SCREEN_HEIGHT = 66      -- the small dark screen a style's sketch is shown in
local ICON_FRAME = 44         -- a module's icon in the input field's frame, as a sketch is in its screen,
local CARD_ICON = ICON_FRAME - 6  -- ...reaching its rim, its corners rounded to sit inside it
local TITLE_GAP = 6           -- between a card's name and its words
local STATUS_HEIGHT = 32

--- A value where a setting's control would be: its words, and `value` after them, in the game's
--- white -- as "Voice Pack 2/4" on a card, or a voice pack's version. `Set(kind, text, value)`;
--- "muted" greys it, a nil kind leaves it empty. `clickable` makes it a button the game draws for
--- a key binding (UIMenuButtonStretchTemplate), as a key is set by clicking it.
local FIELD_HEIGHT = 22
local FIELD_WIDTH = BUTTON_WIDTH
local TAG_ALIASES = { ok = "good", warn = "bad", off = "muted", key = "neutral" }

local function NewBadge(parent, clickable)
    local badge
    if clickable then
        local ok, made = pcall(CreateFrame, "Button", nil, parent, "UIMenuButtonStretchTemplate")
        badge = ok and made or CreateFrame("Button", nil, parent)
        badge:SetWidth(FIELD_WIDTH)
    else
        badge = CreateFrame("Frame", nil, parent)
        badge:SetWidth(FIELD_WIDTH)
    end
    badge:SetHeight(FIELD_HEIGHT)
    local text = badge:CreateFontString(nil, "ARTWORK", clickable and "GameFontHighlightSmall" or "GameFontHighlight")
    text:SetJustifyH(clickable and "CENTER" or "LEFT")
    if text.SetWordWrap then text:SetWordWrap(false) end
    local count = badge:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    count:SetJustifyH("LEFT")
    if count.SetWordWrap then count:SetWordWrap(false) end
    function badge:Set(kind, message, value)
        kind = TAG_ALIASES[kind] or kind
        self.state, self.message, self.value = kind, message, value
        if not kind then
            self:SetAlpha(0)
            return
        end
        self:SetAlpha(1)
        -- The game's white, its grey for what is not there.
        local grey = kind == "muted" and 0.5 or 1
        text:SetTextColor(grey, grey, grey)
        text:SetText(message or "")
        count:SetTextColor(grey, grey, grey)
        count:SetText(value or "")
        text:ClearAllPoints()
        count:ClearAllPoints()
        if clickable then
            text:SetPoint("LEFT", badge, "LEFT", 8, 0)
            text:SetPoint("RIGHT", badge, "RIGHT", -8, 0)
        else
            text:SetPoint("LEFT", badge, "LEFT", 0, 0)
            count:SetPoint("LEFT", text, "RIGHT", 6, 0)
        end
    end
    badge.text, badge.count = text, count
    -- Read by the tests and the preview, as the status line it replaced.
    badge.layoutStatusLine = badge
    return badge
end
Layout.NewBadge = NewBadge

--- A count shown as a progress bar: its words on the left and the count on the right, on a line
--- over a thin bar filled as far as `value` ("1/4") goes, always in the game's gold. A status,
--- not a control: nothing about it says click. Drawn with the game's modern widget bar
--- (widgetstatusbar: its border, its background, its fill), else the Skills tab's bar
--- (common-stat-bar), else flat. `Set(kind, message, value)` as NewBadge's; `SetGreyed(on)`
--- turns it grey with its card's icon, as a module that is off.
local METER_BAR = 16          -- the bar, under its line of words
local METER_HEIGHT = 14 + 5 + METER_BAR
local METER_GOLD = { 1, 0.82, 0 }
local function NewMeter(parent)
    local meter = CreateFrame("Frame", nil, parent)
    meter:SetHeight(METER_HEIGHT)
    local text = meter:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    text:SetPoint("TOPLEFT", meter, "TOPLEFT", 0, 0)
    text:SetJustifyH("LEFT")
    if text.SetWordWrap then text:SetWordWrap(false) end
    local count = meter:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    count:SetPoint("TOPRIGHT", meter, "TOPRIGHT", 0, 0)
    count:SetJustifyH("RIGHT")
    text:SetPoint("RIGHT", count, "LEFT", -6, 0)

    -- The bar along the meter's foot.
    local bar = CreateFrame("Frame", nil, meter)
    bar:SetPoint("BOTTOMLEFT", meter, "BOTTOMLEFT", 0, 0)
    bar:SetPoint("BOTTOMRIGHT", meter, "BOTTOMRIGHT", 0, 0)
    local pieces, fill, inset = {}, nil, 0
    local function Keep(texture)
        if texture then table.insert(pieces, texture) end
        return texture
    end
    local yellow = HasAtlas("widgetstatusbar-fill-yellow")
    if HasAtlas("widgetstatusbar-bordercenter") and HasAtlas("widgetstatusbar-borderleft")
        and HasAtlas("widgetstatusbar-borderright") and (yellow or HasAtlas("widgetstatusbar-fill-white")) then
        -- As UIWidgetTemplateStatusBar lays it out -- the fill 8 inside the border's ends, the
        -- background 2 past the fill's -- scaled as a whole to METER_BAR tall: the art is drawn
        -- taller than a line under a card's words wants.
        local info = C_Texture.GetAtlasInfo("widgetstatusbar-bordercenter")
        local height = (info and info.height and info.height > 0) and info.height or METER_BAR
        local k = METER_BAR / height
        bar:SetHeight(METER_BAR)
        local left = Keep(AtlasTexture(bar, "OVERLAY", "widgetstatusbar-borderleft", false))
        local right = Keep(AtlasTexture(bar, "OVERLAY", "widgetstatusbar-borderright", false))
        local middle = Keep(AtlasTexture(bar, "OVERLAY", "widgetstatusbar-bordercenter", false))
        local function Width(atlas)
            local piece = C_Texture.GetAtlasInfo(atlas)
            return ((piece and piece.width) or 8) * k
        end
        left:SetSize(Width("widgetstatusbar-borderleft"), METER_BAR)
        right:SetSize(Width("widgetstatusbar-borderright"), METER_BAR)
        middle:SetHeight(METER_BAR)
        left:SetPoint("LEFT", bar, "LEFT", 0, 0)
        right:SetPoint("RIGHT", bar, "RIGHT", 0, 0)
        middle:SetPoint("LEFT", left, "RIGHT", 0, 0)
        middle:SetPoint("RIGHT", right, "LEFT", 0, 0)
        inset = 8 * k
        local back = Keep(AtlasTexture(bar, "BACKGROUND", "widgetstatusbar-bgcenter", false)
            or Flat(bar, "BACKGROUND", 0, 0, 0, 0.6))
        back:SetPoint("TOPLEFT", bar, "TOPLEFT", inset - 2 * k, -2 * k)
        back:SetPoint("BOTTOMRIGHT", bar, "BOTTOMRIGHT", -(inset - 2 * k), 2 * k)
        local fillAtlas = yellow and "widgetstatusbar-fill-yellow" or "widgetstatusbar-fill-white"
        fill = Keep(AtlasTexture(bar, "ARTWORK", fillAtlas, false))
        if not yellow then fill:SetVertexColor(METER_GOLD[1], METER_GOLD[2], METER_GOLD[3]) end
        local fillInfo = C_Texture.GetAtlasInfo(fillAtlas)
        fill:SetHeight(math.min((fillInfo and fillInfo.height) or 10, height - 4) * k)
        meter.look = "widget"
    elseif HasAtlas("common-stat-bar-BG") then
        bar:SetHeight(15)
        local back = Keep(AtlasTexture(bar, "BACKGROUND", "common-stat-bar-BG", false))
        back:SetAllPoints()
        fill = Keep(AtlasTexture(bar, "ARTWORK", "common-stat-bar-white", false) or Flat(bar, "ARTWORK", 1, 1, 1, 1))
        fill:SetVertexColor(METER_GOLD[1], METER_GOLD[2], METER_GOLD[3])
        fill:SetHeight(9)
        inset = 3
        meter.look = "stat"
    else
        bar:SetHeight(8)
        local back = Keep(Flat(bar, "BACKGROUND", 0, 0, 0, 0.6))
        back:SetAllPoints()
        fill = Keep(Flat(bar, "ARTWORK", 1, 1, 1, 1))
        fill:SetVertexColor(METER_GOLD[1], METER_GOLD[2], METER_GOLD[3])
        fill:SetHeight(6)
        inset = 1
        meter.look = "flat"
    end
    fill:SetPoint("LEFT", bar, "LEFT", inset, 0)

    local fraction = 0
    local function Fill()
        local room = (bar:GetWidth() or 0) - inset * 2
        fill:SetWidth(math.max(0.01, fraction * room))
        if meter.look ~= "flat" and fill.SetTexCoord then fill:SetTexCoord(0, math.max(0.01, fraction), 0, 1) end
        if fraction <= 0 then fill:Hide() else fill:Show() end
    end
    Script(bar, "OnSizeChanged", Fill)

    local greyed, muted = false, false
    local function Paint()
        local grey = (greyed or muted) and 0.5 or 1
        text:SetTextColor(grey, grey, grey)
        count:SetTextColor(grey, grey, grey)
        for _, texture in ipairs(pieces) do
            if texture.SetDesaturated then texture:SetDesaturated(greyed) end
        end
    end

    function meter:Set(kind, message, value)
        kind = TAG_ALIASES[kind] or kind
        self.state, self.message, self.value = kind, message, value
        if not kind then
            self:SetAlpha(0)
            return
        end
        self:SetAlpha(1)
        muted = kind == "muted"
        text:SetText(message or "")
        count:SetText(value or "")
        local _, _, have, total = string.find(value or "", "(%d+)%s*/%s*(%d+)")
        have, total = tonumber(have), tonumber(total)
        fraction = (have and total and total > 0) and math.min(1, have / total) or 0
        self.fraction = fraction
        Paint()
        Fill()
    end
    function meter:SetGreyed(on)
        greyed = on and true or false
        self.layoutGreyed = greyed
        Paint()
    end
    meter.text, meter.count, meter.bar, meter.fill = text, count, bar, fill
    meter.layoutStatusLine = meter
    meter.layoutMeter = true
    return meter
end
Layout.NewMeter = NewMeter

local function Updater(self, fn)
    self.updaters = self.updaters or {}
    table.insert(self.updaters, fn)
end

-- A card: the game's tooltip border round it, the same whatever its state. Chosen or enabled
-- (`layoutFaceOn`), it stands at full strength under the chosen tab's faint wash; otherwise it
-- stands back, and comes forward under the pointer. `layoutFaceOff` marks an option that cannot
-- be had (a module not installed), which stays furthest back and does not answer the pointer.
local function Card(parent)
    local template = BackdropTemplateMixin and "BackdropTemplate" or nil
    local card = CreateFrame("Button", nil, parent, template)
    -- The game's tooltip border and background, as the game's own cards are drawn; the wash a
    -- faint light inside it.
    if card.SetBackdrop then
        card:SetBackdrop({ bgFile = [[Interface\Tooltips\UI-Tooltip-Background]],
            edgeFile = [[Interface\Tooltips\UI-Tooltip-Border]], tile = true, tileSize = 16, edgeSize = 14,
            insets = { left = 4, right = 4, top = 4, bottom = 4 } })
        card:SetBackdropColor(0.06, 0.06, 0.06, 0.9)
    end
    local wash = Flat(card, "BORDER", 1, 1, 1, 0.05)
    wash:SetPoint("TOPLEFT", card, "TOPLEFT", 4, -4)
    wash:SetPoint("BOTTOMRIGHT", card, "BOTTOMRIGHT", -4, 4)
    local over = false
    -- Under the pointer, every card's wash comes up: a chosen one's from half strength to full,
    -- another's from nothing to half, as it comes forward.
    function card:Look()
        local off = self.layoutFaceOff
        if self.layoutFaceOn and not off then
            wash:Show()
            wash:SetAlpha(over and 1 or 0.5)
            self:SetAlpha(1)
        else
            if over and not off then wash:Show() else wash:Hide() end
            wash:SetAlpha(0.5)
            self:SetAlpha((off and DIM_OFF) or (over and DIM_OVER) or DIM)
        end
        self.layoutOver = over
        -- In the tooltip border: gold round what is chosen, lighter under the pointer.
        if self.SetBackdropBorderColor then
            if self.layoutFaceOn and not off then
                self:SetBackdropBorderColor(GOLD[1], GOLD[2], GOLD[3], 1)
            elseif over and not off then
                self:SetBackdropBorderColor(0.75, 0.75, 0.75, 1)
            else
                self:SetBackdropBorderColor(0.45, 0.45, 0.45, 1)
            end
        end
    end
    -- Still over the card while over its checkbox or its button, which take the pointer from
    -- it: the hover ends when the pointer leaves the card's bounds, not when it reaches a child.
    local function Inside() return card.IsMouseOver and card:IsMouseOver() end
    local function Leave()
        over = false
        Script(card, "OnUpdate", nil)
        card:Look()
    end
    Chain(card, "OnEnter", function()
        over = true
        card:Look()
        Script(card, "OnUpdate", function() if not Inside() then Leave() end end)
    end)
    Chain(card, "OnLeave", function() if not Inside() then Leave() end end)
    card.layoutWash = wash
    return card
end

-- A dark screen round a picture: a module's icon, a narrator style's sketch. Rimmed in the
-- game's tooltip edge, as the card round it is, thinner and in grey so the card's stays the
-- one that says what is chosen.
local function InputFrame(parent)
    local template = BackdropTemplateMixin and "BackdropTemplate" or nil
    local frame = CreateFrame("Frame", nil, parent, template)
    local backing = Flat(frame, "BACKGROUND", 0, 0, 0, 0.55)
    backing:SetPoint("TOPLEFT", frame, "TOPLEFT", 2, -2)
    backing:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -2, 2)
    if frame.SetBackdrop then
        frame:SetBackdrop({ edgeFile = [[Interface\Tooltips\UI-Tooltip-Border]], edgeSize = 10,
            insets = { left = 2, right = 2, top = 2, bottom = 2 } })
        frame:SetBackdropBorderColor(0.5, 0.5, 0.5, 1)
        frame.layoutRim = true
    end
    return frame
end

-- A card's name and the line about it.
local function Words(card, item, nameSize)
    local title = card:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    title:SetJustifyH("LEFT")
    if title.SetWordWrap then title:SetWordWrap(false) end
    title:SetText(item.title)
    local text = card:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    text:SetJustifyH("LEFT")
    text:SetJustifyV("TOP")
    text:SetTextColor(0.82, 0.82, 0.82)
    text:SetText(item.text)
    return title, text
end

-- Cards span the boxes' width, CARD_GAP apart.
local function CardWidth(layout, columns)
    return math.floor((layout:Width() + BOX_MARGIN * 2 - CARD_GAP * (columns - 1)) / columns)
end

-- How tall a font string is at the width it now has, or `fallback` where that is not known.
local function TextHeight(fs, fallback)
    local height = fs.GetStringHeight and fs:GetStringHeight()
    if not height or height <= 0 then return fallback end
    return height
end

-- Lay a line of cards out: each as wide as its share, and as tall as `head` (all above a card's
-- words), the tallest's words and `foot` (all under them) need.
local function PlaceCards(layout, cards, top, head, foot, fallback)
    local count = Count(cards)
    local width = CardWidth(layout, count)
    local tallest = 0
    for _, card in ipairs(cards) do
        card.text:SetWidth(width - CARD_PAD * 2)
        local height = TextHeight(card.text, fallback)
        if height > tallest then tallest = height end
    end
    local height = math.floor(CARD_PAD + head + tallest + foot + CARD_PAD + 0.5)
    if not top then return height end
    local left = layout.left - BOX_MARGIN
    for index, card in ipairs(cards) do
        card:SetWidth(width)
        card:SetHeight(height)
        card.text:SetWidth(width - CARD_PAD * 2)
        card.text:SetHeight(tallest)
        Put(card, layout.parent, left + (index - 1) * (width + CARD_GAP), top)
    end
    return height, width
end

--- The modules, a card each, side by side. An item is { icon, title, text, tooltip, read(),
--- write(on), apply(), disabled() -> reason or nil, status() -> kind, text, value, valueKind,
--- hint(on) -> text, button, onButton(), buttonEnabled() }. Its icon sits at its top left in the
--- input field's frame, its name beside it; the checkbox in its corner, or a click anywhere on
--- it, turns the module on or off; `status` is a value on the dropdown's face under its words;
--- the button along its foot opens the module's page. Off, the card stands back.
local MODULE_HEAD = ICON_FRAME + 10 + 16 + TITLE_GAP
local WORDS_ROOM = 8          -- under a card's words, before what follows them or its foot
function Layout:Cards(items)
    self:Columns(nil)
    local parent = self.parent
    local cards = {}
    local hasStatus, hasButton = false, false
    for _, item in ipairs(items) do
        local card = Card(parent)
        card.layoutCard = item
        local frame = InputFrame(card)
        frame:SetWidth(ICON_FRAME)
        frame:SetHeight(ICON_FRAME)
        frame:SetPoint("TOPLEFT", card, "TOPLEFT", CARD_PAD, -CARD_PAD)
        local icon = frame:CreateTexture(nil, "ARTWORK")
        icon:SetWidth(CARD_ICON)
        icon:SetHeight(CARD_ICON)
        icon:SetPoint("CENTER", frame, "CENTER", 0, 0)
        icon:SetTexture(item.icon)
        icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)

        -- Its name under its icon, as a style's is under its sketch: the full width to fit in.
        local title, text = Words(card, item, 14)
        title:SetPoint("TOPLEFT", frame, "BOTTOMLEFT", 0, -10)
        title:SetPoint("RIGHT", card, "RIGHT", -CARD_PAD, 0)
        text:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -TITLE_GAP)
        card.frame, card.icon, card.name, card.text = frame, icon, title, text

        -- The page's own checkbox, inside the card: its top level with the icon's frame, its
        -- right edge where the words end.
        local check = NewCheck(card, 26)
        check:SetPoint("TOPRIGHT", card, "TOPRIGHT", -CARD_PAD, -CARD_PAD)
        Script(check, "OnClick", function(box)
            Sound(box:GetChecked() and ON or OFF)
            item.write(box:GetChecked() and true or false)
            if item.apply then item.apply() end
            self:Refresh()
        end)
        Tooltip(check, item.title, item.tooltip)
        card.check = check

        local status
        if item.status then
            hasStatus = true
            status = NewMeter(card)
            status.layoutWide = true
            status:SetPoint("TOPLEFT", text, "BOTTOMLEFT", 0, -WORDS_ROOM)
            status:SetPoint("RIGHT", card, "RIGHT", -CARD_PAD, 0)
            card.status = status
        end

        local button
        if item.button then
            hasButton = true
            button = NewButton(card, item.button)
            -- The red button's art stops 2 short of its frame on each side: drawn 2 wider, its
            -- edges line up with the icon, the words and the bar above it.
            button:SetPoint("BOTTOMLEFT", card, "BOTTOMLEFT", CARD_PAD - 2, CARD_PAD)
            button:SetPoint("BOTTOMRIGHT", card, "BOTTOMRIGHT", -(CARD_PAD - 2), CARD_PAD)
            Script(button, "OnClick", function() if item.onButton then item.onButton() end end)
            card.button = button
        end

        Script(card, "OnClick", function()
            if item.disabled and item.disabled() then return end
            Sound(item.read() and OFF or ON)
            item.write(not item.read())
            if item.apply then item.apply() end
            self:Refresh()
        end)
        Tooltip(card, item.title, item.tooltip)

        function card:Update()
            local reason = item.disabled and item.disabled()
            local on = item.read() and true or false
            local live = on and not reason
            card.layoutReason, check.layoutReason = reason, reason
            card.layoutFaceOn, card.layoutFaceOff = live, reason ~= nil
            card.layoutHint = (not reason) and item.hint and item.hint(on) or nil
            check:SetChecked(live)
            if reason then check:Disable() else check:Enable() end
            if icon.SetDesaturated then icon:SetDesaturated(not live) end
            if live then
                title:SetTextColor(GOLD[1], GOLD[2], GOLD[3])
            else
                title:SetTextColor(0.7, 0.7, 0.7)
            end
            if status then
                status:Set(item.status())
                status:SetGreyed(not live)
            end
            if button then
                local usable = not item.buttonEnabled or item.buttonEnabled()
                if usable then button:Enable() else button:Disable() end
            end
            card.layoutChecked = live
            card.layoutStatus = status and { status.state, status.message } or {}
            card:Look()
        end
        self:Index(card, item.title, item.tooltip)
        table.insert(cards, card)
    end
    Updater(self, function() for _, card in ipairs(cards) do card:Update() end end)
    -- Under the words: the voice packs' value, then the button.
    local foot = (hasStatus and (WORDS_ROOM + METER_HEIGHT) or 0) + (hasButton and (10 + BUTTON_HEIGHT) or 0)
    local row = self:AddRow(PlaceCards(self, cards, nil, MODULE_HEAD, foot, 42), cards[1], cards, function(top)
        PlaceCards(self, cards, top, MODULE_HEAD, foot, 42)
    end)
    row.measure = function() return PlaceCards(self, cards, nil, MODULE_HEAD, foot, 42) end
    row.members = cards
    for _, card in ipairs(cards) do card.layoutRow = row end
    return cards
end

--- The narrator's styles, a card each, side by side: a sketch of the style in a small dark screen
--- across the top -- the input field's frame, as a module's icon has -- then its name and a line
--- about it. An item is { value, title, text, tooltip, art(frame) }; `art` draws the sketch,
--- scaled to its screen where that is narrow. `labels.choose` adds a line to an unchosen
--- style's tooltip saying a click picks it.
local STYLE_HEAD = SCREEN_HEIGHT + 10 + 16 + TITLE_GAP
local SCREEN_RIM = 6          -- inside the input frame's rim, where a tick sits on the sketch
function Layout:Tiles(items, read, write, apply, labels)
    self:Columns(nil)
    labels = labels or {}
    local parent = self.parent
    local tiles = {}
    for _, item in ipairs(items) do
        local tile = Card(parent)
        tile.layoutTile = item
        local screen = InputFrame(tile)
        screen:SetPoint("TOPLEFT", tile, "TOPLEFT", CARD_PAD, -CARD_PAD)
        screen:SetPoint("TOPRIGHT", tile, "TOPRIGHT", -CARD_PAD, -CARD_PAD)
        screen:SetHeight(SCREEN_HEIGHT)
        local sketch = CreateFrame("Frame", nil, screen)
        sketch:SetWidth(SKETCH_WIDTH)
        sketch:SetHeight(SKETCH_HEIGHT)
        sketch:SetPoint("CENTER", screen, "CENTER", 0, 0)
        sketch.width = SKETCH_WIDTH
        if item.art then item.art(sketch) end
        local title, text = Words(tile, item, 14)
        title:SetPoint("TOPLEFT", screen, "BOTTOMLEFT", 0, -10)
        title:SetPoint("RIGHT", tile, "RIGHT", -CARD_PAD, 0)
        text:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -TITLE_GAP)
        tile.screen, tile.sketch, tile.name, tile.text = screen, sketch, title, text

        local function Choose()
            Sound(CLICK)
            write(item.value)
            if apply then apply() end
            self:Refresh()
        end
        Script(tile, "OnClick", Choose)
        -- The page's checkbox on the sketch's screen, in its top right corner inside its rim,
        -- over the picture. Only on the chosen style: one is always chosen, so an empty box on
        -- the others offers nothing.
        local check = NewCheck(tile, 26)
        check:SetPoint("TOPRIGHT", screen, "TOPRIGHT", -SCREEN_RIM, -SCREEN_RIM)
        if check.SetFrameLevel and screen.GetFrameLevel then check:SetFrameLevel(screen:GetFrameLevel() + 2) end
        Script(check, "OnClick", function() check:SetChecked(true) end)
        Tooltip(check, item.title, item.tooltip)
        tile.check = check
        Tooltip(tile, item.title, item.tooltip)
        function tile:Update()
            local chosen = read() == item.value
            tile.layoutFaceOn = chosen
            tile.layoutHint = (not chosen) and labels.choose or nil
            check:SetChecked(chosen)
            if chosen then check:Show() else check:Hide() end
            Layout.Grey(sketch, not chosen)
            if chosen then
                title:SetTextColor(GOLD[1], GOLD[2], GOLD[3])
            else
                title:SetTextColor(1, 1, 1)
            end
            tile.layoutSelected = chosen
            tile:Look()
        end
        self:Index(tile, item.title, item.tooltip)
        table.insert(tiles, tile)
    end
    Updater(self, function() for _, tile in ipairs(tiles) do tile:Update() end end)
    local row = self:AddRow(PlaceCards(self, tiles, nil, STYLE_HEAD, WORDS_ROOM, 26), tiles[1], tiles, function(top)
        local _, width = PlaceCards(self, tiles, top, STYLE_HEAD, WORDS_ROOM, 26)
        local scale = math.min(1, (width - CARD_PAD * 2 - 8) / SKETCH_WIDTH, (SCREEN_HEIGHT - 8) / SKETCH_HEIGHT)
        for _, tile in ipairs(tiles) do
            if tile.sketch.SetScale then tile.sketch:SetScale(scale) end
        end
    end)
    row.measure = function() return PlaceCards(self, tiles, nil, STYLE_HEAD, WORDS_ROOM, 26) end
    row.members = tiles
    for _, tile in ipairs(tiles) do tile.layoutRow = row end
    return tiles
end

--- A state as a row of its own, with no label: `read()` returns the kind and the words.
function Layout:Status(read)
    self:Columns(nil)
    local parent = self.parent
    local badge = NewBadge(parent)
    Updater(self, function() badge:Set(read()) end)
    self:AddRow(STATUS_HEIGHT, badge, { badge }, function(top, x) Put(badge, parent, x + LABEL_X, top) end)
    return badge
end

--- A state beside its name: the name on the left of the row, as a setting's is, and the state
--- on the dropdown's face where the setting's control would be -- a key, a count. Not a setting,
--- so search passes it by. A dropdown's width, for a column of them, as the keys are; `hug`
--- fits it to its words instead, for one standing alone.
function Layout:Badge(label, read, tooltip, hug)
    self:Columns(nil)
    local parent = self.parent
    local hit = Band(parent, ROW_HEIGHT)
    local caption = Caption(parent, label)
    local badge = NewBadge(parent)
    badge.layoutHug = hug
    Above(badge, parent)
    hit.layoutControl, badge.layoutHit, badge.layoutLabel = badge, hit, caption
    Tooltip(hit, label, tooltip)
    Updater(self, function() badge:Set(read()) end)
    badge.layoutLabel = caption
    self:AddRow(ROW_HEIGHT, badge, { hit, badge, caption }, function(top, x)
        PlaceBand(self, hit, top)
        PlaceLabel(self, caption, x, top)
        local column = self:Column()
        Put(badge, parent, column, top - math.floor((ROW_HEIGHT - FIELD_HEIGHT) / 2))
        badge.layoutColumn = column
    end)
    return badge
end

--- Something to have, as a voice pack is: its name on the left of the row, as a setting's is,
--- and where a setting's control would be, what `read` says of it on the dropdown's face -- its
--- version -- or, while `read` returns nothing, a button the field's width to get it.
function Layout:Download(label, read, buttonLabel, onClick, tooltip)
    self:Columns(nil)
    local parent = self.parent
    local hit = Band(parent, ROW_HEIGHT)
    local caption = Caption(parent, label)
    local field = NewBadge(parent)
    local button = NewButton(parent, buttonLabel)
    FitToLabel(button, 120)
    Script(button, "OnClick", onClick)
    Above(field, parent)
    Above(button, parent)
    hit.layoutControl, field.layoutHit, field.layoutLabel = field, hit, caption
    Tooltip(hit, label)
    Tooltip(button, label, tooltip)
    -- Shown by alpha, as a field with nothing to say is: a row's regions are all shown when
    -- the row is, so a hidden one would come back.
    local function Show()
        local kind, words = read()
        field:Set(kind, words)
        local get = not kind
        button:SetAlpha(get and 1 or 0)
        if button.EnableMouse then button:EnableMouse(get) end
        field.layoutGet = get
    end
    Updater(self, Show)
    -- Found by search, so "voice pack" leads to the list.
    self:Index(field, label, tooltip)
    self:AddRow(ROW_HEIGHT, field, { hit, field, button, caption }, function(top, x)
        PlaceBand(self, hit, top)
        PlaceLabel(self, caption, x, top)
        local column = self:Column()
        local y = top - math.floor((ROW_HEIGHT - FIELD_HEIGHT) / 2)
        Put(field, parent, column, y)
        Put(button, parent, column, y)
        field.layoutColumn = column
    end)
    field.layoutButton = button
    return field
end

--- A key for an action, set right there: its name on the left of the row and its key on the
--- dropdown's face, as Badge has them. A click on the row or the field listens for the next key
--- -- `labels.press` saying so -- and hands it to `set`, with its modifiers, as the game names
--- them ("ALT-CTRL-SHIFT-P"); Escape, or another click, stops listening; a right click hands
--- `set` nil, to clear it.
local MODIFIER_KEYS = { LSHIFT = true, RSHIFT = true, LCTRL = true, RCTRL = true, LALT = true, RALT = true,
    LMETA = true, RMETA = true }
function Layout:Key(label, read, set, tooltip, labels)
    self:Columns(nil)
    local parent = self.parent
    local hit = Band(parent, ROW_HEIGHT)
    local caption = Caption(parent, label)
    local field = NewBadge(parent, true)
    Above(field, parent)
    hit.layoutControl, field.layoutHit, field.layoutLabel = field, hit, caption
    Tooltip(hit, label, tooltip)
    Tooltip(field, label, tooltip)
    local layout = self
    local function Show()
        if field.listening then
            field:Set("neutral", labels.press)
        else
            field:Set(read())
        end
    end
    -- The key handler is set only while listening, and taken away after: the client gives a
    -- frame with an OnKeyDown script every key, whether it asked for the keyboard or not, and
    -- three of them left set took every key from the game while the page was open.
    local OnKey
    local function Stop()
        field.listening = false
        Script(field, "OnKeyDown", nil)
        if field.EnableKeyboard then field:EnableKeyboard(false) end
        Show()
    end
    local function Listen()
        field.listening = true
        Script(field, "OnKeyDown", OnKey)
        if field.EnableKeyboard then field:EnableKeyboard(true) end
        -- The key is this field's: not the game's as well, nor the window's Escape.
        if field.SetPropagateKeyboardInput then field:SetPropagateKeyboardInput(false) end
        Show()
    end
    OnKey = function(_, key)
        if not field.listening or MODIFIER_KEYS[key] then return end
        if key == "ESCAPE" then
            Stop()
            return
        end
        local mods = (IsAltKeyDown and IsAltKeyDown() and "ALT-" or "")
            .. (IsControlKeyDown and IsControlKeyDown() and "CTRL-" or "")
            .. (IsShiftKeyDown and IsShiftKeyDown() and "SHIFT-" or "")
        Stop()
        set(mods .. key)
        layout:Refresh()
    end
    Script(field, "OnHide", function() if field.listening then Stop() end end)
    local function Click(_, button)
        if button == "RightButton" then
            Stop()
            set(nil)
            layout:Refresh()
        elseif field.listening then
            Stop()
        else
            Listen()
        end
    end
    for _, frame in ipairs({ hit, field }) do
        if frame.RegisterForClicks then frame:RegisterForClicks("LeftButtonUp", "RightButtonUp") end
        Script(frame, "OnClick", Click)
    end
    Updater(self, Show)
    self:Index(field, label, tooltip)
    self:AddRow(ROW_HEIGHT, field, { hit, field, caption }, function(top, x)
        PlaceBand(self, hit, top)
        PlaceLabel(self, caption, x, top)
        local column = self:Column()
        Put(field, parent, column, top - math.floor((ROW_HEIGHT - FIELD_HEIGHT) / 2))
        field.layoutColumn = column
    end)
    return field
end

--- The top of a page, as the game's settings head one (SettingsListTemplate's Header): its name
--- in GameFontHighlightHuge, white, at 7, -22 from the canvas's top left; a Defaults button at
--- its top right (Layout:Defaults); the game's divider 50 down, at its own size, across the
--- middle. `icon` is taken and not drawn, for the pages that pass it. `text`, where given, is a
--- paragraph under the divider, above the first section: the welcome window's, which says what
--- it is for. The game's settings pages have none, and neither do Spoken's: they pass nil.
--- On a page that scrolls (Layout.Scroll) the header stays put, as the game's does: it is drawn
--- on the canvas over the scroll view, which starts under the divider, so the rows scroll up
--- and go out of sight under it.
function Layout:Intro(icon, title, text)
    local scroller = self.parent.layoutScroller
    local parent = scroller and scroller.outer or self.parent
    if scroller then scroller:SetTop(HEADER_HEIGHT + 2) end
    local name = parent:CreateFontString(nil, "ARTWORK", Font("GameFontHighlightHuge", "GameFontHighlightLarge"))
    name:SetJustifyH("LEFT")
    name:SetText(title)
    local rule = Rule(parent)
    local layout = self
    local regions = { name, rule }
    -- On the page rather than the header's holder, so on a page that scrolls it scrolls with the
    -- rows under it. Softer than a setting's name, as a header's description is.
    local body
    if text then
        body = self.parent:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
        body:SetJustifyH("LEFT")
        body:SetJustifyV("TOP")
        body:SetTextColor(0.78, 0.78, 0.78)
        body:SetText(text)
        table.insert(regions, body)
    end
    local item = { kind = "intro", regions = regions, measure = function() return HEADER_HEIGHT end,
        place = function()
            local width = parent.GetWidth and parent:GetWidth() or (layout.left + layout:Width())
            Put(name, parent, 7, -22)
            rule:ClearAllPoints()
            rule:SetPoint("TOP", parent, "TOPLEFT", math.floor(width / 2), -HEADER_HEIGHT)
            if not rule.layoutAtlas then rule:SetWidth(width - 14) end
            local defaults = layout.defaults
            if defaults then
                defaults:ClearAllPoints()
                defaults:SetPoint("TOPRIGHT", parent, "TOPLEFT", width - 36, -16)
            end
        end }
    if body then
        -- Put at `top`, in line with the sections' titles and as wide as the rows; hands back
        -- where what follows it starts.
        item.body = function(top)
            local width = layout:Width() - SECTION_TITLE_X
            body:SetWidth(width)
            Put(body, layout.parent, layout.left + SECTION_TITLE_X, top)
            local height = TextHeight(body, 32)
            body:SetHeight(height)
            return top - height - HEADER_PAD
        end
    end
    table.insert(self.items, item)
    self.intro = { name = name, rule = rule, text = body, holder = parent, fixed = scroller and true or false }
    self.empty = false
    self.dirty = true
    return name
end

--- Putting a page back to its defaults: the header's Defaults button where the page has the
--- game's header, or a button of its own in a `title` section at the end where it has not.
function Layout:StartOver(title, label, onClick, tooltip)
    if self.intro then
        return self:Defaults(onClick, nil, tooltip)
    end
    self:Section(title)
    return self:Button(label, 200, onClick, tooltip)
end

--- The page's Defaults button, in its header's top right as the game's settings have one: 96 by
--- 22, red. A page with no header gets it as a button row instead.
function Layout:Defaults(onClick, label, tooltip)
    label = label or _G.SETTINGS_DEFAULTS or "Defaults"
    if not self.intro then
        return self:Button(label, nil, onClick, tooltip)
    end
    local holder = self.intro.holder
    local button = NewButton(holder, label)
    button:SetWidth(DEFAULTS_WIDTH)
    Script(button, "OnClick", onClick)
    Above(button, holder)
    Tooltip(button, label, tooltip)
    self.defaults = button
    self.dirty = true
    return button
end

--- A flat rectangle inside `parent`, for the sketches on tiles: `x`, `y` from its top left.
function Layout.Rect(parent, x, y, width, height, r, g, b, a)
    -- White, tinted: Grey recolours it by its tint alone. Setting a flat colour again on this
    -- client drops rects at random.
    local texture = Flat(parent, "ARTWORK", 1, 1, 1, 1)
    texture:SetVertexColor(r, g, b)
    texture:SetAlpha(a or 1)
    texture:SetPoint("TOPLEFT", parent, "TOPLEFT", x, -y)
    texture:SetWidth(width)
    texture:SetHeight(height)
    texture.layoutColor = { r, g, b }
    parent.layoutRects = parent.layoutRects or {}
    table.insert(parent.layoutRects, texture)
    return texture
end

--- A sketch drawn with Rect in grey, or back in its own colours: a narrator style not chosen
--- greys out as a module's icon does while it is off. Each rect is tinted at its own
--- brightness, since a flat colour does not desaturate on every client.
function Layout.Grey(art, grey)
    if not art.layoutRects then return end
    for _, texture in ipairs(art.layoutRects) do
        local c = texture.layoutColor
        if grey then
            local l = c[1] * 0.3 + c[2] * 0.59 + c[3] * 0.11
            texture:SetVertexColor(l, l, l)
        else
            texture:SetVertexColor(c[1], c[2], c[3])
        end
    end
    art.layoutGrey = grey and true or false
end

--------------------------------------------------------------------------------
-- Scrolling
--------------------------------------------------------------------------------
--
-- Settings.RegisterCanvasLayoutCategory hands the addon a fixed-size canvas and does
-- nothing else: a canvas taller than the settings window does not scroll, and does not
-- even clip, so the overflow draws over the game world. Any panel that can outgrow one
-- screen has to bring its own viewport, and a panel of sections always can.
--
-- The scrollbar is hand-rolled: ScrollFrameTemplate needs XML KeyValues naming a
-- scrollBarTemplate, none of which can be verified without launching the client, while a
-- track and a thumb are deterministic.

local SCROLL_STEP = 32
local BAR_WIDTH = 6
local MIN_THUMB = 20

local Scroller = {}
Scroller.__index = Scroller

local function Clamp(value, low, high)
    if value < low then
        return low
    elseif value > high then
        return high
    end
    return value
end

--------------------------------------------------------------------------------
-- Scrollbar
--------------------------------------------------------------------------------

-- Measures and redraws the bar, and NOTHING ELSE. In particular it must never
-- scroll: OnVerticalScroll calls it, so a SetVerticalScroll in here is an infinite
-- recursion and a dead settings panel. Moving the scroll position is ScrollTo's
-- job, and Recalculate below is what calls it when the range changes.
function Scroller:UpdateScrollBar()
    local viewHeight = self.frame:GetHeight() or 0
    local contentHeight = self.contentHeight or 0
    local range = contentHeight - viewHeight

    -- Nothing to scroll: keep the bar out of the way entirely.
    if range <= 1 or viewHeight <= 0 then
        self.range = 0
        self.bar:Hide()
        return
    end

    self.range = range
    self.bar:Show()

    local barHeight = self.bar:GetHeight() or 0
    local thumbHeight = Clamp((viewHeight / contentHeight) * barHeight, MIN_THUMB, barHeight)
    self.thumb:SetHeight(thumbHeight)

    local travel = barHeight - thumbHeight
    local fraction = range > 0 and (self.frame:GetVerticalScroll() / range) or 0
    self.thumb:ClearAllPoints()
    self.thumb:SetPoint("TOP", self.bar, "TOP", 0, -Clamp(fraction * travel, 0, travel))
end

function Scroller:ScrollTo(value)
    self.frame:SetVerticalScroll(Clamp(value, 0, self.range or 0))
end

-- Start the view `offset` under the canvas's top, leaving that much to a fixed header.
function Scroller:SetTop(offset)
    self.top = offset
    self.frame:ClearAllPoints()
    self.frame:SetPoint("TOPLEFT", self.outer, "TOPLEFT", 0, -offset)
    self.frame:SetPoint("BOTTOMRIGHT", self.outer, "BOTTOMRIGHT", 0, 0)
    self:Recalculate()
end

-- Re-measure, then pull the scroll position back inside whatever range is left.
-- Without the second half, shrinking the viewport's content leaves the view parked
-- past the end of it, showing empty space under the last control.
function Scroller:Recalculate()
    self:UpdateScrollBar()
    self:ScrollTo(self.frame:GetVerticalScroll())
end

-- How tall the content actually is. The caller knows, because it laid the widgets
-- out; nothing here can measure a frame whose children are absolutely positioned.
function Scroller:SetContentHeight(height)
    self.contentHeight = height
    self.child:SetHeight(height)
    self:Recalculate()
end

-- The game's minimal scroll bar (MinimalScrollBar): its track and its small thumb, each drawn
-- in three pieces, where the client has them; a plain bar where it does not.
local function ThreePiece(frame, layer, top, middle, bottom)
    local first = AtlasTexture(frame, layer, top, true)
    local last = AtlasTexture(frame, layer, bottom, true)
    local mid = AtlasTexture(frame, layer, middle, false)
    if not (first and last and mid) then return nil end
    first:SetPoint("TOP", frame, "TOP", 0, 0)
    last:SetPoint("BOTTOM", frame, "BOTTOM", 0, 0)
    mid:SetPoint("TOPLEFT", first, "BOTTOMLEFT", 0, 0)
    mid:SetPoint("BOTTOMRIGHT", last, "TOPRIGHT", 0, 0)
    return { first, mid, last }
end

local function BuildScrollBar(view, parent)
    local minimal = HasAtlas("minimal-scrollbar-track-top")
    local barWidth = minimal and 8 or BAR_WIDTH
    view.barWidth = barWidth
    local bar = CreateFrame("Frame", nil, parent)
    bar:SetWidth(barWidth)
    bar:SetPoint("TOPRIGHT", view.frame, "TOPRIGHT", 0, minimal and -4 or 0)
    bar:SetPoint("BOTTOMRIGHT", view.frame, "BOTTOMRIGHT", 0, minimal and 7 or 0)
    bar:Hide()

    if not (minimal and ThreePiece(bar, "BACKGROUND", "minimal-scrollbar-track-top",
        "!minimal-scrollbar-track-middle", "minimal-scrollbar-track-bottom")) then
        local track = bar:CreateTexture(nil, "BACKGROUND")
        track:SetAllPoints()
        track:SetColorTexture(1, 1, 1, 0.06)
    end

    local thumb = CreateFrame("Button", nil, bar)
    thumb:SetWidth(barWidth)
    thumb:SetHeight(MIN_THUMB)
    thumb:SetPoint("TOP", bar, "TOP", 0, 0)

    local pieces = minimal and ThreePiece(thumb, "ARTWORK", "minimal-scrollbar-small-thumb-top",
        "minimal-scrollbar-small-thumb-middle", "minimal-scrollbar-small-thumb-bottom")
    local thumbTex
    if not pieces then
        thumbTex = thumb:CreateTexture(nil, "ARTWORK")
        thumbTex:SetAllPoints()
    end
    local over = false
    -- Brighter under the pointer and while held, as the game's thumb is.
    local function Look()
        local alpha = (view.dragging or over) and 1 or 0.8
        if pieces then
            for _, piece in ipairs(pieces) do piece:SetAlpha(alpha) end
        else
            thumbTex:SetColorTexture(1, 0.82, 0, (view.dragging or over) and 0.75 or 0.45)
        end
    end
    Look()

    Script(thumb, "OnEnter", function() over = true; Look() end)
    Script(thumb, "OnLeave", function() over = false; Look() end)

    -- The cursor's height in the bar's own units: the settings window has a scale of its own,
    -- so UIParent's would move the thumb faster or slower than the pointer.
    local function CursorY()
        local _, y = GetCursorPosition()
        local scale = (bar.GetEffectiveScale and bar:GetEffectiveScale())
            or (UIParent and UIParent:GetEffectiveScale()) or 1
        return y / scale
    end
    -- Held from the press, as the game's is, not from a drag the client starts a few pixels
    -- later; and held where it was taken, so the thumb moves with the pointer rather than
    -- jumping to centre on it.
    local function Release()
        if not view.dragging then return end
        view.dragging = false
        Look()
        Sound(TICK)
    end
    Script(thumb, "OnMouseDown", function(_, button)
        if button and button ~= "LeftButton" then return end
        view.grab = (thumb:GetTop() or 0) - CursorY()
        view.dragging = true
        Look()
    end)
    Script(thumb, "OnMouseUp", Release)
    Script(thumb, "OnHide", Release)

    -- Map the cursor's Y position onto the scroll range while dragging.
    Script(bar, "OnUpdate", function()
        if not view.dragging then
            return
        end
        -- Let go outside the client's window, the thumb never hears it.
        if IsMouseButtonDown and not IsMouseButtonDown("LeftButton") then
            Release()
            return
        end

        local barHeight = bar:GetHeight() or 0
        local thumbHeight = thumb:GetHeight() or 0
        local travel = barHeight - thumbHeight
        if travel <= 0 then
            return
        end

        local offset = (bar:GetTop() or 0) - (CursorY() + (view.grab or thumbHeight / 2))
        view:ScrollTo((Clamp(offset, 0, travel) / travel) * (view.range or 0))
    end)

    view.bar = bar
    view.thumb = thumb
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

-- Fills `parent`. Anchor widgets inside the returned `child`, then call
-- SetContentHeight with how far down they reach.
function Layout.Scroll(parent)
    local view = setmetatable({}, Scroller)
    view.range = 0
    view.contentHeight = 0

    local scroll = CreateFrame("ScrollFrame", nil, parent)
    scroll:SetAllPoints(parent)
    if scroll.SetClipsChildren then
        scroll:SetClipsChildren(true)
    end
    scroll:EnableMouseWheel(true)
    Script(scroll, "OnMouseWheel", function(_, delta)
        view:ScrollTo(scroll:GetVerticalScroll() - (delta * SCROLL_STEP))
    end)
    Script(scroll, "OnVerticalScroll", function()
        view:UpdateScrollBar()
    end)

    local child = CreateFrame("Frame", nil, scroll)
    child:SetSize(1, 1)
    scroll:SetScrollChild(child)

    view.frame = scroll
    view.child = child
    view.outer = parent
    -- Found by Layout:Intro, which puts a page's header on the canvas over the view.
    child.layoutScroller = view

    BuildScrollBar(view, parent)

    -- A canvas has no resolved size until the settings window lays it out, so the
    -- viewport height -- and with it whether there is anything to scroll at all --
    -- is not known at construction time. Setting the child's width does not resize
    -- the ScrollFrame, so this cannot recurse.
    -- Belt and braces: the settings window can size its canvas before this is ever
    -- shown, in which case OnSizeChanged has already fired and there is nothing to
    -- recompute -- but a bar left hidden because the height was still 0 at that
    -- moment is invisible until something else resizes.
    Script(scroll, "OnShow", function()
        view:Recalculate()
    end)

    Script(scroll, "OnSizeChanged", function(self)
        local width = self:GetWidth() or 0
        if width > 0 then
            child:SetWidth(width - (view.barWidth or BAR_WIDTH) - 2)
        end
        view:Recalculate()
    end)

    return view
end

SpokenLayout = Layout
