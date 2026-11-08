setfenv(1, SpokenEnv)

-- The frame's settings, or their defaults once AceDB has stripped them (Addon:Profile).
local function FrameConfig()
    return Addon:Profile("Frame")
end

-- The large window, the "classic" narrator style: the game's Talking Head frame as
-- TalkingHeadUI.xml lays it out, with Spoken's round controls where it has its close button.
-- Clients without its atlases draw Spoken's own art in the same places.
--
-- Refreshed through the player's AUDIO_CHANGED callback rather than by the queue
-- calling this file, which is what keeps SoundQueue.lua free of any dependency on it.
PlayerFrame = {}

-- TalkingHeadUI.xml: the frame and its box are 570 by 155; the portrait's frame is 143 across, 5
-- in and 6 down; the model 115 across, 21 in and 21 down; the name 2 right of the portrait's frame
-- and 19 down from its top; the words 3 under the name, ending 42 from the right.
local FRAME_WIDTH, FRAME_HEIGHT = 570, 155
local RING_X, RING_Y, RING_SIZE = 5, -6, 143
local PORTRAIT_X, PORTRAIT_Y, PORTRAIT_SIZE = 21, -21, 115
local NAME_X, NAME_Y = RING_X + RING_SIZE + 2, RING_Y - 19
local WORDS_UNDER, RIGHT = 3, 42
-- The box art's shadow is full dark 15 under the frame's top, 12 in from its right and 13 over its
-- foot (measured in game); its edges fade out past that. The round controls and the progress line
-- sit PAD inside it.
local SHADE_TOP, SHADE_RIGHT, SHADE_FOOT, PAD = 15, 12, 13, 10
local CORNER_X, CORNER_Y, FOOT = SHADE_RIGHT + PAD, SHADE_TOP + PAD, SHADE_FOOT + PAD
-- At most this many lines of words, fewer where Text Size leaves no room for them over the
-- progress line, BAR_GAP above it.
local MOST_LINES, BAR_GAP = 3, 6
-- Where the name starts with the portrait hidden: as far in as the words end on the right.
local BARE_LEFT = RIGHT
-- The atlases, the first of each the client has. Forever's portrait frame for the dark box is the
-- Alliance one; Classic Era names the same art without the faction.
local RING = { "TalkingHeads-Alliance-PortraitFrame", "TalkingHeads-PortraitFrame" }
local BOX = { "TalkingHeads-TextBackground" }
local FACE = { "TalkingHeads-PortraitBg" }
-- Spoken's own portrait art: the border's cell in PortraitFrameAtlas, and the opening in it.
local PORTRAIT_ATLAS_SIZE = 512
local PORTRAIT_ATLAS_BORDER_SIZE = 416
local PORTRAIT_ATLAS_VIEWPORT_SIZE = 348
local PORTRAIT_BORDER_OUTSET = 34 * PORTRAIT_SIZE / PORTRAIT_ATLAS_VIEWPORT_SIZE
-- The name's height, for the words under it, and the gap left before the round controls.
local NAME_SIZE, NAME_GAP = 22, 8
local ROUND_GAP = Actions.ROUND_GAP
local TEXTURES = [[Interface\AddOns\Spoken\Textures\]]
-- TalkingHeadUI.lua's colours for its dark box: a gold name, white words, black shadows.
local NAME_COLOR = { 1, .82, .02 }
local WORDS_COLOR = { 1, 1, 1 }
local TAIL_COLOR = { .6, .6, .6 }
local LABEL_GAP = 6
local LABEL_LEAST = "· ..."

do
    local font = CreateFont("SpokenNameFont")
    font:SetFont(GameFontNormal:GetFont(), NAME_SIZE - 2, "")
    font:SetShadowColor(0, 0, 0)
    font:SetShadowOffset(1, -1)
    font:SetJustifyH("LEFT")
    font:SetJustifyV("TOP")
end
do
    local font = CreateFont("SpokenLabelFont")
    font:SetFont(GameFontNormal:GetFont(), 14, "")
    font:SetShadowColor(0, 0, 0)
    font:SetShadowOffset(1, -1)
    font:SetJustifyH("LEFT")
    font:SetJustifyV("MIDDLE")
end

local Label, Speaker, Waiting = Actions.Label, Actions.Speaker, Actions.Waiting

