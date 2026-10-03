-- The settings drawn as the game's own settings are: its section headers and rows, its minimal
-- checkbox, its slider and dropdown with steppers, its red buttons, its page header with Defaults.
-- The stub has none of them, so this test supplies the atlases and two templates UI/Layout.lua
-- asks for, loads it fresh, and reads back where each control went and what it was drawn with.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local LAYOUT = here .. "/../../addons/SpokenPlayer/UI/Layout.lua"

stub.SetClient("11509"); stub.ResetFrames()
_G.UISpecialFrames = _G.UISpecialFrames or {}

-- The atlases the game's settings draw with (wow-ui-source, forever).
local ATLASES = { ["checkbox-minimal"] = 1, ["checkmark-minimal"] = 1, ["checkmark-minimal-disabled"] = 1,
    ["Options_HorizontalDivider"] = 1, ["minimal-scrollbar-track-top"] = 1, ["!minimal-scrollbar-track-middle"] = 1,
    ["minimal-scrollbar-track-bottom"] = 1, ["minimal-scrollbar-small-thumb-top"] = 1,
    ["minimal-scrollbar-small-thumb-middle"] = 1, ["minimal-scrollbar-small-thumb-bottom"] = 1 }
_G.C_Texture = { GetAtlasInfo = function(name) return ATLASES[name] and { width = 600, height = 2 } or nil end }
_G.MenuUtil = {}
_G.MinimalSliderWithSteppersMixin = { Label = { Left = 1, Right = 2 }, Event = { OnValueChanged = "OnValueChanged" } }

-- Every texture records its atlas; the two templates behave as the game's do, as far as a page
-- uses them: the slider's Init, its value callback and SetEnabled; the dropdown's menu of radios.
local create = _G.CreateFrame
_G.CreateFrame = function(kind, name, parent, template)
    local f = create(kind, name, parent, template)
    f.template = template
    local make = f.CreateTexture
    function f:CreateTexture(...)
        local t = make(self, ...)
        function t:SetAtlas(atlas) self.atlas = atlas end
        return t
    end
    function f:SetNormalTexture(t) self.normal = t end
    function f:SetPushedTexture(t) self.pushed = t end
    function f:SetCheckedTexture(t) self.checkedTexture = t end
    function f:SetDisabledCheckedTexture(t) self.disabledChecked = t end
    function f:SetFrameLevel(level) self.level = level end
    function f:GetFrameLevel() return self.level or (self.parent and self.parent.GetFrameLevel and self.parent:GetFrameLevel() + 1) or 1 end
    function f:SetScale(scale) self.scale = scale end
    function f:SetEnabled(on) self.enabled = on and true or false end
    function f:GetWidth() return self.width or 0 end
    if template == "MinimalSliderWithSteppersTemplate" then
        f:SetHeight(20)
        f.Slider = create("Slider", nil, f)
        function f:Init(value, low, high, steps, formatters)
            self.value, self.low, self.high, self.steps, self.formatters = value, low, high, steps, formatters
        end
        function f:RegisterCallback(event, fn, owner) self.callback = function(v) fn(owner, v) end end
        function f:SetValue(v) self.value = v end
    elseif template == "SettingsDropdownWithButtonsTemplate" then
        f:SetHeight(38)
        f.Dropdown = create("Frame", nil, f)
        function f.Dropdown:SetupMenu(generator) self.generator = generator end
        function f.Dropdown:GenerateMenu()
            local radios = {}
            local root = { CreateRadio = function(_, text, isSelected, setSelected, data)
                table.insert(radios, { text = text, selected = isSelected(), choose = setSelected, data = data })
            end }
            self.generator(self, root)
            self.radios = radios
        end
    end
    return f
end

-- The sounds the controls play, as the client would: recorded.
local played = {}
_G.SOUNDKIT = { IG_MAINMENU_OPTION_CHECKBOX_ON = 856, IG_MAINMENU_OPTION_CHECKBOX_OFF = 857, U_CHAT_SCROLL_BUTTON = 1115 }
_G.PlaySound = function(kit) table.insert(played, kit) end

_G.SpokenLayout = nil
assert(loadfile(LAYOUT))()
local Layout = _G.SpokenLayout

