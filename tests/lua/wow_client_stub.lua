-- A stand-in for the parts of the WoW client that the VoiceOver Redux player touches.
--
-- The player's quest dispatch is a 10 Hz timer reading client state, so testing it needs a
-- clock that can be stepped rather than waited on: Advance() moves time and fires the
-- AceTimer callbacks that fall inside the step, which makes a quest hand-off deterministic.
local M = {}

local world = {
    time = 0,
    questID = 0,
    title = "",
    questText = "",
    progressText = "",
    rewardText = "",
    npcName = "Innkeeper Test",
    npcGUID = "Creature-0-0-0-0-1234-0",
    modelFileID = nil,    -- what a loaded PlayerModel answers for the unit on screen
    -- True between SetUnit and the model actually finishing loading: makes GetModelFileID
    -- answer nil even though the probe is shown, the way a real model does for however long
    -- the load takes. Without this the stub always answers immediately once shown, which is
    -- why an early-click read racing the load was never once exercised before this existed.
    modelStillLoading = false,
    unitSex = 2,          -- UnitSex: 1 unknown, 2 male, 3 female
    creatureType = "Humanoid",
    panels = {},
    played = {},
    -- Sound state the player addon is tested against. `played` keeps the path only, so
    -- the older quest tests read it unchanged; the channel of the nth play is beside it.
    playedChannels = {},
    stopped = {},      -- handles StopSound was asked to stop, in order
    music = {},        -- paths PlayMusic was given, in order (the 2.4.3/3.3.5 path)
    missing = {},      -- paths PlaySoundFile refuses, as a set
    cvars = {},        -- overrides; anything unset reads as "1"
    cvarLog = {},      -- every SetCVar, as {key, value}, so a toggle can be asserted

    -- The book frame, as ItemTextFrame reports it. `itemTextCreator` is what makes a
    -- letter mail rather than a book, and is nil for everything the game wrote itself.
    itemText = nil,       -- the page's words
    itemTextItem = nil,   -- the object's or item's name, i.e. the book's title
    itemTextPage = 1,
    itemTextCreator = nil,
    itemTextHasNext = false,
    itemTextMaterial = "Parchment",
}
M.world = world

local timers = {}
local allFrames = {}

--- Move the clock forward, firing every timer scheduled inside the interval.
function M.Advance(seconds, step)
    step = step or 0.05
    local target = world.time + seconds
    while world.time < target - 1e-9 do
        world.time = math.min(world.time + step, target)
        for _, timer in ipairs(timers) do
            while timer.at and world.time >= timer.at - 1e-9 do
                if timer.interval then
                    timer.at = timer.at + timer.interval
                else
                    timer.at = nil
                end
                timer.fn()
            end
        end
    end
end

--- Show one Blizzard quest panel, or none at all. Passing nil is what an addon that
--- replaces the quest frame - DialogueUI calls QuestFrame:UnregisterAllEvents() - leaves
--- behind: the client is in a quest dialog, but no Blizzard panel is ever shown.
function M.ShowPanel(name)
    world.panels = {}
    if name then
        world.panels[name] = true
    end
end

--- Hide every Blizzard quest panel and clear gossip text: the client is showing no dialog at
--- all. Gossip has no panel of its own in this stub, so closing "nothing on screen" means
--- forgetting it too, the way GOSSIP_CLOSED leaves the client.
function M.HidePanels()
    M.ShowPanel(nil)
    world.gossipText = nil
end

--- Deliver a client event to every frame registered for it.
function M.FireEvent(event, ...)
    for _, frame in ipairs(allFrames) do
        if frame.events[event] and frame.scripts.OnEvent then
            frame.scripts.OnEvent(frame, event, ...)
        end
    end
end

-- A widget: enough of a Frame, Texture or FontString for the player's UI files to load
-- and to answer the questions a test asks (shown? what text? which texture?). Data
-- fields are lower-case and stay nil until set; any Capitalised method not listed is a
-- no-op, which is what lets the real UI code run against this without a client.
--- Methods the current client does not have. Widgets are built without them, and the
--- catch-all leaves them missing rather than answering with a no-op.
M.absentAPI = {}