-- Art for the large window: each classic race gets its own material language around the same
-- transparent dialogue center, plus a matching color wash behind the text.
local RACIAL_ART = {
    NightElf = {
        edge = TEXTURES .. "RaceTrim/NightElfEdge",
        edgeV = TEXTURES .. "RaceTrim/NightElfEdgeV",
        join = TEXTURES .. "RaceTrim/NightElfJoin",
        -- Preserve the original purple wash and its natural gradient fade.
        tint = { .28, .08, .45, .34 },
    },
    Human = {
        edge = TEXTURES .. "RaceTrim/HumanEdge",
        edgeV = TEXTURES .. "RaceTrim/HumanEdgeV",
        join = TEXTURES .. "RaceTrim/HumanJoin",
        tint = { .10, .16, .35, .30 },
    },
    Dwarf = {
        edge = TEXTURES .. "RaceTrim/DwarfEdge",
        edgeV = TEXTURES .. "RaceTrim/DwarfEdgeV",
        join = TEXTURES .. "RaceTrim/DwarfJoin",
        tint = { .32, .14, .04, .30 },
    },
    Gnome = {
        edge = TEXTURES .. "RaceTrim/GnomeEdge",
        edgeV = TEXTURES .. "RaceTrim/GnomeEdgeV",
        join = TEXTURES .. "RaceTrim/GnomeJoin",
        edgeVPeriod = 8,
        tint = { .18, .30, .34, .28 },
    },
    Orc = {
        edge = TEXTURES .. "RaceTrim/OrcEdge",
        edgeV = TEXTURES .. "RaceTrim/OrcEdgeV",
        join = TEXTURES .. "RaceTrim/OrcJoin",
        tint = { .28, .04, .02, .30 },
    },
    Tauren = {
        edge = TEXTURES .. "RaceTrim/TaurenEdge",
        edgeV = TEXTURES .. "RaceTrim/TaurenEdgeV",
        join = TEXTURES .. "RaceTrim/TaurenJoin",
        tint = { .28, .14, .05, .28 },
    },
    Troll = {
        edge = TEXTURES .. "RaceTrim/TrollEdge",
        edgeV = TEXTURES .. "RaceTrim/TrollEdgeV",
        join = TEXTURES .. "RaceTrim/TrollJoin",
        tint = { .04, .22, .28, .30 },
    },
    Undead = {
        edge = TEXTURES .. "RaceTrim/UndeadEdge",
        edgeV = TEXTURES .. "RaceTrim/UndeadEdgeV",
        join = TEXTURES .. "RaceTrim/UndeadJoin",
        edgeVPeriod = 8,
        tint = { .05, .20, .07, .32 },
    },
    Forsaken = {
        edge = TEXTURES .. "RaceTrim/ForsakenEdge",
        edgeV = TEXTURES .. "RaceTrim/ForsakenEdgeV",
        join = TEXTURES .. "RaceTrim/ForsakenJoin",
        tint = { .12, .22, .10, .32 },
    },
    HighOrder = {
        edge = TEXTURES .. "RaceTrim/HighOrderEdge",
        edgeV = TEXTURES .. "RaceTrim/HighOrderEdgeV",
        join = TEXTURES .. "RaceTrim/HighOrderJoin",
        edgeVPeriod = 8,
        tint = { .22, .10, .40, .32 },
    },
    Windshapers = {
        edge = TEXTURES .. "RaceTrim/WindshapersEdge",
        edgeV = TEXTURES .. "RaceTrim/WindshapersEdgeV",
        join = TEXTURES .. "RaceTrim/WindshapersJoin",
        edgeVPeriod = 8,
        tint = { .04, .20, .32, .32 },
    },
}

local function RaceFromText(text)
    if type(text) ~= "string" then return end
    local value = string.lower(text)
    local compact = string.gsub(value, "[^%a]", "")
    local function HasWord(word)
        return string.find(value, "%f[%a]" .. word .. "%f[%A]") ~= nil
    end
    if string.find(compact, "nightelf", 1, true) or string.find(value, "night%s+elf") then
        return "NightElf"
    end
    if HasWord("human") then return "Human" end
    if HasWord("dwarf") then return "Dwarf" end
    if HasWord("gnome") then return "Gnome" end
    if HasWord("orc") then return "Orc" end
    if HasWord("tauren") then return "Tauren" end
    if HasWord("troll") then return "Troll" end
    if HasWord("forsaken") then return "Forsaken" end
    if string.find(compact, "highorder", 1, true) or HasWord("skyborne") then
        return "HighOrder"
    end
    if string.find(compact, "windshaper", 1, true) then return "Windshapers" end
    if HasWord("scourge") or HasWord("undead") then
        return "Undead"
    end
    if string.find(compact, "sentinelkyra", 1, true)
        or string.find(compact, "kyrastarsong", 1, true)
        or string.find(compact, "cantoestelar", 1, true)
        or string.find(compact, "iverron", 1, true) then
        return "NightElf"
    end
end

local function RaceFromCreature(creature)
    if not creature then return end
    local dataModules = VoiceOver and VoiceOver.DataModules
    if not dataModules or not dataModules.GetModules then return end
    local race
    for _, module in dataModules:GetModules() do
        local bodies = module.NPCBodiesByNPCID and module.NPCBodiesByNPCID[creature]
        if bodies then
            for body in pairs(bodies) do
                race = RaceFromText(body)
                if race then return race end
            end
        end
    end
end

local function UnitForGUID(guid)
    if not guid or not UnitTokenFromGUID then return end
    local ok, unit = pcall(UnitTokenFromGUID, guid)
    return ok and NotSecret(unit)
end

