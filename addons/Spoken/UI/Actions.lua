setfenv(1, SpokenEnv)

-- The strip of buttons under the queue, built from the speaking clip's presentation.
-- Zones bring Read and Report; quests bring Report, and Stop Gossip anchored to the
-- header. The player lays them out and knows nothing about what they do.
--
--   action = { id, text = "Read" | fun():string, tooltip = fun(GameTooltip),
--              label = L.OPT_REPORT_PROBLEM?, -- an icon action's name, where a menu lists it
--              visible = fun():boolean, onClick = fun(clip), anchor = "header"?,
--              create = fun(parent):Button?, onClipChanged = fun(clip, button)? }
--
-- `create` opts a button out of the default template -- the report button builds its
-- own -- and such a button keeps its own OnClick; the player only tells it which clip
-- it now stands beside.
Actions = {}

local ACTION_WIDTH = 70
local ACTION_HEIGHT = 18
-- Big enough to aim at and to read as a bug rather than a smudge.
local ICON_SIZE = 24
local named = 0

--- Whether an action's icon can be drawn. The art these use lives in folders that postdate
--- the three legacy clients, where the texture is simply missing and the button
--- would be a blank square; an action carrying a `text` says what to put there instead.
local function CanDrawIcon()
    return not Version.IsAnyLegacy
end
Actions.STRIP_HEIGHT = ACTION_HEIGHT + 6

-- Actions an addon has declared optional, in the order declared: { id, label }. The player
-- offers a setting for each, named by the addon, and never learns what the action does.
Actions.optional = {}

--- Declare that an action may be switched off, and what to call it in the settings.
function Actions:RegisterOptional(id, label)
    for _, entry in ipairs(self.optional) do
        if entry.id == id then
            entry.label = label or entry.label
            return entry
        end
    end
    local entry = { id = id, label = label or id }
    table.insert(self.optional, entry)
    return entry
end

function Actions:Build(frame)
    frame.actions = { buttons = {}, byId = {}, shown = 0 }
end

local RING = [[Interface\AddOns\Spoken\Textures\SettingsButton]]
-- The Forever client's bronze, as its own frames wear it (MinimalPlayer's): the round buttons' rings
-- take it while Bronze Border is on. Every ring made, to tint again when the setting changes.
local BRONZE = Version.IsCamelot and { .95, .68, .35 } or nil
local rings = setmetatable({}, { __mode = "k" })

local function TintRing(ring)
    local frame = Addon.db and Addon.db.profile and Addon.db.profile.Frame
    if BRONZE and frame and frame.BronzeTint then
        ring:SetVertexColor(BRONZE[1], BRONZE[2], BRONZE[3])
    else
        ring:SetVertexColor(1, 1, 1)
    end
end

--- Every round button's ring in the bronze, or out of it, as Bronze Border now says.
function Actions.RefreshRings()
    for ring in pairs(rings) do TintRing(ring) end
end

--- Dress `button` as the player's round buttons are -- the windows' pause, the subtitle's
--- controls: the ring round its edge, `icon` inside it, brighter under the pointer. Sized by the
--- button, so a corner icon and a subtitle control are the same button at different sizes.
function Actions.RoundIcon(button, icon)
    local ring = button:CreateTexture(nil, "BACKGROUND")
    ring:SetTexture(RING)
    ring:SetPoint("TOPLEFT", button, "TOPLEFT", -3, 3)
    ring:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT", 3, -3)
    rings[ring] = true
    TintRing(ring)
    local glyph = button:CreateTexture(nil, "ARTWORK")
    glyph:SetPoint("TOPLEFT", button, "TOPLEFT", 4, -4)
    glyph:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT", -4, 4)
    if icon then glyph:SetTexture(icon) end
    glyph:SetAlpha(0.85)
    -- Brighter under the pointer; a disabled button keeps the dimmer look it was given.
    button:HookScript("OnEnter", function() if button:IsEnabled() then glyph:SetAlpha(1) end end)
    button:HookScript("OnLeave", function() if button:IsEnabled() then glyph:SetAlpha(0.85) end end)
    button.ring, button.glyph = ring, glyph
    return button