local function Widget(kind, name)
    local w = { kind = kind, name = name, events = {}, scripts = {}, hooks = {}, shown = true,
        text = "", width = 300, height = 120, id = 0, alpha = 1, children = {} }
    function w:RegisterEvent(event) self.events[event] = true end
    function w:UnregisterEvent(event) self.events[event] = nil end
    function w:UnregisterAllEvents() self.events = {} end
    function w:SetScript(script, fn) self.scripts[script] = fn end
    function w:GetScript(script) return self.scripts[script] end
    function w:HookScript(script, fn)
        self.hooks[script] = self.hooks[script] or {}
        table.insert(self.hooks[script], fn)
    end
    function w:IsVisible() if self.name then return world.panels[self.name] and true or false end return self.shown end
    function w:IsShown() return self:IsVisible() end
    function w:Show()
        self.shown = true
        if self.name then world.panels[self.name] = true end
        for _, fn in ipairs(self.hooks.OnShow or {}) do fn(self) end
    end
    function w:Hide() self.shown = false; if self.name then world.panels[self.name] = nil end end
    function w:SetShown(v) if v then self:Show() else self:Hide() end end
    function w:SetText(t) self.text = t; self.lines = { t } end
    function w:AddLine(t) self.lines = self.lines or {}; table.insert(self.lines, t) end
    function w:NumLines() return self.lines and table.getn(self.lines) or 0 end
    function w:GetText() return self.text end
    -- A rough 7px a character, so a button sized to its label has a width to read back.
    function w:GetTextWidth() return string.len(self.text or "") * 7 end
    function w:SetWidth(v) self.width = v end
    function w:SetHeight(v) self.height = v end
    function w:SetBackdrop(backdrop) self.backdrop = backdrop end
    function w:GetBackdrop() return self.backdrop end
    function w:SetBackdropColor(r, g, b, a) self.backdropColor = { r, g, b, a } end
    function w:SetBackdropBorderColor(r, g, b, a) self.backdropBorderColor = { r, g, b, a } end
    function w:SetOrientation(v) self.orientation = v end
    function w:GetOrientation() return self.orientation end
    function w:SetSize(a, b) self.width, self.height = a, b end
    function w:GetWidth() return self.width end
    function w:EnableMouse(v) self.mouseEnabled = v and true or false end
    function w:IsMouseEnabled() return self.mouseEnabled and true or false end
    function w:GetHeight() return self.height end
    function w:GetWidth() return self.width end
    -- A scroll frame's own state, which the settings panels' viewport reads back.
    function w:SetVerticalScroll(v) self.verticalScroll = v end
    function w:GetVerticalScroll() return self.verticalScroll or 0 end
    function w:SetScrollChild(child) self.scrollChild = child end
    function w:GetScrollChild() return self.scrollChild end
    -- Recorded rather than swallowed by the catch-all below: where a control sits is what
    -- a settings panel is, and a panel whose rows drift apart has no other symptom.
    function w:SetPoint(point, a, b, c, d)
        local x, y, relativeTo, relativePoint
        if type(a) == "number" then
            x, y = a, b
        else
            -- What it was anchored TO, not just where: a button placed against one of the
            -- client's own widgets is making a claim about that widget, and the claim is
            -- what a test has to be able to read back.
            relativeTo, relativePoint, x, y = a, b, c, d
        end
        self.anchor = { point = point, x = x, y = y,
            relativeTo = relativeTo, relativePoint = relativePoint }
        return self
    end
    function w:ClearAllPoints() self.anchor = nil end
    function w:GetNumPoints() return self.anchor and 1 or 0 end
    function w:GetPoint()
        local anchor = self.anchor
        if not anchor then return end
        return anchor.point, anchor.relativeTo, anchor.relativePoint, anchor.x, anchor.y
    end
    function w:GetStringWidth() return #tostring(self.text or "") * 7 end
    function w:GetTop() return 100 end
    function w:GetBottom() return 0 end
    function w:GetLeft() return 0 end
    function w:GetRight() return self.width end
    function w:SetAlpha(v) self.alpha = v end
    function w:GetAlpha() return self.alpha end
    function w:SetID(v) self.id = v end
    function w:GetID() return self.id end
    function w:SetParent(p) self.parent = p end
    function w:GetParent() return self.parent end
    -- What a frame was built with, and what hangs off it: the quest log's play buttons find
    -- the client's own objective icon by walking the list's children and asking both.
    function w:GetObjectType() return self.frameType or self.kind end
    function w:GetChildren() return unpack(self.children) end
    function w:GetFrameLevel() return 1 end
    function w:SetTexture(t) self.texture = t; return true end
    function w:GetTexture() return self.texture end
    function w:SetTexCoord(...) self.texCoord = { ... } end
    function w:CreateTexture(n, layer) local t = Widget("Texture", n); t.parent = self; t.layer = layer; return t end
    function w:CreateFontString(n, layer)
        local t = Widget("FontString", n)
        t.parent = self
        table.insert(self.children, t)
        return t
    end
    function w:SetNormalTexture(t) self.normalTexture = self.normalTexture or Widget("Texture"); self.normalTexture:SetTexture(t) end
    function w:GetNormalTexture() self.normalTexture = self.normalTexture or Widget("Texture"); return self.normalTexture end
    function w:SetPushedTexture(t) self.pushedTexture = self.pushedTexture or Widget("Texture"); self.pushedTexture:SetTexture(t) end
    function w:GetPushedTexture() self.pushedTexture = self.pushedTexture or Widget("Texture"); return self.pushedTexture end
    function w:SetHighlightTexture(t) self.highlightTexture = self.highlightTexture or Widget("Texture"); self.highlightTexture:SetTexture(t) end
    function w:GetHighlightTexture() self.highlightTexture = self.highlightTexture or Widget("Texture"); return self.highlightTexture end
    function w:SetDisabledTexture(t) self.disabledTexture = self.disabledTexture or Widget("Texture"); self.disabledTexture:SetTexture(t) end
    function w:GetDisabledTexture() self.disabledTexture = self.disabledTexture or Widget("Texture"); return self.disabledTexture end
    -- Recorded rather than swallowed by the catch-all: a play button the client draws greyed
    -- out is a quest with no audio, and that is the whole of what the button says.
    function w:Enable() self.enabled = true end
    function w:Disable() self.enabled = false end
    function w:IsEnabled() return self.enabled ~= false end
    function w:SetChecked(v) self.checked = v end
    function w:GetChecked() return self.checked end
    function w:GetFont() return "Fonts\\FRIZQT__.TTF", 12 end
    -- Real objects rather than the catch-all's no-op: with hooks running, the player's
    -- fade-in builds an animation group and then drives it, and a nil there is an error.
    function w:CreateAnimationGroup(n)
        local group = Widget("AnimationGroup", n)
        group.parent = self
        return group
    end
    function w:CreateAnimation(kind, n)
        local animation = Widget("Animation", n)
        animation.animationType = kind
        animation.parent = self
        return animation
    end
    function w:SetCreature(idv) self.creature = idv; self.model = "creature/" .. tostring(idv) end
    function w:ClearModel() self.creature = nil; self.model = nil end
    -- Only the one this client has. Model:GetModel returned a path and was removed; the
    -- current clients answer GetModelFileID instead, and asking the wrong one is an error
    -- rather than a nil -- which is what the catch-all below would otherwise hide.
    if not M.absentAPI.GetModel then
        function w:GetModel() return self.model end
    end
    if not M.absentAPI.GetModelFileID then
        function w:GetModelFileID() return self.creature and 119940 or nil end
    end
    function w:GetOwner() return self.owner end
    function w:SetOwner(o) self.owner = o end
    function w:Click()
        -- 1.12 hands a script no arguments and sets the globals `this` and `arg1` instead,
        -- which is what Compat.lua's SetScript wrapper reads. Both are set here so a click
        -- reaches the same handler on every client.
        local previousThis, previousArg = _G.this, _G.arg1
        _G.this, _G.arg1 = self, "LeftButton"
        local fn = self.enabled ~= false and self.scripts.OnClick
        if fn then fn(self, "LeftButton") end
        for _, h in ipairs(self.hooks.OnClick or {}) do h(self, "LeftButton") end
        _G.this, _G.arg1 = previousThis, previousArg
    end
    setmetatable(w, { __index = function(_, k)
        -- A method this client does not have stays missing. Everything else a real widget
        -- answers is a no-op, which is what lets the UI code run with no client at all.
        if M.absentAPI[k] then return nil end
        if type(k) == "string" and k:match("^[A-Z]") then return function() end end
        return nil
    end })
    table.insert(allFrames, w)
    return w
end
M.Widget = Widget

local function MakeFrame(name)
    return Widget("Frame", name)
end

local frames = {}
local function Frame(name)
    frames[name] = frames[name] or MakeFrame(name)
    return frames[name]
end
M.Frame = Frame

-- The client's named frames live as long as the session, and so do these. An addon
-- re-loaded by a test would otherwise keep building into the panel the last scenario
-- built, and its rows would be read alongside those. Forgets only what an addon named;
-- the client's own frames are created once, below, and stay.
local baseFrames
function M.ResetFrames()
    if not baseFrames then
        return
    end
    for name in pairs(frames) do
        if not baseFrames[name] then
            frames[name] = nil
            _G[name] = nil
        end
    end