local function SpeakerRace(clip)
    local present = clip and clip.present
    local portrait = present and present.portrait
    local wanted = portrait and portrait.unitGUID or clip and clip.unitGUID
    local units = {}
    local exact = UnitForGUID(wanted)
    if exact then table.insert(units, exact) end
    for _, unit in ipairs({ "questnpc", "npc", "target", "mouseover", "focus", "softinteract", "softenemy" }) do
        if unit ~= exact then table.insert(units, unit) end
    end
    local function RaceForUnit(unit)
        if not UnitExists or not UnitExists(unit) then return end
        local guid = UnitGUID and NotSecret(UnitGUID(unit))
        if _G.UnitRace then
            local ok, name, file = pcall(_G.UnitRace, unit)
            local race = ok and RaceFromText(file or name)
            if race then return race end
        end
        if guid and VoiceOver and VoiceOver.Utils and VoiceOver.Utils.GetBodyForGUID then
            local ok, body = pcall(VoiceOver.Utils.GetBodyForGUID, VoiceOver.Utils, guid)
            local race = ok and RaceFromText(body)
            if race then return race end
        end
        -- NPCs do not always expose UnitRace. Prime the existing model probe; its body becomes
        -- available to GetBodyForGUID on a later frame update without a creature-ID table.
        if guid and VoiceOver and VoiceOver.NPCModel and VoiceOver.NPCModel.Prime then
            pcall(VoiceOver.NPCModel.Prime, VoiceOver.NPCModel, guid, unit)
        end
    end
    local race
    for _, unit in ipairs(units) do
        local actual = UnitGUID and NotSecret(UnitGUID(unit))
        if (not wanted or actual == wanted) then
            race = RaceForUnit(unit)
            if race then return race end
        end
    end
    -- A synthetic/log GUID will not match the live unit. The interaction's questnpc/npc is still
    -- the correct speaker in that case.
    for _, unit in ipairs({ "questnpc", "npc" }) do
        race = RaceForUnit(unit)
        if race then return race end
    end

    -- The prepared NPC body is more reliable than the words being spoken, and survives after
    -- the dialog's unit token has gone away.
    race = RaceFromText(clip and (clip.npcBody or clip.race))
        or RaceFromText(portrait and portrait.body)
    if race then return race end
    if clip and clip.unitGUID and VoiceOver and VoiceOver.Utils and VoiceOver.Utils.GetBodyForGUID then
        local ok, body = pcall(VoiceOver.Utils.GetBodyForGUID, VoiceOver.Utils, clip.unitGUID)
        race = ok and RaceFromText(body)
        if race then return race end
    end

    local creature = portrait and portrait.creatureID
    if not creature and clip and clip.unitGUID and VoiceOver and VoiceOver.Utils
        and VoiceOver.Utils.GetCreatureIDFromGUID then
        local ok, id = pcall(VoiceOver.Utils.GetCreatureIDFromGUID, VoiceOver.Utils, clip.unitGUID)
        creature = ok and id
    end
    race = RaceFromCreature(creature)
    if race then return race end

    -- Gossip/quest text is the final fallback. This covers NPCs whose Classic unit token does
    -- not expose a race and whose model has not been cached yet (for example this Tauren line).
    -- It intentionally comes after the authoritative sources so mentioning another race does
    -- not change the speaker's treatment when the client already knows the speaker.
    return RaceFromText(clip and clip.text)
        or RaceFromText(present and present.transcript)
        or RaceFromText(clip and clip.name)
        or RaceFromText(present and present.header)
end

local function RaceLook(clip)
    local race = SpeakerRace(clip)
    return race and RACIAL_ART[race]
end

local function FirstAtlas(names)
    for _, name in ipairs(names) do
        if Actions.HasAtlas(name) then return name end
    end
    return nil
end

function PlayerFrame:Initialize()
    if self.frame then return end
    self:InitDisplay()
    self:InitPortrait()
    self:InitHeader()
    self:InitMover()
    Actions:Build(self.frame)
    self.fader = Actions.Fader(self.frame, function() return { self.frame.portrait.model } end, function()
        -- Faded out to turn to the next line: now it comes in.
        if self.turning then self.turning = nil; self:Update() end
    end)
    -- A window turning to the next line fades out with the words it shows: the captions wait for
    -- it rather than taking the next line's first.
    Transcript.holdFor = function(clip)
        local window = self:Skin() or self
        return window.WillTurn ~= nil and window:WillTurn(clip)
    end
    self:RefreshConfig()
    Callbacks:Register("AUDIO_CHANGED", function() PlayerFrame:Update() end)
    Actions.WatchDialogs(function() PlayerFrame:Update(); Subtitle:Update() end)
end

function PlayerFrame:InitDisplay()
    self.frame = CreateFrame("Frame", "SpokenPlayerFrame", UIParent, "BackdropTemplate")
    function self.frame:Reset()
        self:ClearAllPoints()
        self:SetPoint("BOTTOM", 0, 200)
    end
    self.frame:SetSize(FRAME_WIDTH, FRAME_HEIGHT)
    self.frame:Reset()
    Addon:RestoreLayout("Player", self.frame)
    self.frame:SetMovable(true)
    self.frame:SetClampedToScreen(true)
    -- Placed from the saved layout instead; the client's cache would only fight it.
    self.frame:SetUserPlaced(false)
    self.frame:SetFrameStrata(FrameConfig().FrameStrata)
    self.frame:Hide()

    self.frame.background = self.frame:CreateTexture(nil, "BACKGROUND")
    self.frame.background:SetPoint("TOPLEFT", 8, -8)
    self.frame.background:SetPoint("BOTTOMRIGHT", -8, 8)
    self.frame.raceTint = self.frame:CreateTexture(nil, "BACKGROUND", nil, 1)
    self.frame.raceTint:SetColorTexture(.28, .08, .45, .34)
    self.frame.raceTint:Hide()
    self.frame:SetBackdrop({
        edgeFile = [[Interface\DialogFrame\UI-DialogBox-Gold-Border]],
        edgeSize = 32,
        tile = true,
        tileSize = 32,
        insets = { left = 8, right = 8, top = 8, bottom = 8 },
    })
    self.frame:SetBackdropBorderColor(1, 1, 1, 0)
    self.frame.raceBorderFrame = CreateFrame("Frame", nil, self.frame)
    self.frame.raceBorderFrame:SetFrameLevel(self.frame:GetFrameLevel() + 2)
    self.frame.raceBorderFrame:SetAllPoints(self.frame)
    self.frame.raceBorderFrame:Hide()
    self.frame.raceTrim = {}
    for _, name in ipairs({
        "topLeft", "topRight", "bottomLeft", "bottomRight",
        "leftTop", "leftBottom", "rightTop", "rightBottom",
        "cornerTopLeft", "cornerTopRight", "cornerBottomLeft", "cornerBottomRight",
    }) do
        self.frame.raceTrim[name] = self.frame.raceBorderFrame:CreateTexture(nil, "OVERLAY")
    end

    self.frame.container = CreateFrame("Frame", nil, self.frame)
    self.frame.container:SetFrameLevel(self.frame.raceBorderFrame:GetFrameLevel() + 1)

    self.frame:SetScript("OnUpdate", function(_, elapsed) self:Tick(elapsed) end)
