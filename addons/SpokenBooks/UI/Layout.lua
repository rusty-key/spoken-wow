-- The settings layout every Spoken addon builds its panel with.
--
-- BYTE-IDENTICAL IN EVERY SPOKEN ADDON. A copy lives in SpokenPlayer, SpokenQuests and
-- SpokenZones, and the packaging tests assert the three are the same file. The addons
-- cannot share a file at runtime -- each is installed on its own, and the player is only
-- an optional dependency of the other two -- so they share it by carrying it, the way
-- vendored libraries do. Edit one copy and copy it over the others; do not edit in place.
--
-- Deliberately idiom-free: no setfenv, no addon table, no localisation. Every label and
-- every accessor is passed in, so the same file suits an addon that runs in a private
-- environment and one that does not.
--
-- Lua 5.0 rules, because this loads on 1.12: no `#`, no literal-string method calls.

local VERSION = 2

-- LibStub's contract, for LibStub's reason: three addons load this file and the newest
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

-- One rhythm, kept here rather than at the call sites. Every row used to place itself by
-- adding its own fudge to a running offset, and no two sections were spaced alike.
local ROW_GAP = 8          -- between rows inside a section
local SECTION_GAP = 32     -- above a section heading
local HEADING_GAP = 6      -- between a heading and the first row under it
local HEADING_HEIGHT = 16
local CHECKBOX_SIZE = 26
local BUTTON_HEIGHT = 22
local SLIDER_HEIGHT = 16
local CONTROL_HEIGHT = 26     -- a labelled control's row: label left, control right
local LABEL_COLUMN = 190      -- where the control starts, so every one of them lines up
local INDENT_STEP = 20        -- for an option that qualifies the one above it
local LABEL_PADDING = 24      -- room a button's end caps take either side of its label

-- A heading belongs to the section under it. The space above it is what separates two
-- sections; the space below it must stay smaller, or the heading reads as floating
-- between the two rather than introducing one.
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

--- The left half of a labelled row: white, so it reads as the name of the thing rather
--- than as a heading, and centred against whatever sits in the right half.
local function Caption(parent, text, x, top, height)
    local fs = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    fs:SetPoint("TOPLEFT", x, top)
    fs:SetWidth(LABEL_COLUMN - 10)
    fs:SetHeight(height)
    fs:SetJustifyH("LEFT")
    fs:SetJustifyV("MIDDLE")
    fs:SetText(text)
    return fs
end

local function Tooltip(frame, title, body)
    if not body and not title then
        return
    end
    frame:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:SetText(title or body)
        if title and body then
            GameTooltip:AddLine(body, 1, 1, 1, true)
        end
        GameTooltip:Show()
    end)
    frame:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

--- A panel's rows, top-anchored and running downward from `top`.
function Layout.New(parent, x, top)
    return setmetatable({ parent = parent, x = x, top = top, y = top, empty = true }, Layout)
end

--- Reserve a row `height` tall at the current offset and step past it.
function Layout:Take(height)
    local y = self.y
    self.y = self.y - height - ROW_GAP
    self.empty = false
    return y
end

--- The column a labelled control's content starts at. Recorded rather than inferred from
--- the frame, because UIDropDownMenuTemplate insets its own text: two controls that line
--- up on screen are anchored sixteen pixels apart.
function Layout:Column()
    return self.x + LABEL_COLUMN
end

--- Record the row a control was given. A control may sit inside its row -- a slider's bar
--- hangs below its own label -- but never outside it.
function Layout:Row(frame, top, height)
    frame.layoutY, frame.layoutHeight = top, height
    return frame
end

--- Step the following rows in, for options that qualify the one above them, and back out.
function Layout:Indent()
    self.x = self.x + INDENT_STEP
    return self
end

function Layout:Outdent()
    self.x = self.x - INDENT_STEP
    return self
end

--- How tall the panel has grown. For a scrolling host that must size its content.
function Layout:Height()
    return self.top - self.y
end

function Layout:Section(text)
    if not self.empty then
        self.y = self.y - SECTION_GAP + ROW_GAP   -- the section gap replaces the row gap
    end
    local fs = self.parent:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    fs:SetPoint("TOPLEFT", self.x, self.y)
    fs:SetJustifyH("LEFT")
    fs:SetText(text)
    fs.layoutY, fs.layoutHeight, fs.layoutHeading = self.y, HEADING_HEIGHT, true
    self.y = self.y - HEADING_HEIGHT - HEADING_GAP
    self.empty = false
    return fs
end

--- Prose, not a setting: wraps to `width`, and occupies a row like anything else. It gets
--- no tighter gap of its own -- an exception is how a panel stops having one rhythm.
function Layout:Note(text, width, height)
    height = height or 28
    local top = self:Take(height)
    local fs = self.parent:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
    fs:SetPoint("TOPLEFT", self.x, top)
    fs:SetJustifyH("LEFT")
    fs:SetWidth(width or 460)
    fs:SetText(text)
    return self:Row(fs, top, height)
end