end
function M.MarkBaseFrames()
    baseFrames = {}
    for name in pairs(frames) do baseFrames[name] = true end
end

local _G = _G

-- A current Blizzard client by default, which is where the 10 Hz watcher runs at all.
-- SetClient() swaps in a private-server client: those have no WOW_PROJECT_ID, and 1.12
-- reports no interface version at all, which is exactly what Version.lua keys on.
local CLIENTS = {
    ["20506"] = { "2.5.6", "60000", 20506, 5 },
    -- The Forever client: a mainline-flavoured client carrying vanilla content, and the one
    -- whose quest log is the modern map-attached one rather than the named QuestLogFrame.
    ["16001"] = { "1.60.1", "69913", 16001, 1 },
    ["11509"] = { "1.15.9", "69109", 11509, 2 },
    ["1.12"]  = { "1.12.1", "5875", nil, nil },
    ["2.4.3"] = { "2.4.3", "8606", 20400, nil },
    ["3.3.5"] = { "3.3.5", "12340", 30300, nil },
}
function M.SetClient(label)
    local c = assert(CLIENTS[label], "unknown client " .. tostring(label))
    _G.GetBuildInfo = function() return c[1], c[2], "Jan 1 2026", c[3] end
    _G.WOW_PROJECT_ID = c[4]
    if c[4] == nil then _G.Settings = nil else _G.Settings = M.modernSettings end
    _G.C_GossipInfo = c[4] ~= nil and M.gossipAPI or nil
    -- The private-server clients have no context-menu API worth using either, which is
    -- what makes the player draw its own menu there.
    -- Model frames answered GetModel on the private-server clients and answer
    -- GetModelFileID on the current ones. Neither client has both.
    M.absentAPI.GetModel = c[4] ~= nil or nil
    M.absentAPI.GetModelFileID = c[4] == nil or nil
    -- Guarded: SetClient runs once as this file loads, before the menu API below exists.
    if M.SetMenuAPI then
        M.SetMenuAPI(c[4] ~= nil)
    end
end
_G.UIParent = MakeFrame("UIParent")
_G.WOW_PROJECT_CLASSIC = 2
_G.WOW_PROJECT_BURNING_CRUSADE_CLASSIC = 5
_G.WOW_PROJECT_WRATH_CLASSIC = 11
_G.WOW_PROJECT_MAINLINE = 1

function _G.GetTime() return world.time end
function _G.GetQuestID() return world.questID end
function _G.GetTitleText() return world.title end
function _G.GetQuestText() return world.questText end
function _G.GetProgressText() return world.progressText end
function _G.GetRewardText() return world.rewardText end
function _G.UnitName(unit) return unit == "player" and (world.playerName or "Tester") or world.npcName end
-- Nil unless a test sets them: a class or race the stub made up would be swapped out of every
-- text a test captures, and only the tests about that swap should see it happen.
function _G.UnitClass() return world.playerClass, world.playerClassFile end
function _G.UnitRace() return world.playerRace, world.playerRaceFile end
function _G.GetRealmName() return "Realm" end
function _G.UnitGUID() return world.npcGUID end
function _G.UnitExists() return true end
function _G.UnitIsPlayer() return false end
function _G.UnitSex() return world.unitSex end
function _G.UnitCreatureType() return world.creatureType end
function _G.GetCVar(key) return world.cvars[key] or "1" end
function _G.SetCVar(key, value)
    world.cvars[key] = tostring(value)
    table.insert(world.cvarLog, { key, tostring(value) })