end

function PlayerFrame:InitPortrait()
    self.frame.portrait = CreateFrame("Frame", nil, self.frame)
    self.frame.portrait:SetSize(PORTRAIT_SIZE, PORTRAIT_SIZE)
    self.frame.portrait:SetPoint("TOPLEFT", self.frame, "TOPLEFT", PORTRAIT_X, PORTRAIT_Y)

    self.frame.portrait.background = self.frame.portrait:CreateTexture(nil, "BACKGROUND")
    self.frame.portrait.background:SetAllPoints()

    -- A separate frame so the border and the mover draw above the face.
    self.frame.portrait.border = CreateFrame("Frame", nil, self.frame.portrait)
    self.frame.portrait.border:SetFrameLevel(self.frame.portrait:GetFrameLevel() + 3)
    self.frame.portrait.border:SetAllPoints()
    self.frame.portrait.border.texture = self.frame.portrait.border:CreateTexture(nil, "OVERLAY")
end

function PlayerFrame:InitHeader()
    local container = self.frame.container
    container.name = container:CreateFontString(nil, "ARTWORK", "SpokenNameFont")
    -- The Talking Head's own font where the client has it.
    if Fancy22Font then container.name:SetFontObject(Fancy22Font) end
    container.name:SetJustifyH("LEFT")
    container.name:SetWordWrap(false)
    container.name:SetTextColor(NAME_COLOR[1], NAME_COLOR[2], NAME_COLOR[3])
    container.name:SetShadowColor(0, 0, 0, 1)
    container.name:SetShadowOffset(1, -1)
    container.name:SetPoint("TOPLEFT", container, "TOPLEFT", 0, 0)
    container.label = container:CreateFontString(nil, "ARTWORK", "SpokenLabelFont")
    container.label:SetWordWrap(false)
    container.label:SetTextColor(unpack(Actions.TITLE_COLOR))
    container.label:Hide()
    -- The whole of a line's name cut short.
    container.labelHover = Actions.Hover(container.label, function(owner)
        GameTooltip:SetOwner(owner, "ANCHOR_TOP")
        GameTooltip:SetText(Label(self.shown))
        GameTooltip:Show()
    end)
    local function TailText()
        local text = container:CreateFontString(nil, "ARTWORK", "SpokenLabelFont")
        text:SetWordWrap(false)
        text:SetTextColor(TAIL_COLOR[1], TAIL_COLOR[2], TAIL_COLOR[3])
        text:Hide()
        return text
    end
    self.stopped, self.count, self.held = TailText(), TailText(), TailText()
    self.stopped:SetText(format("· (%s)", L.SUBTITLE_STOPPED))
    self.tail = Actions.Tail(self.stopped, self.count, self.held)
    for _, text in ipairs({ container.name, self.stopped, self.count, self.held }) do Ellesmere:Refont(text) end

    self.controls = CreateFrame("Frame", nil, container)
    self.controls:SetHeight(1)
    self.controls:SetPoint("TOPRIGHT", self.frame, "TOPRIGHT", -CORNER_X, -CORNER_Y)
    self.play = Actions.StopButton(self.controls, function() return self:Current() ~= nil end,
        function() self:UpdateControls() end)
    self.skip = Actions.SkipButton(self.controls)
    self.buttons = { self.play, self.skip }

    self.progress = Actions.ProgressBar(container)
    self.progress.track:SetPoint("BOTTOMLEFT", container, "BOTTOMLEFT", 0, 0)
end

function PlayerFrame:InitMover()
    local mover = CreateFrame("Button", nil, self.frame.portrait.border)
    self.frame.mover = mover
    mover:SetSize(26, 26)
    -- The move arrows' cell of the portrait atlas, centred, a little smaller pushed in.
    local function Arrows(texture, size)
        texture:SetTexCoord(462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE, 462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE)
        texture:ClearAllPoints()
        texture:SetPoint("CENTER")
        texture:SetSize(size, size)
    end
    mover:SetNormalTexture(TEXTURES .. "PortraitFrameAtlas")
    Arrows(mover:GetNormalTexture(), 16)
    mover:SetPushedTexture(TEXTURES .. "PortraitFrameAtlas")
    Arrows(mover:GetPushedTexture(), 14)
    mover.background = mover:CreateTexture(nil, "BACKGROUND")
    mover.background:SetTexture(TEXTURES .. "SettingsButton")
    mover.background:SetPoint("CENTER")
    mover.background:SetSize(32, 32)
    Actions.TintWithRings(mover.background)
    mover:HookScript("OnEnter", function(button)
        if Addon:IsFrameLocked() then return end
        SetCursor([[Interface\Cursor\UI-Cursor-Move]])
        GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
        GameTooltip:SetText(L.OPT_STYLE_CLASSIC)
        GameTooltip:AddLine(L.QUEUE_DRAG_HINT, 1, 1, 1, true)
        GameTooltip:Show()
    end)
    mover:HookScript("OnLeave", function() SetCursor(nil); GameTooltip_Hide() end)
    mover:HookScript("OnMouseDown", function()
        if Addon:IsFrameLocked() then return end
        Snap.Start(self.frame, { locked = function() return Addon:IsFrameLocked() end })
    end)
    mover:HookScript("OnMouseUp", function()
        if Addon:IsFrameLocked() then return end
        Snap.Stop()
        self:SaveLayout()
    end)