end

local ROUND_SIZE = 24
local PORTRAIT_ATLAS = [[Interface\AddOns\Spoken\Textures\PortraitFrameAtlas]]
local PORTRAIT_ATLAS_SIZE = 512
local BUG = [[Interface\HelpFrame\HelpIcon-Bug]]

--- A Report button's right-click: the debug log's menu, where the Spoken_Developer module is
--- installed (Developer.lua). Hooked on mouse-up rather than set as the click, so whatever the
--- caller gives the button as OnClick keeps the left button, and a caller that sets OnClick after
--- this does not undo it. `isReport(button)`, optional, says whether the button reports right
--- now: the windows' action buttons are reused for other actions.
function Actions.OfferLogMenu(button, isReport)
    if button.offersLogMenu then return end
    button.offersLogMenu = true
    button:HookScript("OnMouseUp", function(self, mouse)
        if mouse ~= "RightButton" or (isReport and not isReport(self)) then return end
        if GameTooltip:GetOwner() == self then GameTooltip_Hide() end
        Developer:ShowMenu(self)
    end)
end

--- The line a Report button's tooltip ends with, where the menu exists.
function Actions.AddLogMenuHint(tooltip)
    local hint = Developer:MenuHint()
    if hint then tooltip:AddLine(hint, 0.6, 0.6, 0.6, true) end
end

--- The subtitle's round button, the one every window shows: 24 across, the player's ring,
--- `glyphSize` square glyph centred in it (or reaching the rim with none). Made without a parent
--- and given one after, which a button on the open quest log needs (taint), and which costs the
--- rest nothing. `name` for a button that must be named.
function Actions.RoundButton(parent, glyphSize, name)
    local button = CreateFrame("Button", name, nil)
    button:SetParent(parent)
    button:SetSize(ROUND_SIZE, ROUND_SIZE)
    Actions.RoundIcon(button)
    if glyphSize then
        button.glyph:ClearAllPoints()
        button.glyph:SetPoint("CENTER")
        button.glyph:SetSize(glyphSize, glyphSize)
    end
    button:HookScript("OnLeave", function()
        if GameTooltip:GetOwner() == button then GameTooltip_Hide() end
    end)
    return button
end

-- A line's button shows one of three glyphs: Play for a line not yet queued, Stop while it
-- speaks, Replay once it is stopped and still at the head. Play is the portrait atlas's cell;
-- Stop and Replay are drawn in its gold, each in a 93-wide cell of a 128 canvas.
local GLYPH_STOP = [[Interface\AddOns\Spoken\Textures\GlyphStop]]
local GLYPH_REPLAY = [[Interface\AddOns\Spoken\Textures\GlyphReplay]]
local CELL = 93 / 128

function Actions.Glyph(texture, state)
    if state == "stop" or state == "replay" then
        texture:SetTexture(state == "stop" and GLYPH_STOP or GLYPH_REPLAY)
        texture:SetTexCoord(0, CELL, 0, CELL)
        return
    end
    texture:SetTexture(PORTRAIT_ATLAS)
    texture:SetTexCoord(0, 93 / PORTRAIT_ATLAS_SIZE, 419 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE)
end

--- Stop while the head plays, Replay once it is stopped.
function Actions.HeadState()
    return SoundQueue:IsPaused() and "replay" or "stop"
end

--- A round button's glyph for `state`, remembered on it for its tooltip.
function Actions.SetPlayGlyph(button, state)
    Actions.Glyph(button.glyph, state)
    button.state, button.playing = state, state == "stop"
end

local PORTRAIT_MASK = [[Interface\CharacterFrame\TempPortraitAlphaMask]]
local VIGNETTE = [[Interface\AddOns\Spoken\Textures\RoundVignette]]