end
function _G.PlaySoundFile(path, channel)
    if world.missing[path] then return false end
    table.insert(world.played, path)
    world.playedChannels[#world.played] = channel
    return true, #world.played
end
function _G.StopSound(handle) table.insert(world.stopped, handle) end
function _G.PlayMusic(path) table.insert(world.music, path) end
function _G.StopMusic() table.insert(world.music, false) end
-- How many frames CreateFrame has built, across every name and kind: a model probe built
-- once and reused shows up here as one, however many times the code that reuses it runs.
local frameCount = 0
function M.FrameCount() return frameCount end
-- How many times a PlayerModel's SetUnit has been called: the frame count alone cannot see a
-- probe that is built once but re-primed on every refresh, which is the cost that actually
-- matters (SetUnit is what starts a model loading).
local setUnitCount = 0
function M.SetUnitCount() return setUnitCount end
function _G.CreateFrame(kind, name, parent)
    frameCount = frameCount + 1
    local f = name and Frame(name) or MakeFrame(nil)
    f.frameType = kind
    f.parent = parent
    if name then _G[name] = f end
    -- Recorded so a test can ask what a panel built, the way a player reads it: a row is
    -- a control with a label, and a panel that lost one is a setting nobody can reach.
    if parent and parent.children then table.insert(parent.children, f) end
    -- The edit box a contribution is copied out of is multi-line and unbounded, neither of
    -- which the report popup's box is. `highlighted` and `multiLine` are recorded because the
    -- point of the frame is that the player presses Ctrl+C and nothing else.
    if kind == "EditBox" then
        function f:SetMultiLine(on) self.multiLine = on and true or false end
        function f:SetMaxBytes(n) self.maxBytes = n end
        function f:GetMaxBytes() return self.maxBytes or 0 end
        function f:HighlightText() self.highlighted = true end
        function f:SetAutoFocus() end
        -- A real client ignores SetFocus on an edit box that is not on screen, which is how a
        -- copy box can open with its text selected and the keyboard still on the game.
        function f:SetFocus()
            local frame = self
            while frame do
                if frame.shown == false then return end
                frame = frame.parent
            end
            self.focused = true
        end
        function f:HasFocus() return self.focused == true end
        function f:SetScript(event, fn) self.handlers = self.handlers or {}; self.handlers[event] = fn end
    end
    -- A PlayerModel only loads while it is shown, and answers nothing until it has -- so the
    -- stub refuses to answer a frame that is not currently shown, the same way a real one
    -- answers nothing to a probe that never called Show. SetUnit is counted separately from
    -- CreateFrame: a probe built once and reused would still call SetUnit on every read, and
    -- that is the cost HasGap must never pay merely to answer a yes/no question. Tracked as
    -- M.playerModel (this addon only ever keeps one) so a test can fire OnModelLoaded itself,
    -- the way a live client's asynchronous model load would -- see M.FinishModelLoad.
    if kind == "PlayerModel" then
        M.playerModel = f
        function f:SetUnit(unit) self.unit = unit; setUnitCount = setUnitCount + 1 end
        function f:GetModelFileID()
            if not self.shown or world.modelStillLoading then return nil end
            return world.modelFileID
        end
        -- Set at call time, not frame-creation time, so a test can flip M.modelCallbackDisabled
        -- after the probe already exists (it is built once and kept for the addon's whole
        -- lifetime) and still simulate a client that has never once called the handler it was
        -- asked to install -- SetScript on an unrecognised script type is a real Lua error, not
        -- a silent no-op, which is what the addon's own pcall around SetScript is guarding.
        function f:SetScript(script, fn)
            if script == "OnModelLoaded" and M.modelCallbackDisabled then
                self.scripts.OnModelLoaded = nil
                error("OnModelLoaded is not a recognised script type on this client")
            end
            self.scripts[script] = fn
        end
    end
    return f
end

-- Whether this client ever calls a PlayerModel's OnModelLoaded handler at all -- unknown for
-- real, since it has not been confirmed against a live client; a test sets this true to
-- exercise the addon's fallback for that possibility instead of the fast path.
M.modelCallbackDisabled = false

--- Fire the model probe's OnModelLoaded script, the way a live client would once the file has
--- actually finished loading. Probed against a live client: SetUnit followed immediately by
--- GetModelFileID answers nothing, and the same read a moment later answers the real id -- so
--- a test drives that moment explicitly rather than the addon polling for it.
function M.FinishModelLoad()
    local probe = M.playerModel
    local handler = probe and probe.scripts and probe.scripts.OnModelLoaded
    if handler then
        handler(probe)
    end
end

--- Every label under this frame, however deep: a control's own text, and the font string
--- a checkbox hangs beside itself.
function M.LabelsUnder(frame, found)
    found = found or {}
    for _, child in ipairs(frame.children or {}) do
        if child.text and child.text ~= "" then table.insert(found, child.text) end
        M.LabelsUnder(child, found)
    end
    return found
end
function _G.CreateFont(name) return Widget("Font", name) end
_G.GameFontNormal = Widget("Font", "GameFontNormal")
_G.GameTooltip = Widget("Frame", "GameTooltip")
function _G.GameTooltip_Hide() end
function _G.MouseIsOver() return false end
function _G.SetCursor() end
function _G.PlaySound() end
_G.SOUNDKIT = { U_CHAT_SCROLL_BUTTON = 1115 }
_G.HIGHLIGHT_FONT_COLOR = { r = 1, g = 1, b = 1 }
_G.NORMAL_FONT_COLOR = { r = 1, g = 0.82, b = 0 }
_G.GRAY_FONT_COLOR = { r = 0.5, g = 0.5, b = 0.5 }
_G.UIDropDownMenu_Initialize = nil
-- The Settings API as 11509 exposes it; SetClient("1.12") removes it.
M.settingsCategories = {}
M.modernSettings = {
    RegisterCanvasLayoutCategory = function(frame, name) local c = { frame = frame, name = name, GetID = function() return name end }; table.insert(M.settingsCategories, c); return c end,
    RegisterCanvasLayoutSubcategory = function(parent, frame, name) local c = { frame = frame, name = name, parent = parent }; table.insert(M.settingsCategories, c); return c end,
    RegisterAddOnCategory = function() end,
    OpenToCategory = function() return true end,
}
_G.Settings = M.modernSettings
M.SetClient("20506")

-- What the zones addon's playback and autoplay files reach for.
_G.DEFAULT_CHAT_FRAME = { AddMessage = function() end }
world.inCombat = false
function _G.UnitAffectingCombat() return world.inCombat end
function _G.GetSubZoneText() return world.subZone or "" end
function _G.GetRealZoneText() return world.zone or "" end
-- Defaults to 1: the login greeting's one exception is a brand-new character, so a test
-- that says nothing about the level is testing that case.
function _G.UnitLevel() return world.playerLevel or 1 end
_G.C_Map = {
    GetMapInfo = function(id) return { mapType = 3 } end,
    GetBestMapForUnit = function() return world.playerMapID or 1411 end,
    -- A Vector2D stand-in: real C_Map.GetPlayerMapPosition returns one with :GetXY(), or nil
    -- off the map it was asked about. world.posX unset means "not on any map", not "at 0,0" --
    -- 0,0 is a real corner, so nil has to stay reachable rather than defaulting to it.
    GetPlayerMapPosition = function(mapID, unit)
        if world.posX == nil then
            return nil
        end
        return { GetXY = function() return world.posX, world.posY end }
    end,
}
_G.C_Timer = {
    After = function(delay, fn) table.insert(timers, { at = world.time + delay, fn = fn }) end,
}
--- Where the player is standing, for the zones addon's map/position reads: GetPlayerMapID,
--- GetRealZoneText, GetSubZoneText and C_Map.GetPlayerMapPosition. `x`/`y` are optional --
--- omitting them leaves world.posX nil, which GetPlayerMapPosition reads as off any map.
function M.SetZone(t)
    world.playerMapID = t.map
    world.zone = t.zone
    world.subZone = t.subzone
    world.posX = t.x
    world.posY = t.y
end
_G.ERR_ZONE_EXPLORED = "Discovered %s."
function _G.GetGossipText() return world.gossipText or "" end
--- Put words on screen from an NPC with nothing to offer but talk: gossip text with no quest
--- panel behind it.
function M.ShowGossip(text)
    world.gossipText = text
    world.panels.GossipFrame = true
end
--- The namespaced gossip API. SetClient hands it to the clients that have one.
M.gossipAPI = {
    GetText = function() return world.gossipText or "" end,
    GetNumActiveQuests = function() return 0 end,
    GetNumAvailableQuests = function() return 0 end,
    GetOptions = function() return {} end,
}

-- The book UI, which is the same API on all three targets: Era, Anniversary and Forever.
-- ItemTextFrame serves mail as well as books, which is why a test can set a creator.
function _G.ItemTextGetText() return world.itemText end
function _G.ItemTextGetItem() return world.itemTextItem end
function _G.ItemTextGetPage() return world.itemTextPage or 1 end
function _G.ItemTextGetCreator() return world.itemTextCreator end
function _G.ItemTextHasNextPage() return world.itemTextHasNext and true or false end
function _G.ItemTextGetMaterial() return world.itemTextMaterial end

-- The frame itself, not just its getters: an addon that hangs a button on the book window
-- needs something to parent it to. One of the client's own frames, created here so
-- ResetFrames keeps it -- an addon that lost the book window between tests would be
-- rebuilding its button against a frame the client never replaces.
_G.ItemTextFrame = MakeFrame("ItemTextFrame")
_G.ItemTextFrame:Hide()

-- The page itself and the arrow above it, because those are what an addon anchors to.
-- Sized and placed as both frames in Gethe/wow-ui-source do -- Classic for Era and
-- Anniversary, Mainline for Forever, which agree on all of this: the arrow 32x32 centred 75
-- right and 41 down from the top-left corner, the page 280x355 anchored 33 in from the
-- top-right and 63 down.
_G.ItemTextPrevPageButton = Widget("Button", "ItemTextPrevPageButton")
_G.ItemTextPrevPageButton:SetParent(_G.ItemTextFrame)
_G.ItemTextPrevPageButton:SetWidth(32)
_G.ItemTextPrevPageButton:SetHeight(32)
_G.ItemTextPrevPageButton:SetPoint("CENTER", _G.ItemTextFrame, "TOPLEFT", 75, -41)

_G.ItemTextScrollFrame = Widget("ScrollFrame", "ItemTextScrollFrame")
_G.ItemTextScrollFrame:SetParent(_G.ItemTextFrame)
_G.ItemTextScrollFrame:SetWidth(280)
_G.ItemTextScrollFrame:SetHeight(355)
_G.ItemTextScrollFrame:SetPoint("TOPRIGHT", _G.ItemTextFrame, "TOPRIGHT", -33, -63)

--- Put a page on screen, as ITEM_TEXT_READY would find it.
function M.ShowPage(page)
    world.itemText = page.text
    world.itemTextItem = page.title
    world.itemTextPage = page.number or 1
    world.itemTextCreator = page.creator
    world.itemTextHasNext = page.hasNext or false
    _G.ItemTextFrame:Show()
end

--- Close it, as ITEM_TEXT_CLOSED leaves things.
function M.ClosePage()
    world.itemText, world.itemTextItem, world.itemTextCreator = nil, nil, nil
    world.itemTextPage, world.itemTextHasNext = 1, false
    _G.ItemTextFrame:Hide()
end
function _G.GetGreetingText() return world.greetingText or "" end
function _G.GetNumGossipActiveQuests() return 0 end
function _G.GetNumGossipAvailableQuests() return 0 end
function _G.GetGossipOptions() return end
_G.ERR_ZONE_EXPLORED_XP = "Discovered %s: %d experience gained."
--- The real semantics: the original runs, then the hook, with the same arguments. A no-op
--- stood here, so nothing an addon installed through it ever ran - and the quest log play
--- button is drawn entirely from one of these hooks.
---@overload fun(name: string, hook: function)
function _G.hooksecurefunc(owner, name, hook)
    if hook == nil then
        owner, name, hook = _G, owner, name
    end
    local original = owner[name]
    assert(type(original) == "function", "hooksecurefunc: " .. tostring(name) .. " is not a function")
    owner[name] = function(...)
        local results = { original(...) }
        hook(...)
        return unpack(results)
    end
    return true
end
function _G.IsLoggedIn() return true end
M.locale = "enUS"
--- The client's locale, as GetLocale reports it. A test sets this to run the addon on,
--- say, a Portuguese client.
function M.SetLocale(locale) M.locale = locale end
function _G.GetLocale() return M.locale end
M.print = print
function _G.print() end
-- With the client's `limit`: strsplit("-", "a-b-c", 2) is "a", "b-c". GetIDFromGUID
-- depends on that to keep the id-bearing tail of a GUID in one piece.
function _G.strsplit(sep, str, limit)
    local out = {}
    for piece in string.gmatch(str or "", "([^" .. sep .. "]*)" .. sep .. "?") do
        table.insert(out, piece)
    end
    if out[#out] == "" then table.remove(out) end
    if limit and #out > limit then
        local tail = table.concat(out, sep, limit)
        for i = #out, limit, -1 do out[i] = nil end
        out[limit] = tail
    end
    return unpack(out)
end
-- The client's string.format takes positional arguments (%1$s), which translations use to
-- put words in their own order; stock Lua's does not. Reordered here, then formatted plainly.
-- Replaced on the string table itself, so ("..."):format and the format global get it too.
local plainFormat = string.format
string.format = function(fmt, ...)
    if type(fmt) ~= "string" or not fmt:find("%%%d+%$") then
        return plainFormat(fmt, ...)
    end
    local args, ordered, n = { ... }, {}, 0
    local plain = fmt:gsub("%%(%d+)%$", function(index)
        n = n + 1
        ordered[n] = args[tonumber(index)]
        return "%"
    end)
    return plainFormat(plain, unpack(ordered, 1, n))
end
_G.format = string.format
_G.strlower = string.lower
_G.strupper = string.upper
_G.strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
_G.gsub = string.gsub
_G.strfind = string.find
_G.getn = function(t) return #t end
_G.NORMAL_FONT_COLOR_CODE = "|cffffffff"
_G.GRAY_FONT_COLOR_CODE = "|cff808080"
_G.OKAY = "Okay"
_G.ENABLE = "Enable"
_G.CANCEL = "Cancel"
_G.StaticPopupDialogs = {}
--- Every popup a scenario raised, newest last, as { key = ..., dialog = ... }.
M.popups = {}
function _G.StaticPopup_Show(key, ...)
    local dialog = _G.StaticPopupDialogs[key]
    table.insert(M.popups, { key = key, dialog = dialog, args = { ... } })
    return dialog
end

--- Addons enabled or disabled and UI reloads a scenario asked for. Disabling is recorded
--- rather than ignored because current clients refuse it to an addon, so an addon asking for
--- it when it has nothing to disable is a bug a test should be able to see.
M.enabledAddOns, M.disabledAddOns, M.reloads = {}, {}, 0
function _G.EnableAddOn(addon) table.insert(M.enabledAddOns, addon) end
function _G.ReloadUI() M.reloads = M.reloads + 1 end
_G.SlashCmdList = {}

-- The dropdown API, enough of it that a panel can be built and a choice made. A menu is
-- not a list of frames here: it is the initializer the addon registered, run on demand.
local openMenu
function _G.UIDropDownMenu_Initialize(frame, initializer) frame.dropdownInit = initializer end
function _G.UIDropDownMenu_CreateInfo() return {} end
function _G.UIDropDownMenu_AddButton(info) if openMenu then table.insert(openMenu, info) end end
function _G.UIDropDownMenu_SetText(frame, text) frame.dropdownText = text end
function _G.UIDropDownMenu_SetWidth() end
function _G.UIDropDownMenu_EnableDropDown(frame) frame.dropdownDisabled = false end
function _G.UIDropDownMenu_DisableDropDown(frame) frame.dropdownDisabled = true end

-- The context-menu half of the API: a menu is open or it is not, and opening it runs the
-- initializer the addon registered. ToggleDropDownMenu is what gives a Blizzard menu its
-- toggling, its highlight and its closing on a click elsewhere, none of which a frame of
-- buttons gets for free.
M.openDropDown = nil
M.dropDownEntries = {}
_G.DropDownList1 = Frame("DropDownList1")
_G.DropDownList1:Hide()
local menuAPI = {}

--- Present the context-menu API, or take it away as a private-server client does.
function M.SetMenuAPI(present)
    for name, fn in pairs(menuAPI) do
        _G[name] = present and fn or nil
    end
end
function _G.ToggleDropDownMenu(level, value, frame, anchor)
    if M.openDropDown == frame then
        M.openDropDown, M.dropDownEntries = nil, {}
        _G.DropDownList1:Hide()
        _G.UIDROPDOWNMENU_OPEN_MENU = nil
        return
    end
    M.openDropDown = frame
    M.dropDownEntries = M.OpenDropdown(frame)
    frame.dropdownAnchor = anchor
    _G.DropDownList1:Show()
    _G.UIDROPDOWNMENU_OPEN_MENU = frame
end
function _G.UIDropDownMenu_CreateFrame() end
function _G.UIDropDownMenu_AddSeparator()
    if openMenu then table.insert(openMenu, { isSeparator = true }) end
end
function _G.CloseDropDownMenus()
    M.openDropDown, M.dropDownEntries = nil, {}
    _G.DropDownList1:Hide()
    _G.UIDROPDOWNMENU_OPEN_MENU = nil
end

for _, name in ipairs({ "UIDropDownMenu_Initialize", "UIDropDownMenu_CreateInfo",
    "UIDropDownMenu_AddButton", "UIDropDownMenu_SetText", "UIDropDownMenu_SetWidth",
    "UIDropDownMenu_SetSelectedValue", "ToggleDropDownMenu", "CloseDropDownMenus",
    "UIDropDownMenu_CreateFrame", "UIDropDownMenu_AddSeparator" }) do
    menuAPI[name] = _G[name]
end
function _G.UIDropDownMenu_SetSelectedValue() end

--- What opening `frame`'s menu would show: one entry per choice, in order, each with the
--- `text` a player reads, whether it is `checked`, and a `func` that picks it.
function M.OpenDropdown(frame)
    openMenu = {}
    frame.dropdownInit(frame, 1)
    local entries = openMenu
    openMenu = nil
    return entries
end

--- Pick the entry reading `text`. Returns false if the menu does not offer it.
function M.PickDropdown(frame, text)
    for _, entry in ipairs(M.OpenDropdown(frame)) do
        if entry.text == text then
            entry.func()
            return true
        end
    end
    return false
end

for _, name in ipairs({ "QuestFrameRewardPanel", "QuestFrameProgressPanel", "QuestFrameDetailPanel",
    "QuestFrameGreetingPanel", "QuestLogDetailFrame", "GossipFrame", "QuestFrame" }) do
    _G[name] = Frame(name)
end

-- The bottom-row buttons UI/ContributeButton.lua anchors beside, one pair per quest panel, as
-- Blizzard's own QuestFrame.xml names them on every client generation this addon targets.
for _, name in ipairs({ "QuestFrameAcceptButton", "QuestFrameDeclineButton", "QuestFrameCompleteButton",
    "QuestFrameGoodbyeButton", "QuestFrameCompleteQuestButton", "QuestFrameCancelButton" }) do
    _G[name] = Frame(name)
end

-- The gossip frame's Goodbye button, reachable the way current Blizzard clients (Classic Era,
-- Anniversary, and Mainline) expose it: nested under a parentKey rather than a separate
-- global. See UI/ContributeButton.lua's GossipGoodbyeButton for why a plain global is also
-- tried and why neither is assumed to exist on the three original legacy clients.
_G.GossipFrame.GreetingPanel = Frame("GossipFrameGreetingPanel")
_G.GossipFrame.GreetingPanel.GoodbyeButton = Frame("GossipFrameGreetingPanelGoodbyeButton")

-- The installed addons, as the client's addon-management API sees them. One sound pack
-- carrying the key it has always carried, until a test says otherwise.
local PACK = "TestPack"

--- Replace the installed addon list. Each entry is { folder, meta = { [tocKey] = value } }.
function M.SetAddOns(list)
    M.addons = list
end

--- The default: one loaded pack declaring the inherited TOC key.
--- Forget the popups, enables and reloads a scenario caused.
--- Forget any open context menu.
function M.ResetDropDowns()
    M.openDropDown, M.dropDownEntries = nil, {}
end

function M.ResetUIActions()
    for i = #M.popups, 1, -1 do M.popups[i] = nil end
    for i = #M.enabledAddOns, 1, -1 do M.enabledAddOns[i] = nil end
    for i = #M.disabledAddOns, 1, -1 do M.disabledAddOns[i] = nil end
    M.reloads = 0
    for key in pairs(_G.StaticPopupDialogs) do _G.StaticPopupDialogs[key] = nil end
end

function M.ResetAddOns()
    M.SetAddOns({ { folder = PACK, meta = {
        ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1", Title = PACK } } })
end
M.ResetAddOns()

local function AddOnAt(addon)
    if type(addon) == "number" then
        return M.addons[addon]
    end
    for _, entry in ipairs(M.addons) do
        if entry.folder == addon then
            return entry
        end
    end
end

function _G.GetNumAddOns() return #M.addons end
function _G.GetAddOnInfo(i)
    local entry = AddOnAt(i)
    -- name, title, notes, loadable, reason. An entry may set loadable/reason to stand in
    -- for an addon the player has switched off or has not installed.
    if entry then
        local loadable = entry.loadable
        if loadable == nil then loadable = true end
        return entry.folder, entry.title or entry.folder, "", loadable, entry.reason
    end
end
function _G.GetAddOnMetadata(addon, key)
    local entry = AddOnAt(addon)
    -- The client's tonumber tolerates nil, LuaJIT's does not. An entry describing an addon
    -- that is not a pack carries no metadata at all.
    return entry and entry.meta and entry.meta[key] or ""
end
function _G.IsAddOnLoadOnDemand() return false end
function _G.GetAddOnEnableState() return 2 end
function _G.DisableAddOn(addon) table.insert(M.disabledAddOns, addon) end
function _G.LoadAddOn() return true end

local libs = {}
M.ldbObjects = {}
libs["LibDataBroker-1.1"] = { NewDataObject = function(_, name, obj) M.ldbObjects[name] = obj; return obj end }
M.dbIcons = {}
libs["LibDBIcon-1.0"] = {
    Register = function(_, name, obj, db) M.dbIcons[name] = { obj = obj, db = db } end,
    Show = function() end, Hide = function() end, Lock = function() end, Unlock = function() end, Refresh = function() end,
}
_G.LibStub = setmetatable({
    -- Real enough to let a genuinely-vendored LibStub library (LibDeflate, so far) register
    -- itself when its own source is dofile'd in a test, unlike the no-op this used to be: that
    -- no-op only ever went unnoticed because every other library here is hand-faked above
    -- rather than loaded for real, so nothing had called NewLibrary and expected a table back.
    NewLibrary = function(_, major) libs[major] = libs[major] or {}; return libs[major] end,
    GetLibrary = function(_, name) return libs[name] end,
}, { __call = function(_, name) return libs[name] end })

local function EmbedTimers(addon)
    function addon:ScheduleTimer(fn, delay)
        local timer = { at = world.time + delay, fn = fn }
        table.insert(timers, timer)
        return timer
    end
    function addon:ScheduleRepeatingTimer(fn, interval)
        local timer = { at = world.time + interval, fn = fn, interval = interval }
        table.insert(timers, timer)
        return timer
    end
    function addon:CancelTimer(timer)
        if timer then timer.at = nil end
    end
    return addon
end
libs["AceTimer-3.0"] = { Embed = function(_, target) return EmbedTimers(target) end }

-- The addons registered with AceAddon, by name. SpokenQuests asks after the players of its
-- own lineage here and stops the ones it finds, so a scenario describing an old install has
-- to register it before loading the addon: see M.SetLoadedPlayers.
M.aceAddons = {}
libs["AceAddon-3.0"] = {
    GetAddon = function(_, name) return M.aceAddons[name] end,
    NewAddon = function(_, name)
        local addon = EmbedTimers({ name = name })
        function addon:RegisterEvent() end
        function addon:UnregisterEvent() end
        M.aceAddons[name] = addon
        return addon
    end,
}

--- The old players a scenario has loaded, by AceAddon name, replacing any from the last one.
--- Each records the Disable call the way the real addon's own would be asked to stop.
function M.SetLoadedPlayers(names)
    M.aceAddons = {}
    for _, name in ipairs(names or {}) do
        M.aceAddons[name] = { name = name, Disable = function(self) self.stopped = true end }
    end
end

local function DeepCopy(value)
    if type(value) ~= "table" then return value end
    local copy = {}
    for key, item in pairs(value) do copy[key] = DeepCopy(item) end
    return copy
end

-- Enough of AceDB for migrations to be testable: an existing saved table named `name`
-- is read the way AceDB reads it -- profiles.Default over the defaults, the first char
-- entry over the char defaults, global as is -- and the db keeps a handle to it.
local function Merge(base, over)
    local out = DeepCopy(base or {})
    for k, v in pairs(over or {}) do
        if type(v) == "table" and type(out[k]) == "table" then out[k] = Merge(out[k], v) else out[k] = DeepCopy(v) end
    end
    return out
end
libs["AceDB-3.0"] = {
    New = function(_, name, defaults)
        local sv = type(_G[name]) == "table" and _G[name] or {}
        _G[name] = sv
        sv.profiles = sv.profiles or {}
        sv.profiles.Default = Merge(defaults.profile, sv.profiles.Default)
        sv.char = sv.char or {}
        local charKey = next(sv.char) or "Tester - Realm"
        sv.char[charKey] = Merge(defaults.char, sv.char[charKey])
        sv.global = sv.global or {}
        local db = { profile = sv.profiles.Default, char = sv.char[charKey], global = sv.global, sv = sv }
        db.RegisterCallback = function() end
        -- The profile half of AceDB, which the settings panels offer inline.
        local current = "Default"
        function db:GetCurrentProfile() return current end
        function db:GetProfiles()
            local names = {}
            for name in pairs(sv.profiles) do table.insert(names, name) end
            table.sort(names)
            return names
        end
        function db:SetProfile(name)
            sv.profiles[name] = sv.profiles[name] or Merge(defaults.profile, nil)
            current = name
            self.profile = sv.profiles[name]
        end
        function db:ResetProfile() sv.profiles[current] = Merge(defaults.profile, nil); self.profile = sv.profiles[current] end
        function db:CopyProfile(name) sv.profiles[current] = Merge(sv.profiles[name], nil); self.profile = sv.profiles[current] end
        function db:DeleteProfile(name) sv.profiles[name] = nil end
        return db
    end,
}

--- Load the Spoken player addon against this stub and return its private environment.
--- Loads exactly what its addon.xml and then Contribute.xml list, in order (a Blizzard-client
--- .toc's order), then initialises the saved variables the way ADDON_LOADED would.
function M.LoadSpoken(addonDirectory)
    for _, file in ipairs({ "Environment", "Version", "Core", "SoundUtils", "Callbacks", "SoundQueue", "Sources",
        "Strings", "UI/Layout", "UI/Portrait", "UI/StaticPortrait", "UI/Actions", "UI/PlayerFrame",
        "UI/MinimalPlayer", "UI/MinimapButton",
        -- Real LibDeflate, not a hand-faked stub library: Contribute:Encode's round trip through
        -- actual compression is the point of testing it at all.
        "UI/Options", "API", "Libs/LibDeflate/LibDeflate", "Compat", "UI/ContributeBox", "Contribute", "Gather", "TaintReport" }) do
        dofile(addonDirectory .. file .. ".lua")
    end
    local env = _G.SpokenEnv
    env.Addon:InitDB()
    -- These suites exercise the original layout. The Minimal Classic layout,
    -- including switching back to this one, has its own UI/timer fixture.
    env.Addon.db.profile.Frame.MinimalPlayer = false
    return env
end

--- Forget every scheduled timer. A test that loads a fresh player must call this, or the
--- previous player's clip timers and retry ticker keep firing into the new one.
function M.ResetTimers()
    for i = #timers, 1, -1 do timers[i] = nil end
end

--- Load the zones addon's playback files the way the client would -- each chunk receives
--- the addon name and the shared table as varargs -- against a hand-built SpokenZones table
--- carrying the few Core.lua facts Audio.lua and Autoplay.lua read. Returns that table.
function M.LoadZones(addonDirectory, SpokenZones)
    for _, file in ipairs({ "Audio", "UI/ReportButton", "Autoplay" }) do
        local chunk = assert(loadfile(addonDirectory .. file .. ".lua"))
        chunk("SpokenZones", SpokenZones)
    end
    return SpokenZones
end

--- Reset every piece of sound state a test can observe.
function M.ResetSound()
    for _, key in ipairs({ "played", "playedChannels", "stopped", "music", "missing", "cvars", "cvarLog" }) do
        world[key] = {}
    end
end

--- The quest log of a client that draws the modern map-attached one: no QuestLogFrame, no
--- QuestLog_Update and no GetQuestLogTitle, rows out of an unnamed frame pool, and one
--- global function that redraws the list. `quests` is a list of { questID, title, level }.
function M.SetModernQuestLog(quests)
    local scroll = _G.CreateFrame("ScrollFrame", "QuestScrollFrame")
    scroll.Contents = _G.CreateFrame("Frame", nil, scroll)

    local active = {}
    scroll.titleFramePool = {
        active = active,
        EnumerateActive = function(self)
            local index = 0
            return function()
                index = index + 1
                return self.active[index]
            end
        end,
    }

    local titles = {}
    local descriptions = {}
    for _, quest in ipairs(quests) do
        local row = _G.CreateFrame("Button", nil, scroll.Contents)
        row.questID = quest.questID
        row.Text = row:CreateFontString()
        -- The row's own text carries the level prefix the quest log draws with it.
        row.Text:SetText(format("[%d] %s", quest.level or 1, quest.title))
        row.Checkbox = _G.CreateFrame("Frame", nil, row)
        table.insert(active, row)
        titles[quest.questID] = quest.title
        descriptions[getn(active)] = quest.description
    end

    -- The details view the list opens a quest into, and the one function that opens it.
    local map = _G.CreateFrame("Frame", "QuestMapFrame")
    map.DetailsFrame = _G.CreateFrame("Frame", nil, map)
    map.DetailsFrame.BackFrame = _G.CreateFrame("Frame", nil, map.DetailsFrame)
    -- The strip's own button, which is what anything else put on that line is measured against.
    map.DetailsFrame.BackFrame.BackButton = _G.CreateFrame("Button", nil, map.DetailsFrame.BackFrame)
    map.DetailsFrame.BackFrame.BackButton:SetSize(90, 22)
    map.DetailsFrame.BackFrame.BackButton:SetPoint("LEFT", map.DetailsFrame.BackFrame, "LEFT", 11, 4)
    function _G.QuestMapFrame_ShowQuestDetails(questID)
        map.DetailsFrame.questID = questID
    end

    _G.C_QuestLog = {
        GetTitleForQuestID = function(questID) return titles[questID] end,
        GetNumQuestLogEntries = function() return getn(active) end,
        GetLogIndexForQuestID = function(questID)
            for index, row in ipairs(active) do
                if row.questID == questID then return index end
            end
        end,
    }
    -- The modern log's text is asked for by entry index; it has no selection to read it from.
    _G.GetQuestLogQuestText = function(index)
        return descriptions[index], ""
    end
    -- What the client redraws the list through, and what the overlay hooks.
    _G.QuestLogQuests_Update = function() end

    M.questLogRows = active
    M.questLogPOIButtons = {}
    return scroll
end

--- The objective icons the quest log draws beside its rows when "Quest objectives" is on:
--- one small button per quest, pooled beside the rows rather than parented to them.
function M.SetQuestLogPOIIcons(shown)
    for _, poiButton in ipairs(M.questLogPOIButtons or {}) do
        poiButton:Hide()
    end
    M.questLogPOIButtons = {}
    if not shown then
        return
    end
    for _, row in ipairs(M.questLogRows or {}) do
        local poiButton = _G.CreateFrame("Button", nil, row:GetParent())
        poiButton.questID = row.questID
        poiButton:SetSize(20, 20)
        poiButton:SetPoint("TOPLEFT", row, "TOPLEFT", 6, -4)
        table.insert(M.questLogPOIButtons, poiButton)
    end
end

--- Load the quests addon against this stub, on top of a booted Spoken player, and return
--- its private environment. The three UI modules the dispatch path touches but which
--- decide nothing about which line is read are stubbed with answer-everything tables.
function M.LoadQuests(addonDirectory, spokenDirectory)
    local env = M.LoadSpoken(spokenDirectory)
    env.Addon:Enable()

    dofile(addonDirectory .. "Environment.lua")
    local VO = _G.VoiceOver
    for _, module in ipairs({ "QuestOverlayUI", "Options" }) do
        VO[module] = setmetatable({}, { __index = function() return function() end end })
    end
    for _, file in ipairs({ "Version", "Enums", "Utils", "Language", "Debug", "Strings", "FuzzySearch", "EasterEggs",
        "DataModules", "ReportButton", "Player", "VoiceOver", "Contribute" }) do
        dofile(addonDirectory .. file .. ".lua")
    end
    return VO, env
end

--- The quests addon with its real quest log overlay and its compatibility branches, which
--- LoadQuests stubs out: what draws the play button beside a quest in the quest log. Build
--- the client's quest log first - the overlay branches are chosen as Compatibility loads.
function M.LoadQuestsOverlay(addonDirectory, spokenDirectory)
    local VO, env = M.LoadQuests(addonDirectory, spokenDirectory)
    dofile(addonDirectory .. "QuestOverlayUI.lua")
    dofile(addonDirectory .. "Compatibility.lua")
    return VO, env
end

--- The quests addon with no player at all: what a hand-install without the optional
--- dependency loads. LoadQuests boots the player first; this deliberately does not.
function M.LoadQuestsAlone(addonDirectory)
    dofile(addonDirectory .. "Environment.lua")
    local VO = _G.VoiceOver
    for _, module in ipairs({ "QuestOverlayUI", "Options" }) do
        VO[module] = setmetatable({}, { __index = function() return function() end end })
    end
    for _, file in ipairs({ "Version", "Enums", "Utils", "Language", "Debug", "Strings", "FuzzySearch", "EasterEggs",
        "DataModules", "ReportButton", "Player", "VoiceOver", "Contribute" }) do
        dofile(addonDirectory .. file .. ".lua")
    end
    return VO
end

--- The quests addon's settings panel, which the dispatch tests have no use for: its two
--- files, on top of an addon already loaded by LoadQuests or LoadQuestsAlone.
function M.LoadQuestsPanel(addonDirectory, VO)
    dofile(addonDirectory .. "UI/Layout.lua")
    dofile(addonDirectory .. "UI/SettingsPanel.lua")
    return VO.SettingsPanel
end

--- Kept for one release: the pre-cutover loader name.
M.LoadPlayer = function(addonDirectory)
    local VO = M.LoadQuests(addonDirectory, addonDirectory .. "../SpokenPlayer/")
    return VO
end

-- Everything named up to here is the client's own; ResetFrames keeps these.
M.MarkBaseFrames()

return M