end

--- The skin drawing the queue in place of this window, or nil when this window does.
function PlayerFrame:Skin()
    if MinimalPlayer:IsEnabled() then return MinimalPlayer end
    if DialogueUIPlayer and DialogueUIPlayer:IsEnabled() then return DialogueUIPlayer end
    return nil
end

--- Whether this window shows the lines: the large window chosen, no skin in its place.
function PlayerFrame:IsShowing()
    return self:Skin() == nil and Addon:DisplayStyle() == "classic"
end

--- The Talking Head's atlases where the client has every one; nil for Spoken's own art.
function PlayerFrame:Art()
    local ring, box, face = FirstAtlas(RING), FirstAtlas(BOX), FirstAtlas(FACE)
    if not (ring and box and face) then return nil end
    return { ring = ring, box = box, face = face }
end

local function DrawArt(frame, art)
    local portrait = frame.portrait
    local border = portrait.border.texture
    border:ClearAllPoints()
    if art then
        frame.background:SetAtlas(art.box)
        portrait.background:SetAtlas(art.face)
        border:SetAtlas(art.ring)
        border:SetSize(RING_SIZE, RING_SIZE)
        border:SetPoint("TOPLEFT", portrait, "TOPLEFT", RING_X - PORTRAIT_X, RING_Y - PORTRAIT_Y)
        return
    end
    frame.background:SetTexture(TEXTURES .. "BackgroundGradient")
    frame.background:SetTexCoord(0, 1, 0, 1)
    portrait.background:SetTexture(TEXTURES .. "PortraitFrameBackground")
    portrait.background:SetTexCoord(0, 1, 0, 1)
    border:SetTexture(TEXTURES .. "PortraitFrameAtlas")
    border:SetTexCoord(0, PORTRAIT_ATLAS_BORDER_SIZE / PORTRAIT_ATLAS_SIZE, 0, PORTRAIT_ATLAS_BORDER_SIZE / PORTRAIT_ATLAS_SIZE)
    border:SetPoint("TOPLEFT", portrait, "TOPLEFT", -PORTRAIT_BORDER_OUTSET, PORTRAIT_BORDER_OUTSET)
    border:SetPoint("BOTTOMRIGHT", portrait, "BOTTOMRIGHT", PORTRAIT_BORDER_OUTSET, -PORTRAIT_BORDER_OUTSET)
end

--- The box and the portrait's art. Art that fails to draw leaves Spoken's own, and its error goes
--- to the error handler.
function PlayerFrame:ApplyArt()
    local art = self:Art()
    if art then
        local ok, err = pcall(DrawArt, self.frame, art)
        if not ok then
            art = nil
            if geterrorhandler then geterrorhandler()(err) end
        end
    end
    if not art then DrawArt(self.frame, nil) end
    self.art = art
end

function PlayerFrame:ApplyRaceArt(clip)
    local frame, look = self.frame, RaceLook(clip)
    frame.raceBorderFrame:SetShown(look ~= nil)
    frame.raceTint:SetShown(look ~= nil)
    if not look then
        frame:SetBackdropBorderColor(1, 1, 1, 1)
        frame.portrait.border.texture:SetAlpha(1)
        return
    end
    frame.raceTint:ClearAllPoints()
    frame.raceTint:SetPoint("TOPLEFT", frame, "TOPLEFT",
        FrameConfig().HidePortrait and BARE_LEFT - 8 or NAME_X - 8, -8)
    frame.raceTint:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -8, 8)
    frame.raceTint:SetColorTexture(unpack(look.tint))
    self:PaintRaceTrim(look)
    frame:SetBackdropBorderColor(1, 1, 1, 0)
    -- The thin WC3 trim does not replace the portrait's own ring.
    frame.portrait.border.texture:SetAlpha(1)
end