function Layout:Checkbox(label, tooltip, read, write, apply)
    local top = self:Take(CHECKBOX_SIZE)
    local box = CreateFrame("CheckButton", nil, self.parent, "UICheckButtonTemplate")
    box:SetSize(CHECKBOX_SIZE, CHECKBOX_SIZE)
    box:SetPoint("TOPLEFT", self.x, top)
    box.text = box:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    box.text:SetPoint("LEFT", box, "RIGHT", 2, 0)
    box.text:SetText(label)
    box:SetScript("OnShow", function(self) self:SetChecked(read() and true or false) end)
    box:SetScript("OnClick", function(self)
        write(self:GetChecked() and true or false)
        if apply then apply() end
    end)
    box:SetChecked(read() and true or false)
    Tooltip(box, label, tooltip)
    return self:Row(box, top, CHECKBOX_SIZE)
end

function Layout:Slider(label, minValue, maxValue, step, read, write, apply, show)
    show = show or Layout.Percent
    local top = self:Take(CONTROL_HEIGHT)
    local caption = Caption(self.parent, label, self.x, top, CONTROL_HEIGHT)

    -- OptionsSliderTemplate is the private-server clients' name for it; WOW_PROJECT_ID
    -- exists on every client that calls it UISliderTemplate.
    local template = WOW_PROJECT_ID == nil and "OptionsSliderTemplate" or "UISliderTemplate"
    local slider = CreateFrame("Slider", nil, self.parent, template)
    -- Both load-bearing: a slider given neither draws nothing at all, leaving a gap on the
    -- panel where a setting should be.
    slider:SetHeight(SLIDER_HEIGHT)
    slider:SetOrientation("HORIZONTAL")
    slider:SetWidth(180)
    slider:SetPoint("TOPLEFT", self.x + LABEL_COLUMN, top - (CONTROL_HEIGHT - SLIDER_HEIGHT) / 2)
    slider:SetMinMaxValues(minValue, maxValue)
    slider:SetValueStep(step)
    if slider.SetObeyStepOnDrag then
        slider:SetObeyStepOnDrag(true)
    end

    -- The value reads to the right of the bar rather than in the label, so the label
    -- column stays the same width whatever the value happens to be.
    local value = self.parent:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    value:SetPoint("LEFT", slider, "RIGHT", 8, 0)
    value:SetJustifyH("LEFT")
    -- Set when built as well as on show: a slider on a panel nobody has opened still reads
    -- as what it is.
    value:SetText(show(read()))
    slider:SetScript("OnShow", function(self)
        self:SetValue(read())
        value:SetText(show(read()))
    end)
    slider:SetScript("OnValueChanged", function(self, current)
        current = math.floor(current / step + 0.5) * step
        value:SetText(show(current))
        if math.abs(current - read()) >= step / 2 then
            write(current)
            if apply then apply() end
        end
    end)
    slider:SetValue(read())
    Tooltip(slider, label, nil)
    slider.layoutLabel, slider.layoutValue, slider.layoutColumn = caption, value, self:Column()
    return self:Row(slider, top, CONTROL_HEIGHT)
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
    local top = self:Take(BUTTON_HEIGHT)
    local button = CreateFrame("Button", nil, self.parent, "UIPanelButtonTemplate")
    button:SetSize(240, BUTTON_HEIGHT)
    button:SetPoint("TOPLEFT", self.x, top)
    local function Sync()
        button:SetText(format(label, describe(read())))
        FitToLabel(button, 240)
    end
    button:SetScript("OnClick", function()
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
    button:SetScript("OnShow", Sync)
    Tooltip(button, nil, tooltip)
    Sync()
    return self:Row(button, top, BUTTON_HEIGHT)
end

local dropdowns = 0

--- A labelled dropdown: the control a player expects for a handful of named choices. The
--- list may be a function, for a choice whose options depend on what is installed.
---
--- Falls back to a cycle button where UIDropDownMenu is absent, which is every client
--- without a Settings API -- the same clients that host the panel in a window of its own.
function Layout:Dropdown(label, tooltip, values, read, write, apply, describe)
    describe = describe or tostring
    if not (UIDropDownMenu_Initialize and UIDropDownMenu_AddButton and CreateFrame) then
        return self:Cycle(label .. ": %s", tooltip, values, read, write, apply, describe)
    end

    local top = self:Take(CONTROL_HEIGHT)
    local caption = Caption(self.parent, label, self.x, top, CONTROL_HEIGHT)

    dropdowns = dropdowns + 1
    local menu = CreateFrame("Frame", "SpokenLayoutDropdown" .. dropdowns, self.parent,
        "UIDropDownMenuTemplate")
    -- The template carries its own inset, so the frame sits left of where its text lands.
    -- Vertically it sits exactly on the row: nudging it up would put it in the row above.
    menu:SetPoint("TOPLEFT", self.x + LABEL_COLUMN - 16, top)

    local function Sync()
        UIDropDownMenu_SetText(menu, describe(read()))
    end

    UIDropDownMenu_Initialize(menu, function(_, level)
        local current = read()
        for _, value in ipairs(Resolve(values)) do
            local info = UIDropDownMenu_CreateInfo()
            info.text = describe(value)
            info.checked = value == current
            info.func = function()
                write(value)
                if apply then apply() end
                Sync()
                if CloseDropDownMenus then
                    CloseDropDownMenus()
                end
            end
            UIDropDownMenu_AddButton(info, level)
        end
    end)
    if UIDropDownMenu_SetWidth then
        -- Wide enough for "Automático (Español (América Latina))", the longest
        -- language label any of the addons shows.
        UIDropDownMenu_SetWidth(menu, 260)
    end
    menu:SetScript("OnShow", Sync)
    Tooltip(menu, label, tooltip)
    Sync()
    menu.layoutLabel, menu.layoutColumn = caption, self:Column()
    return self:Row(menu, top, CONTROL_HEIGHT)
end

function Layout:Button(label, width, onClick, tooltip)
    local top = self:Take(BUTTON_HEIGHT)
    local button = CreateFrame("Button", nil, self.parent, "UIPanelButtonTemplate")
    button:SetHeight(BUTTON_HEIGHT)
    button:SetPoint("TOPLEFT", self.x, top)
    button:SetText(label)
    FitToLabel(button, width)
    button:SetScript("OnClick", onClick)
    Tooltip(button, nil, tooltip)
    return self:Row(button, top, BUTTON_HEIGHT)
end

--- A control this file does not build: placed in a row of its own, at `height`.
function Layout:Custom(frame, height)
    local top = self:Take(height)
    frame:SetPoint("TOPLEFT", self.x, top)
    return self:Row(frame, top, height)
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

local function BuildScrollBar(view, parent)
    local bar = CreateFrame("Frame", nil, parent)
    bar:SetWidth(BAR_WIDTH)
    bar:SetPoint("TOPRIGHT", view.frame, "TOPRIGHT", 0, 0)
    bar:SetPoint("BOTTOMRIGHT", view.frame, "BOTTOMRIGHT", 0, 0)
    bar:Hide()

    local track = bar:CreateTexture(nil, "BACKGROUND")
    track:SetAllPoints()
    track:SetColorTexture(1, 1, 1, 0.06)

    local thumb = CreateFrame("Button", nil, bar)
    thumb:SetWidth(BAR_WIDTH)
    thumb:SetHeight(MIN_THUMB)
    thumb:SetPoint("TOP", bar, "TOP", 0, 0)

    local thumbTex = thumb:CreateTexture(nil, "ARTWORK")
    thumbTex:SetAllPoints()
    thumbTex:SetColorTexture(1, 0.82, 0, 0.45)

    thumb:SetScript("OnEnter", function()
        thumbTex:SetColorTexture(1, 0.82, 0, 0.75)
    end)
    thumb:SetScript("OnLeave", function()
        if not view.dragging then
            thumbTex:SetColorTexture(1, 0.82, 0, 0.45)
        end
    end)

    thumb:RegisterForDrag("LeftButton")
    thumb:SetScript("OnDragStart", function()
        view.dragging = true
    end)
    thumb:SetScript("OnDragStop", function()
        view.dragging = false
        thumbTex:SetColorTexture(1, 0.82, 0, 0.45)
    end)

    -- Map the cursor's Y position onto the scroll range while dragging.
    bar:SetScript("OnUpdate", function()
        if not view.dragging then
            return
        end

        local barHeight = bar:GetHeight() or 0
        local thumbHeight = thumb:GetHeight() or 0
        local travel = barHeight - thumbHeight
        if travel <= 0 then
            return
        end

        local _, cursorY = GetCursorPosition()
        cursorY = cursorY / UIParent:GetEffectiveScale()

        local offset = (bar:GetTop() or 0) - cursorY - (thumbHeight / 2)
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
    scroll:SetScript("OnMouseWheel", function(_, delta)
        view:ScrollTo(scroll:GetVerticalScroll() - (delta * SCROLL_STEP))
    end)
    scroll:SetScript("OnVerticalScroll", function()
        view:UpdateScrollBar()
    end)

    local child = CreateFrame("Frame", nil, scroll)
    child:SetSize(1, 1)
    scroll:SetScrollChild(child)

    view.frame = scroll
    view.child = child

    BuildScrollBar(view, parent)

    -- A canvas has no resolved size until the settings window lays it out, so the
    -- viewport height -- and with it whether there is anything to scroll at all --
    -- is not known at construction time. Setting the child's width does not resize
    -- the ScrollFrame, so this cannot recurse.
    -- Belt and braces: the settings window can size its canvas before this is ever
    -- shown, in which case OnSizeChanged has already fired and there is nothing to
    -- recompute -- but a bar left hidden because the height was still 0 at that
    -- moment is invisible until something else resizes.
    scroll:SetScript("OnShow", function()
        view:Recalculate()
    end)

    scroll:SetScript("OnSizeChanged", function(self)
        local width = self:GetWidth() or 0
        if width > 0 then
            child:SetWidth(width - BAR_WIDTH - 2)
        end
        view:Recalculate()
    end)

    return view
end

SpokenLayout = Layout