local page = CreateFrame("Frame")
page.children = {}
function page:GetWidth() return 640 end

local layout = Layout.New(page, 25, -16)
local header = layout:Intro(nil, "Spoken")
local reset = 0
layout:Defaults(function() reset = reset + 1 end)
local state = { on = true, level = 0.5, choice = "b", enabled = true, style = "x" }
layout:Section("Box")
local check = layout:Checkbox("Switch", "tip", function() return state.on end, function(v) state.on = v end)
local slider = layout:Slider("Level", 0, 1, 0.05, function() return state.level end, function(v) state.level = v end,
    nil, nil, "tip")
local menu = layout:Dropdown("Choice", "tip", { "a", "b" }, function() return state.choice end,
    function(v) state.choice = v end)
local button = layout:Button("Reset", 120, function() end)
layout:Requires(slider, function() return state.enabled end, "off")
layout:Requires(menu, function() return state.enabled end, "off")
layout:Section("Modules", true)
local modules = { on = true, off = false }
local function Module(name)
    return { title = name, text = "", read = function() return modules[name] end,
        write = function(v) modules[name] = v end,
        status = function() return "neutral", "Voice Pack", "1/1", "good" end,
        hint = function(on) return on and "Click to turn it off." or "Click to turn it on." end,
        button = "Settings", onButton = function() modules.opened = name end,
        buttonEnabled = function() return modules[name] end }
end
local cards = layout:Cards({ Module("on"), Module("off") })
local function Art(sketch) Layout.Rect(sketch, 0, 0, 10, 10, 1, 0.82, 0, 1) end
local tiles = layout:Tiles({ { value = "x", title = "X", text = "", art = Art }, { value = "y", title = "Y", text = "", art = Art } },
    function() return state.style end, function(v) state.style = v end, nil, { active = "Active", choose = "Use this." })
layout:Refresh()

local middle = layout.left + math.floor(layout:Width() / 2)

---------------------------------------------------------------- the page's header
Expect("a page is headed by its name, as the game's settings head one: 7 in, 22 down",
    header.anchor.x .. "," .. header.anchor.y, "7,-22")
Expect("...the game's divider under it, 50 down", layout.intro.rule.atlas .. " " .. layout.intro.rule.anchor.y,
    "Options_HorizontalDivider -50")
Expect("...and Defaults at its top right, 36 in and 16 down", layout.defaults.anchor.point .. " "
    .. layout.defaults.anchor.x .. " " .. layout.defaults.anchor.y .. " " .. layout.defaults.width, "TOPRIGHT 604 -16 96")
layout.defaults.scripts.OnClick(layout.defaults)
Expect("...which puts the page back", reset, 1)

---------------------------------------------------------------- sections and rows
local group = layout.boxes[1].section
Expect("a section's title is the game's section header: 7 in, 16 down its 45",
    (group.heading.anchor.x - layout.left) .. "," .. (group.heading.anchor.y - group.heading.layoutY), "7,-16")
Expect("...in white", group.heading.layoutHeight, 45)
Expect("its first row 45 and 9 under its top", check.layoutY, group.heading.layoutY - 45 - 9)
Expect("rows 26 tall, 9 apart", slider.layoutY, check.layoutY - 26 - 9)
Expect("a setting's name 37 in, in the game's gold", check.text.anchor.x - layout.left, 37)
Expect("...running to 85 short of the row's middle", check.text.width, middle - 85 - (layout.left + 37))
Expect("a row's hover is the game's: white at a tenth, to 5 short of the row's right",
    check.layoutHit.layoutBand.anchor.point .. " " .. check.layoutHit.layoutBand.anchor.x, "BOTTOMRIGHT -5")

---------------------------------------------------------------- checkbox
Expect("the checkbox is the game's settings checkbox, 30 by 29", check.width .. "x" .. check.height, "30x29")
Expect("...the minimal box and its tick", check.normal.atlas .. "," .. check.checkedTexture.atlas .. ","
    .. check.disabledChecked.atlas, "checkbox-minimal,checkmark-minimal,checkmark-minimal-disabled")