function PlayerFrame:PaintRaceTrim(look)
    local frame, trim = self.frame, self.frame.raceTrim
    local edge, inset = 14, 4
    local out = edge - inset
    local width = frame:GetWidth() + 2 * out
    local height = frame:GetHeight() + 2 * out
    local halfWidth = math.max(0, width / 2 - edge)
    local u0, u1 = 1 / 8, 1 / 8 + halfWidth / (8 * edge)
    local postPeriod = look.edgeVPeriod or 4
    local halfHeight = math.max(0, height / 2 - edge)
    local v0, v1 = 1 / postPeriod, 1 / postPeriod + halfHeight / (postPeriod * edge)

    local function Half(texture, file, point, dx, dy, w, h, left, right, top, bottom)
        texture:SetTexture(file, "REPEAT", "REPEAT")
        texture:ClearAllPoints()
        texture:SetPoint(point, frame, point, dx, dy)
        texture:SetSize(w, h)
        texture:SetTexCoord(left, right, top, bottom)
    end

    Half(trim.topLeft, look.edge, "TOPLEFT", -out + edge, out, halfWidth, edge, u0, u1, 0, 1)
    Half(trim.topRight, look.edge, "TOPRIGHT", out - edge, out, halfWidth, edge, u1, u0, 0, 1)
    Half(trim.bottomLeft, look.edge, "BOTTOMLEFT", -out + edge, -out, halfWidth, edge, u0, u1, 1, 0)
    Half(trim.bottomRight, look.edge, "BOTTOMRIGHT", out - edge, -out, halfWidth, edge, u1, u0, 1, 0)

    Half(trim.leftTop, look.edgeV, "TOPLEFT", -out, out - edge, edge, halfHeight, 0, 1, v0, v1)
    Half(trim.leftBottom, look.edgeV, "BOTTOMLEFT", -out, -out + edge, edge, halfHeight, 0, 1, v1, v0)
    Half(trim.rightTop, look.edgeV, "TOPRIGHT", out, out - edge, edge, halfHeight, 1, 0, v0, v1)
    Half(trim.rightBottom, look.edgeV, "BOTTOMRIGHT", out, -out + edge, edge, halfHeight, 1, 0, v1, v0)

    Half(trim.cornerTopLeft, look.join, "TOPLEFT", -out, out, edge, edge, 0, 1, 0, 1)
    Half(trim.cornerTopRight, look.join, "TOPRIGHT", out, out, edge, edge, 1, 0, 0, 1)
    Half(trim.cornerBottomLeft, look.join, "BOTTOMLEFT", -out, -out, edge, edge, 0, 1, 1, 0)
    Half(trim.cornerBottomRight, look.join, "BOTTOMRIGHT", out, -out, edge, edge, 1, 0, 1, 0)
end

function PlayerFrame:RefreshConfig()
    -- Bronze Border tints every round button, whichever way lines are shown.
    Actions.RefreshRings()
    local skin = self:Skin()
    -- Each window dresses the captions its own way; the others' look must not stay on them.
    if skin ~= DialogueUIPlayer and not self:IsShowing() then Transcript:SetStyle(nil) end
    for _, other in ipairs({ MinimalPlayer, DialogueUIPlayer }) do
        if other ~= skin then other:SetVisible(false, true) end
    end
    if skin then
        self.fader:Set(false, true)
        skin:RefreshConfig(self)
        return
    end
    local cfg = FrameConfig()
    self.frame.portrait:SetShown(not cfg.HidePortrait)
    self.frame.mover:ClearAllPoints()
    if cfg.HidePortrait then
        self.frame.mover:SetParent(self.frame)
        self.frame.mover:SetPoint("CENTER", self.frame, "BOTTOMLEFT", BARE_LEFT / 2, BARE_LEFT / 2)
    else
        self.frame.mover:SetParent(self.frame.portrait.border)
        self.frame.mover:SetPoint("CENTER", self.frame.portrait, "BOTTOMLEFT", 0, 0)
    end
    self:ApplyArt()
    self:ApplyRaceArt(self:Current())
    Ellesmere:Dress(self.frame)
    -- Only once the shell is on, and a failure here said in chat: the window's scale, strata and
    -- host below must still be set.
    if self.frame.spokenEllesmere == true then
        Ellesmere:When(function(skin)
            -- White on EllesmereUI's shell, as its windows write their names.
            self.frame.container.name:SetTextColor(1, 1, 1)
            -- The shell's own dark behind the words: ApplyArt has just drawn Spoken's box again.
            self.frame.background:SetAlpha(0)
            local portrait = self.frame.portrait
            portrait.border.texture:SetAlpha(0)
            portrait.background:SetAlpha(0)
            portrait.box = Ellesmere:Box(skin, portrait, portrait.border, true)
            -- On the portrait, under what it shows, so Hide Portrait hides it too.
            portrait.disc = Ellesmere:Disc(skin, portrait, portrait)
            self:FitPortrait()
            local level = self.frame:GetFrameLevel() + Ellesmere.OVER_SHELL
            portrait:SetFrameLevel(level)
            portrait.border:SetFrameLevel(level + 3)
        end)
    end

    self.frame.mover:SetShown(not Addon:IsFrameLocked())
    self.frame:SetScale(cfg.FrameScale)
    self.frame:SetFrameStrata(cfg.FrameStrata)
    Addon:ApplyHost(self.frame)
    self:Update()
end

--- Where the name and the words start: past the portrait, or BARE_LEFT with it hidden.
local function Left() return FrameConfig().HidePortrait and BARE_LEFT or NAME_X end

--- The lines of words that fit between the name and the progress line, up to MOST_LINES, and a
--- line's height; no lines where the line has no words to show (Show Narrator off or none written).
function PlayerFrame:WordLines(clip)
    local lineHeight = (Addon:Profile("Transcript").FontSize or 16) + 4
    if Transcript:HeightForClip(clip) <= 0 then return 0, lineHeight end
    local room = FRAME_HEIGHT + NAME_Y - FOOT - (NAME_SIZE + WORDS_UNDER) - BAR_GAP - self.progress.height
    return math.max(1, math.min(MOST_LINES, math.floor(room / lineHeight))), lineHeight
end