--- `icon` filling the ring's dark middle, cut round with the game's portrait mask, its own bevel
--- trimmed off. The ring (SettingsButton, 32 drawn at 30) is dark from its 6th pixel to its
--- 24th, about 18 across on screen, its rim outside that: 3 in from the button's edge fills the
--- middle and leaves the rim. Left square, the icon's corners showed past the rim.
function Actions.RoundPicture(button, icon)
    local glyph = button.glyph
    glyph:ClearAllPoints()
    glyph:SetPoint("TOPLEFT", button, "TOPLEFT", 3, -3)
    glyph:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT", -3, 3)
    glyph:SetTexture(icon)
    glyph:SetTexCoord(0.08, 0.92, 0.08, 0.92)
    local mask = button.CreateMaskTexture and glyph.AddMaskTexture and button:CreateMaskTexture()
    if type(mask) == "table" then
        mask:SetTexture(PORTRAIT_MASK, "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE")
        mask:SetAllPoints(glyph)
        glyph:AddMaskTexture(mask)
        button.mask = mask
    elseif SetPortraitToTexture then
        SetPortraitToTexture(glyph, icon)
    end
    -- A vignette over it, darkest at the rim: the play and bug glyphs sit on the ring's black,
    -- and a bright picture edge to edge stood out beside them.
    local vignette = button:CreateTexture(nil, "ARTWORK", nil, 1)
    vignette:SetTexture(VIGNETTE)
    vignette:SetAllPoints(glyph)
    button.vignette = vignette
end

--- The round Play and Report buttons, as feature addons ask for them (Spoken:CreateRoundButton),
--- and "icon", with `icon` in the ring, cut round to sit inside it.
function Actions.NewRound(parent, kind, name, icon)
    if kind == "play" then
        local button = Actions.RoundButton(parent, 12, name)
        Actions.SetPlayGlyph(button, "play")
        --- "play", "stop" or "replay".
        function button:SetState(state) Actions.SetPlayGlyph(self, state) end
        function button:SetPlaying(playing) Actions.SetPlayGlyph(self, playing and "stop" or "play") end
        -- Greyed, as a button with nothing to play.
        button:HookScript("OnDisable", function(self)
            if self.glyph.SetDesaturated then self.glyph:SetDesaturated(true) end
            self.glyph:SetAlpha(0.4)
        end)
        button:HookScript("OnEnable", function(self)
            if self.glyph.SetDesaturated then self.glyph:SetDesaturated(false) end
            self.glyph:SetAlpha(0.85)
        end)
        return button
    end
    local button = Actions.RoundButton(parent, nil, name)
    if kind == "icon" and icon then
        Actions.RoundPicture(button, icon)
        return button
    end
    button.glyph:SetTexture(BUG)
    Actions.OfferLogMenu(button)
    return button
end

local function NewButton(frame, action)
    local button
    if action.create then
        button = action.create(frame)
    elseif action.icon then
        if CanDrawIcon() then
            -- No template: a button that is only a texture wants none of
            -- UIPanelButtonTemplate's furniture.
            -- The player's round button, the same Report the subtitle shows.
            button = CreateFrame("Button", nil, frame)
            button:SetSize(ICON_SIZE, ICON_SIZE)
            Actions.RoundIcon(button, action.icon)
            button.showsIcon = true
        else
            -- Named, because 1.12's UIPanelButtonTemplate names its label "$parentText"
            -- and an unnamed button leaves that substitution with nothing to resolve.
            named = named + 1
            button = CreateFrame("Button", "SpokenActionButton" .. named, frame,
                "UIPanelButtonTemplate")
            button:SetSize(ICON_SIZE + 8, ICON_SIZE + 4)
            button:SetText(action.text or "?")
        end
        button:SetScript("OnClick", function(self)
            if self.action and self.action.onClick then
                self.action.onClick(frame.actions.clip)
            end
        end)
        -- Hooked, not set: the round icon's own hover (Actions.RoundIcon) stays.
        button:HookScript("OnEnter", function(self)
            if self.action and self.action.tooltip then
                GameTooltip:SetOwner(self, "ANCHOR_LEFT")
                self.action.tooltip(GameTooltip)
                if self.action.id == "report" then Actions.AddLogMenuHint(GameTooltip) end
                GameTooltip:Show()
            end
        end)
        button:HookScript("OnLeave", function() GameTooltip_Hide() end)
        Actions.OfferLogMenu(button, function(self) return self.action and self.action.id == "report" end)
    else
        button = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
        button:SetScript("OnClick", function(self)
            if self.action and self.action.onClick then
                self.action.onClick(frame.actions.clip)
            end
        end)
        button:SetScript("OnEnter", function(self)
            if self.action and self.action.tooltip then
                GameTooltip:SetOwner(self, "ANCHOR_LEFT")
                self.action.tooltip(GameTooltip)
                GameTooltip:Show()
            end
        end)
        button:SetScript("OnLeave", function() GameTooltip_Hide() end)
    end
    if not action.create and not action.icon then
        button:SetSize(ACTION_WIDTH, ACTION_HEIGHT)
    end
    return button