Expect("...starting 80 left of the row's middle", check.anchor.x, middle - 80)
check:SetChecked(false); check.scripts.OnClick(check)
Expect("...and plays the game's sound as it is cleared", played[#played], 857)

---------------------------------------------------------------- slider
Expect("the slider is the game's, with steppers", slider.template, "MinimalSliderWithSteppersTemplate")
Expect("...250 wide, 80 left of the middle", slider.width .. " " .. slider.anchor.x, "250 " .. (middle - 80))
Expect("...set to the setting, its value on its right", slider.value .. " " .. slider.formatters[2](0.5), "0.5 50%")
Expect("...in its steps", slider.steps, 20)
slider.callback(0.81)
Expect("moving it snaps to the step and writes it", state.level, 0.8)

---------------------------------------------------------------- dropdown
Expect("the dropdown is the game's settings dropdown, with steppers", menu.template, "SettingsDropdownWithButtonsTemplate")
Expect("...220 wide, 48 left of the middle", menu.Dropdown.width .. " " .. menu.anchor.x, "220 " .. (middle - 48))
menu.Dropdown:GenerateMenu()
Expect("its menu offers each choice, the current one chosen", menu.Dropdown.radios[1].text .. ","
    .. menu.Dropdown.radios[2].text .. " " .. tostring(menu.Dropdown.radios[2].selected), "a,b true")
menu.Dropdown.radios[1].choose()
Expect("choosing one writes it", state.choice, "a")

---------------------------------------------------------------- greyed out
state.enabled = false; layout:Refresh()
Expect("a row waiting on a switch disables the slider", slider.enabled, false)
Expect("...and the dropdown", menu.enabled, false)
Expect("...its name in the game's grey", slider.layoutLabel.layoutGreyed, true)
state.enabled = true; layout:Refresh()
Expect("...and wakes them with it", slider.enabled ~= false and menu.enabled ~= false, true)

---------------------------------------------------------------- buttons
Expect("a button is the game's red panel button", button.template, "UIPanelButtonTemplate")
Expect("...200 wide and 22 tall, where a setting's name starts", button.width .. "x" .. button.height .. " "
    .. (button.anchor.x - layout.left), "200x22 37")
---------------------------------------------------------------- modules
Expect("a module card is drawn in the game's tooltip border", cards[1].backdrop and cards[1].backdrop.edgeFile,
    [[Interface\Tooltips\UI-Tooltip-Border]])
Expect("...gold round one that is on", cards[1].backdropBorderColor[1] .. "," .. cards[1].backdropBorderColor[2], "1,0.82")
Expect("...grey round one that is off", cards[2].backdropBorderColor[1], 0.45)
Expect("an enabled module stands at full strength, under a faint wash", cards[1].alpha == 1
    and cards[1].layoutWash.shown ~= false, true)
Expect("one switched off stands back at lower opacity", cards[2].alpha < 1 and cards[2].layoutWash.shown == false, true)
cards[2].scripts.OnEnter(cards[2])
Expect("...coming forward under the pointer", cards[2].alpha > 0.55 and cards[2].layoutWash.shown ~= false, true)
Expect("...whose tooltip says what a click will do", cards[2].layoutHint, "Click to turn it on.")
cards[2].scripts.OnLeave(cards[2])
Expect("a module has the page's checkbox in its corner, ticked while it is on", cards[1].check.checked, true)
Expect("...and not while it is off", cards[2].check.checked, false)
Expect("...the game's settings checkbox", cards[1].check.checkedTexture.atlas, "checkmark-minimal")
Expect("...inside the card, its top level with its icon's, where its words end", cards[1].check.anchor.point .. " "
    .. cards[1].check.anchor.x .. " " .. cards[1].check.anchor.y, "TOPRIGHT -12 -12")
Expect("a chosen style's tick on its sketch, in the top right corner",
    tiles[1].check.anchor.relativeTo == tiles[1].screen and tiles[1].check.anchor.point .. " "
    .. tiles[1].check.anchor.x .. " " .. tiles[1].check.anchor.y, "TOPRIGHT -6 -6")
Expect("its voice packs counted on the dropdown's face", cards[1].status.message .. " " .. cards[1].status.value, "Voice Pack 1/1")
Expect("...no Enabled or Disabled tag", cards[1].tags, nil)
Expect("its icon in the input field's frame, at the card's top left",
    cards[1].frame.width .. "x" .. cards[1].frame.height, "44x44")
Expect("...reaching its rim", cards[1].icon.width, 38)
cards[1].scripts.OnEnter(cards[1])
Expect("an enabled module comes up under the pointer too", cards[1].layoutOver and cards[1].layoutWash.alpha, 1)
cards[1].scripts.OnLeave(cards[1])
Expect("...and settles back after", cards[1].layoutWash.alpha, 0.5)
Expect("its button the height of every button: the game's red panel button", cards[1].button.height, 22)
Expect("a module card has a button to its page", cards[1].button ~= nil and cards[1].button.text, "Settings")
cards[1].button.scripts.OnClick(cards[1].button)
Expect("...which opens it", modules.opened, "on")
Expect("...and does nothing while the module is off", cards[2].button.enabled, false)
Expect("its icon sits in the frame a narrator style's sketch has", cards[1].icon.parent, cards[1].frame)
Expect("its name under its icon, across the card's full width, so it is not cut short",
    cards[1].name.anchor.relativeTo == cards[1] and cards[1].name.anchor.x, -12)
Expect("...its words under its name, as a narrator style's are", cards[1].text.anchor.relativeTo == cards[1].name
    and tiles[1].text.anchor.relativeTo == tiles[1].name and cards[1].text.anchor.y == tiles[1].text.anchor.y, true)
local before = #played
cards[2].scripts.OnClick(cards[2])
Expect("a click on a module turns it on", modules.off, true)
Expect("...with the checkbox's sound, as the game's settings make", played[before + 1], 856)
Expect("...and its card comes forward", cards[2].alpha, 1)
cards[2].scripts.OnClick(cards[2])
Expect("a module switched off is not live: its name and icon grey out", cards[2].layoutChecked, false)
Expect("each module is a card of its own, side by side", cards[1].anchor.y == cards[2].anchor.y
    and cards[2].anchor.x > cards[1].anchor.x + cards[1].width, true)
Expect("...the row as wide as the rows: the first card on their left edge", cards[1].anchor.x, layout.left)

---------------------------------------------------------------- narrator styles
Expect("the chosen style stands at full strength", tiles[1].alpha == 1 and tiles[1].layoutWash.shown ~= false, true)
Expect("...its name in gold", tiles[1].layoutSelected, true)
Expect("the others stand back, in the same border", tiles[2].alpha < 1
    and tiles[2].backdrop.edgeFile, [[Interface\Tooltips\UI-Tooltip-Border]])
Expect("...grey round them, gold round the chosen one", tiles[2].backdropBorderColor[1] .. "|" .. tiles[1].backdropBorderColor[1], "0.45|1")
Expect("an unchosen style's tooltip says a click picks it", tiles[2].layoutHint, "Use this.")
Expect("its sketch sits in a small dark screen across the card's top", tiles[1].screen ~= nil and tiles[1].sketch ~= nil, true)
Expect("the chosen style has the page's checkbox in its corner, ticked", tiles[1].check.checked
    and tiles[1].check.shown ~= false, true)
Expect("...the others none at all, not an empty one", tiles[2].check.shown, false)
Expect("the chosen style's sketch in its own colours", tiles[1].sketch.layoutGrey, false)
Expect("...the others' in grey, as a module's icon is while it is off", tiles[2].sketch.layoutGrey, true)
tiles[1].check.scripts.OnClick(tiles[1].check)
Expect("...and a click on it leaves it ticked: a style is chosen by choosing another", tiles[1].check.checked, true)
tiles[2].scripts.OnClick(tiles[2])
Expect("...which moves the tick to it", tiles[2].check.shown ~= false and tiles[1].check.shown, false)
tiles[1].scripts.OnClick(tiles[1])
Expect("room under a style's words, as under a module's", tiles[1].height > 12 * 2 + 66 + 10 + 16 + 6 + 26, true)

---------------------------------------------------------------- values where a control would be
local key = layout:Badge("Play or Pause", function() return "key", "CTRL-P" end)
local count = layout:Badge("Collected Lines", function() return "ok", "7 ready" end, nil, true)
layout:Refresh()
Expect("a key is a value where a setting's control would be", key.message, "CTRL-P")
Expect("...in the game's white", key.state, "neutral")
Expect("...starting where every control starts", key.anchor.x, key.layoutColumn)
Expect("a count reads the same way", count.message .. " " .. tostring(count.anchor.x == count.layoutColumn), "7 ready true")

---------------------------------------------------------------- the scroll bar
do
    local host = CreateFrame("Frame", nil, UIParent)
    local view = Layout.Scroll(host)
    view.range = 300
    view.bar.height, view.thumb.height = 300, 60
    local cursor = 70
    local saved = _G.GetCursorPosition
    _G.GetCursorPosition = function() return 0, cursor end
    -- The thumb's top is at 100 in the stub; the press is 30 below it.
    view.thumb.scripts.OnMouseDown(view.thumb, "LeftButton")
    view.bar.scripts.OnUpdate(view.bar)
    Expect("pressing the scroll bar's thumb holds it where it is, not centred on the pointer",
        view.frame:GetVerticalScroll(), 0)
    cursor = 46
    view.bar.scripts.OnUpdate(view.bar)
    Expect("...and dragging moves the page as far as the pointer moved", view.frame:GetVerticalScroll(), 24 / 240 * 300)
    view.thumb.scripts.OnMouseUp(view.thumb, "LeftButton")
    Expect("...until it is let go", view.dragging, false)
    _G.GetCursorPosition = saved
end

---------------------------------------------------------------- narrow pages
-- Beside the tab sidebar a page is about 470 wide: nothing may run past its right edge.
layout:Section("Buttons")
layout:Columns(2)
local send = layout:Button("How to Send Them", 220, function() end)
local clear = layout:Button("Clear Collected Lines", 220, function() end)
local three = layout:Tiles({ { value = "a", title = "A", text = "" }, { value = "b", title = "B", text = "" },
    { value = "c", title = "C", text = "" } }, function() return "a" end, function() end)
function page:GetWidth() return 470 end
layout:Refresh()
local right = layout.left + layout:Width()
Expect("a line of buttons starts where a setting's name does", send.anchor.x, layout.left + 37)
Expect("...the next 10 after it", clear.anchor.x, send.anchor.x + send.width + 10)
Expect("...and none runs past the row", clear.anchor.x + clear.width <= right, true)
local function Inside(frame) return frame.anchor.x >= layout.left - 0.01 and frame.anchor.x + frame.width <= right + 0.01 end
Expect("the page lays out at the width it is given, not a wider minimum", layout:Width(), math.floor(470 - 25 - 10))
local function Within(frame)
    local boxLeft, boxRight = layout.left, layout.left + layout:Width()
    return frame.anchor.x >= boxLeft - 0.01 and frame.anchor.x + frame.width <= boxRight + 0.01
end
Expect("three narrator styles on one line", three[3].anchor.y == three[1].anchor.y, true)
Expect("...every one inside the boxes' width", Within(three[1]) and Within(three[3]), true)
Expect("...each sketch scaled to fit its screen, no smaller than it need be", three[1].sketch.scale <= 1
    and three[1].sketch.scale > 0.9, true)
Expect("modules keep to one line", cards[1].anchor.y == cards[2].anchor.y, true)
Expect("two buttons too wide for the box share it instead of running out", Inside(send) and Inside(clear), true)
Expect("...still side by side", send.anchor.y == clear.anchor.y, true)

---------------------------------------------------------------- sections have no divider
do
    -- The game's section headers are a title alone; the divider is the page header's.
    local open = CreateFrame("Frame")
    open.children = {}
    function open:GetWidth() return 640 end
    local plain = Layout.New(open, 25, -16)
    plain:Section("Display")
    plain:Checkbox("Show Words", "tip", function() return true end, function() end)
    plain:Refresh()
    Expect("a section has its title and no rule under it, as the game's do", plain.items[1].rule, nil)
end

---------------------------------------------------------------- the voice pack meter
Expect("a module's voice packs are a bar, its count on the right, filled as far as it goes",
    tostring(cards[1].status.layoutMeter) .. " " .. cards[1].status.count.text .. " " .. cards[1].status.fraction, "true 1/1 1")
Expect("...grey with the module off, as its icon is", cards[2].status.layoutGreyed, true)
Expect("...and in colour with it on", cards[1].status.layoutGreyed, false)

os.exit(Failures() == 0 and 0 or 1)