--- The column's place and the words docked in it. The window keeps the Talking Head's size.
function PlayerFrame:Layout()
    if self.laying or not self:IsShowing() then return end
    self.laying = true
    local frame, container = self.frame, self.frame.container
    local left = Left()
    container:ClearAllPoints()
    container:SetPoint("TOPLEFT", frame, "TOPLEFT", left, NAME_Y)
    container:SetWidth(FRAME_WIDTH - left - RIGHT)
    container:SetHeight(FRAME_HEIGHT + NAME_Y - FOOT)
    local width = container:GetWidth()

    -- A line's room over the words and under them, which a line gliding out or in fades through.
    local lines, lineHeight = self:WordLines(self:Current())
    local words = lines * lineHeight
    local font = GameFontHighlightLarge and GameFontHighlightLarge:GetFont() or nil
    self.styling = true
    Transcript:SetStyle({ lines = math.max(1, lines), padTop = lineHeight, color = WORDS_COLOR, font = font })
    self.styling = nil
    Transcript:Dock(container, container, "TOPLEFT", 0, -(NAME_SIZE + WORDS_UNDER - lineHeight), width,
        words > 0 and words + 2 * lineHeight or 0)

    self.progress.track:SetWidth(width)
    self.progress.track:SetShown(Addon:Profile("Transcript").SubtitleProgress ~= false)
    self:LayoutHeader()
    self.laying = nil
end

--- The name in full where it fits, then the line's name and the tail, all short of the controls.
--- The line's name is cut short first, then the speaker's.
function PlayerFrame:LayoutHeader()
    local container = self.frame.container
    local name, label, tail = container.name, container.label, self.tail
    local left = Left()
    local room = math.max(1, FRAME_WIDTH - CORNER_X - self.controls:GetWidth() - NAME_GAP - left)
    local tailRoom = tail:Room()
    -- Unbounded first, so the width measured is the text's own.
    name:SetWidth(0)
    name:SetText(name:GetText())
    local nameWidth = math.min((name:GetStringWidth() or 0) + 1, math.max(1, room - tailRoom))
    name:SetWidth(nameWidth)
    local x = nameWidth
    local labelRoom = room - tailRoom - nameWidth - LABEL_GAP
    local fits = label:IsShown() and labelRoom >= math.min(self.labelWidth, self.labelLeast)
    if fits then
        local labelWidth = math.min(self.labelWidth, labelRoom)
        label:SetWidth(labelWidth)
        label:ClearAllPoints()
        label:SetPoint("LEFT", name, "LEFT", x + LABEL_GAP, 0)
        x = x + LABEL_GAP + labelWidth
    end
    label:SetAlpha(fits and 1 or 0)
    container.labelHover:SetShown(fits and labelRoom < self.labelWidth)
    if tailRoom > 0 then
        tail:Place(name, x)
        tail:Paint()
    end
end

function PlayerFrame:ConfigureActions(clip)
    self.row = Actions:HeaderControls(self.frame, self.controls, self.buttons, clip)
    Actions.LayOutRow(self.controls, self.row, ROUND_GAP)
end

function PlayerFrame:UpdateControls()
    local head = self:Current()
    if not head then return end
    Actions.SetPlayGlyph(self.play, Actions.HeadState())
    self.tail:SetHeld(SoundQueue:GetHeldReason(head))
    self.tail:SetStopped(SoundQueue:IsPaused())
    self.tail:SetCount(Waiting())
    Actions.SetPausable(self.buttons)
    self:LayoutHeader()
end

function PlayerFrame:UpdateProgress()
    local clip = self:Current()
    if not clip then return end
    if clip ~= self.timed then self.timed, self.seconds = clip, 0 end
    self.seconds = Actions.Elapsed(clip, self.seconds)
    Actions.SetProgress(self.progress, SoundQueue:Share(clip, self.seconds))
end

function PlayerFrame:Tick(elapsed)
    if not self.frame:IsShown() then return end
    self:UpdateProgress()
    -- Stopped faded out: its room given back.
    if self.tail:Step(elapsed) then
        self.tail:SetCount(Waiting())
        self:LayoutHeader()
    end
    self.poll = (self.poll or 0) + elapsed
    if self.poll >= .2 then
        self.poll = 0
        self:ApplyRaceArt(self.shown)
        self:UpdateControls()
    end
end

--- A line to show while none is playing, so a window chosen as the narrator style in the welcome
--- window can be seen at once, as the subtitles show theirs. Either window draws it; the first
--- real line puts it away.
function PlayerFrame:ShowSample(shown)
    self.sample = shown and {
        key = "sample", length = 0,
        source = { key = "sample", gates = {}, interClipGap = 0 },
        present = { header = L.SAMPLE_SPEAKER, label = L.SAMPLE_LINE,
            transcript = L.SAMPLE_WINDOW_TEXT,
            portrait = { kind = "texture", texture = [[Interface\AddOns\Spoken\icon.tga]] } },
    } or nil
    Transcript:Sync()
    self:Update()
end

function PlayerFrame:IsShowingSample()
    return self.sample ~= nil
end

--- Whether this window, showing a line, will fade out to turn to `clip`.
function PlayerFrame:WillTurn(clip)
    return self:IsShowing() and self.shown ~= nil and clip ~= self.shown and self.frame:IsShown()
        and not self.fader:Leaving() and not Actions.DialogCovers()
end

--- The line playing, or the sample while nothing is.
function PlayerFrame:Head()
    if not SoundQueue:IsEmpty() then self.sample = nil end
    return SoundQueue:GetCurrentSound() or self.sample
end

--- The line the window stands for: the head, unless its module has Show Narrator off.
function PlayerFrame:Current()
    local head = self:Head()
    if head and not Addon:ShowsNarrator(head) then return nil end
    return head