end

--- The corner icon action (Report) `clip` offers, for a frame that draws its own button for it
--- -- the subtitle. Nil when the clip has none, or the player hid it.
function Actions:CornerAction(clip)
    local list = clip and clip.present and clip.present.actions or {}
    local hidden = Addon:Profile("Frame").HiddenActions or {}
    for _, action in ipairs(list) do
        if action.anchor == "topright" and action.icon and not hidden[action.id]
            and (not action.visible or action.visible()) then
            return action
        end
    end
end

--- Lay out the actions for `clip` (the head), hiding whatever the last clip left.
---@return number shown
function Actions:Configure(frame, clip)
    -- One setting covers the lot. Every action either of the shipped addons offers is a
    -- convenience beside the line, so "hide them" is a player-wide answer rather than one
    -- checkbox per addon per button.
    local list = clip and clip.present and clip.present.actions or {}
    frame.actions.clip = clip
    local previous, shown, placed = nil, 0, 0
    local inUse = {}
    -- Keyed by source as well as id: both shipped addons call their action "report", and
    -- one button between them means the addon that built it first answers for the other.
    -- A button an addon built keeps its own click handler, so that is not a label problem.
    local owner = clip and clip.source and clip.source.key or "?"

    local hidden = Addon:Profile("Frame").HiddenActions or {}
    for _, action in ipairs(list) do
        if not hidden[action.id] and (not action.visible or action.visible()) then
            local id = owner .. ":" .. action.id
            local button = frame.actions.byId[id]
            if not button then
                button = NewButton(frame, action)
                frame.actions.byId[id] = button
            end
            button.action = action
            inUse[id] = true

            local text = action.text
            if type(text) == "function" then text = text() end
            -- An icon button has no label to set; its `text` is the fallback for a client
            -- that cannot draw the icon, and that was read when it was built.
            if text and not button.showsIcon then button:SetText(text) end
            if action.onClipChanged then action.onClipChanged(clip, button) end

            button:ClearAllPoints()
            if action.anchor == "topright" then
                -- Out of the way of the line being read, and it makes no room for itself:
                -- the strip below the queue is what pushes the rows up.
                button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -8, -8)
            elseif action.anchor == "header" then
                button:SetPoint("BOTTOMLEFT", frame.container.name, "RIGHT", -6, 0)
            elseif previous then
                button:SetPoint("BOTTOMLEFT", previous, "BOTTOMRIGHT", 4, 0)
                previous = button
            else
                button:SetPoint("BOTTOMLEFT", frame.portrait, "BOTTOMRIGHT", 15, 4)
                previous = button
            end
            button:Show()
            placed = placed + 1
            frame.actions.buttons[placed] = button
            if action.anchor ~= "topright" then
                shown = shown + 1
            end
        end
    end
    for id, button in pairs(frame.actions.byId) do
        if not inUse[id] then button:Hide() end
    end
    for i = placed + 1, getn(frame.actions.buttons) do
        frame.actions.buttons[i] = nil
    end
    frame.actions.shown = shown
    return shown
end