end

function PlayerFrame:Update()
    if not self.frame then return end
    local skin = self:Skin()
    if skin then skin:Update(); return end
    -- The captions taking this window's look ask for an update: the layout under way has it.
    if self.styling then return end
    -- Hidden, not torn down, while subtitles stand in for it: going back finds it as it was.
    -- Faded out with nothing to say, or while a DialogueUI dialog hides the interface; put away at
    -- once for another style.
    local head = self:Current()
    local classic = Addon:DisplayStyle() == "classic"
    local want = classic and head ~= nil and not Actions.DialogCovers()
    if not want then
        self:ApplyRaceArt(nil)
        self.turning = nil
        self.fader:Set(false, not classic)
        return
    end
    -- Fading out to turn to the next line: it comes in once faded.
    if self.turning and self.frame:IsShown() then return end
    -- Following another line on screen: this one fades out whole and the next fades in from
    -- nothing once it has, so the change happens unseen.
    if self.shown and head ~= self.shown and self.frame:IsShown() and not self.fader:Leaving() then
        self.turning = true
        self.fader:Set(false)
        return
    end
    self.shown = head
    self:ApplyRaceArt(head)
    self.fader:Set(true)

    -- The speaker, or the line's name where nobody speaks; then the line's name, said once.
    local container = self.frame.container
    local speaker = Speaker(head)
    local named = speaker ~= ""
    container.name:SetText(named and speaker or Label(head))
    Addon:ClipFont(container.name, head)
    container.label:SetShown(named)
    if named then
        local label = container.label
        label:SetWidth(0)
        Addon:ClipFont(label, head)
        -- Measured once a line, unbounded, so the width is the text's own; the row is laid out often.
        -- Less room than a dot and an ellipsis would draw only a stray fragment.
        label:SetText(LABEL_LEAST)
        self.labelLeast = (label:GetStringWidth() or 0) + 1
        label:SetText("· " .. Label(head))
        self.labelWidth = (label:GetStringWidth() or 0) + 1
    end

    -- In EllesmereUI's look the speaker's captured face where there is one: a face can be cut round,
    -- a 3D model cannot. Without one, the 3D model as ever, not the book StaticPortrait stands in with.
    local portrait = self.frame.portrait
    local captured = Ellesmere:On() and StaticPortrait:Capture(head)
    if not (captured and StaticPortrait:Configure(portrait, head, captured)) then
        -- The face of the speaker before is let go: Portrait does not know it.
        StaticPortrait:Release(portrait)
        Portrait:Configure(portrait, head)
    end
    self:FitPortrait()
    self:ConfigureActions(head)
    self:Layout()
    self:UpdateControls()
    self:UpdateProgress()
end

--- In EllesmereUI's look the portrait round whatever it shows, but a 3D model, which no mask cuts.
function PlayerFrame:FitPortrait()
    local portrait = self.frame and self.frame.portrait
    if not (portrait and portrait.box) then return end
    local round = portrait.active ~= "model"
    Ellesmere.Shape(portrait.box, portrait.disc, round)
    if round and portrait.active == "texture" and portrait.texture then StaticPortrait:Mask(portrait, portrait.texture) end
end

--- What the frame is actually doing, for a bug report. A header that is set but drawn nowhere,
--- or drawn under something, looks from the outside exactly like one that was never set; this
--- tells the two apart without a client to poke at.
function PlayerFrame:Describe()
    local lines = {}
    local function Say(text) table.insert(lines, text) end
    Say(MinimalPlayer:Describe())
    if DialogueUIPlayer then Say(DialogueUIPlayer:Describe()) end
    if not self.frame then
        Say("no frame built")
        return lines
    end
    local container = self.frame.container
    Say(format("frame shown=%s w=%.0f h=%.0f art=%s", tostring(self.frame:IsShown()),
        self.frame:GetWidth() or 0, self.frame:GetHeight() or 0, self.art and self.art.box or "own"))
    Say(format("container shown=%s w=%.0f h=%.0f header=%q count=%q", tostring(container:IsShown()),
        container:GetWidth() or 0, container:GetHeight() or 0, container.name:GetText() or "",
        self.count:GetText() or ""))
    local label = container.label
    Say(format("label=%q shown=%s alpha=%.2f w=%.0f of %.0f", label:GetText() or "", tostring(label:IsShown()),
        label:GetAlpha() or 0, label:GetWidth() or 0, self.labelWidth or 0))
    Say(format("portrait kind=%s", tostring(self.frame.portrait.active)))
    for _, button in ipairs(self.row or {}) do
        Say(format("  control %s shown=%s", button.action and button.action.id or (button == self.play
            and tostring(self.play.state) or "skip"), tostring(button:IsShown())))
    end
    Say(format("head can be stopped=%s", tostring(SoundQueue:CanBePaused())))
    Say(format("queue=%d", SoundQueue:GetQueueSize()))
    return lines
end

function PlayerFrame:SaveLayout()
    Addon:SaveLayout("Player", self.frame)
end

--- Every window back to its default spot, forgetting the place saved for each, whichever is in
--- use: for a frame dragged off-screen or in the way. The subtitles have their own (Subtitle:Reset).
function PlayerFrame:Reset()
    Addon:Layout().Player = nil
    MinimalPlayer:Reset()
    if DialogueUIPlayer.Reset then DialogueUIPlayer:Reset() end
    if not self.frame then return end
    self.frame:Reset()
    self:RefreshConfig()
end
