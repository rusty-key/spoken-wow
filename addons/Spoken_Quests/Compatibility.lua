setfenv(1, VoiceOver)

-- Patch 11.0.2 removed the legacy global AddOn-management API. Current
-- Classic clients expose the same operations through C_AddOns, with the
-- character/addon argument order reversed for GetAddOnEnableState.
-- Keep these shims private to VoiceOver's environment so other addons are
-- not affected.
if C_AddOns then
    GetNumAddOns = GetNumAddOns or C_AddOns.GetNumAddOns
    GetAddOnInfo = GetAddOnInfo or C_AddOns.GetAddOnInfo
    GetAddOnMetadata = GetAddOnMetadata or C_AddOns.GetAddOnMetadata
    IsAddOnLoadOnDemand = IsAddOnLoadOnDemand or C_AddOns.IsAddOnLoadOnDemand
    LoadAddOn = LoadAddOn or C_AddOns.LoadAddOn
    EnableAddOn = EnableAddOn or C_AddOns.EnableAddOn
    DisableAddOn = DisableAddOn or C_AddOns.DisableAddOn

    if not GetAddOnEnableState and C_AddOns.GetAddOnEnableState then
        function GetAddOnEnableState(character, addon)
            if addon == nil then
                addon = character
                character = nil
            end
            return C_AddOns.GetAddOnEnableState(addon, character)
        end
    end

    if not IsAddOnLoaded and C_AddOns.IsAddOnLoaded then
        function IsAddOnLoaded(addon)
            local loadedOrLoading, loaded = C_AddOns.IsAddOnLoaded(addon)
            if loaded ~= nil then
                return loaded
            end
            return loadedOrLoading
        end
    end
end

-- The namespaced gossip API is used by every modern Classic branch,
-- including Burning Crusade Anniversary. The upstream compatibility file
-- omitted that branch.
if C_GossipInfo then
    GetGossipText = GetGossipText or C_GossipInfo.GetText
    GetNumGossipActiveQuests = GetNumGossipActiveQuests or C_GossipInfo.GetNumActiveQuests
    GetNumGossipAvailableQuests = GetNumGossipAvailableQuests or C_GossipInfo.GetNumAvailableQuests
end

-- Camelot (1.60.1, interface 16001) ships FrameXML without the global
-- SetDesaturation helper; only the Texture:SetDesaturated method survives.
-- AceGUI's CheckBox calls the global by name, and the embedded libs run in _G
-- rather than in this environment, so unlike every other shim in this file
-- that one has to be written to _G. Guarded, so a client that still defines
-- it keeps its own, and the body is Blizzard's: SetDesaturated returns false
-- where the shader is unsupported, and the grey vertex colour is the fallback.
if not _G.SetDesaturation then
    function _G.SetDesaturation(texture, desaturation)
        local shaderSupported = texture.SetDesaturated and texture:SetDesaturated(desaturation)
        if not shaderSupported then
            if desaturation then
                texture:SetVertexColor(0.5, 0.5, 0.5)
            else
                texture:SetVertexColor(1.0, 1.0, 1.0)
            end
        end
    end
end

if not select then
    function select(index, ...)
        if index == "#" then
            return arg.n
        else
            local result = {}
            for i = index, arg.n do
                table.insert(result, arg[i])
            end
            return unpack(result)
        end
    end
end

if not print or Version.IsLegacyVanilla or Version.IsLegacyBurningCrusade then
    local argn, argi
    if Version.IsLegacyVanilla then
        argn, argi = "arg.n", "arg[i]"
    else
        argn, argi = [[select("#", ...)]], [[(select(i, ...))]]
    end
    print = loadstring(format([[return function(...)
        local text = ""
        for i = 1, %s do
            text = text .. (i > 1 and " " or "") .. tostring(%s)
        end
        DEFAULT_CHAT_FRAME:AddMessage(text)
    end]], argn, argi))()
end

if not strsplit then
    function strsplit(delimiter, text)
        local result = {}
        local from = 1
        local delim_from, delim_to = string.find(text, delimiter, from)
        while delim_from do
            table.insert(result, string.sub(text, from, delim_from - 1))
            from = delim_to + 1
            delim_from, delim_to = string.find(text, delimiter, from)
        end
        table.insert(result, string.sub(text, from))
        return unpack(result)
    end
end

if not string.gmatch then
    string.gmatch = string.gfind
end

if not string.match then
    local function getargs(s, e, ...)
        return unpack(arg)
    end
    function string.match(str, pattern)
        return getargs(string.find(str, pattern))
    end
end

if not string.trim then
    function string.trim(str)
        return (string.match(str, "^%s*(.-)%s*$"))
    end
end

if not table.wipe then
    function table.wipe(tbl)
        for key in next, tbl do
            tbl[key] = nil
        end
    end
end
if not wipe then
    wipe = table.wipe
end

if not hooksecurefunc then
    ---@overload fun(name, hook)
    function hooksecurefunc(table, name, hook)
        if not hook then
            name, hook = table, name
            table = _G
        end

        local old = table[name]
        assert(type(old) == "function")
        table[name] = function(...)
            local result = { old(unpack(arg)) }
            hook(unpack(arg))
            return unpack(result)
        end
    end
end

if not GetAddOnEnableState then
    ---@overload fun(addon)
    function GetAddOnEnableState(character, addon)
        addon = addon or character
        local name, _, _, _, loadable, reason = _G.GetAddOnInfo(addon)
        if not name or not loadable and reason == "DISABLED" then
            return 0
        end
        return 2
    end

    function GetAddOnInfo(indexOrName)
        local name, title, notes, enabled, loadable, reason, security, newVersion = _G.GetAddOnInfo(indexOrName)
        return name, title, notes, loadable, reason, security, newVersion
    end
end

if not GetQuestID then
    local source, text
    local GetTitleText = GetTitleText -- Store original function before EQL3 (Extended Quest Log 3) overrides it and starts prepending quest level
    -- Told by VoiceOver.lua's QuestIDFor, just before it asks which quest this is.
    function Addon:NoteLegacyQuestEvent(eventSource, eventText)
        source = eventSource
        text = eventText
    end
    function GetQuestID()
        local npcName = Utils:GetNPCName()
        if Utils:IsNPCPlayer() then
            -- Can't do anything about quest sharing currently, because we need the original questgiver's name to obtain quest ID, and we need quest ID to obtain the questgiver's name
            return 0
        end

        return DataModules:GetQuestID(source, GetTitleText(), npcName, text) or 0
    end
end

if not QUESTS_DISPLAYED then
    if QuestLogScrollFrame then
        QUESTS_DISPLAYED = getn(QuestLogScrollFrame.buttons)
    end
end

-- Patch 7.3.0: New global table: SOUNDKIT - Keys are named similar to the old string names, and they hold the soundkit ID for the sound
if not SOUNDKIT or Version:IsBelowLegacyVersion(70300) then
    SOUNDKIT =
    {
        U_CHAT_SCROLL_BUTTON = "uChatScrollButton",
        IG_MAINMENU_OPEN = "igMainMenuOpen",
        IG_MAINMENU_CLOSE = "igMainMenuClose",
    }
end

-- Not sure when exactly were UI-Cursor-Move and UI-Cursor-SizeRight added, but the former was present in 6.0.1
if Version:IsBelowLegacyVersion(60000) then
    function SetCursor() end
end

-- Patch 2.4.0 (2008-03-25): Added.
if Version.IsAnyLegacy and not UnitGUID then
    -- 1.0.0 - 2.3.0
    Utils.GetGUIDType = nil
    Utils.GetIDFromGUID = nil
    Utils.MakeGUID = function() end
-- Patch 4.0.1 (2010-10-12): Bits shifted. NPCID is now characters 5-8, not 7-10 (counting from 1).
elseif Version:IsBelowLegacyVersion(40000) then
    -- 2.4.0 - 3.3.5
    Enums.GUID.Player     = tonumber("0000", 16)
    Enums.GUID.Item       = tonumber("4000", 16)
    Enums.GUID.Creature   = tonumber("F130", 16)
    Enums.GUID.Vehicle    = tonumber("F150", 16)
    Enums.GUID.GameObject = tonumber("F110", 16)

    function Utils:GetGUIDType(guid)
        return guid and tonumber(guid:sub(3, 3 + 4 - 1), 16)
    end

    function Utils:GetIDFromGUID(guid)
        local type = assert(self:GetGUIDType(guid), format([[Failed to determine the type of GUID "%s"]], guid))
        assert(Enums.GUID:GetName(type), format([[Unknown GUID type %d]], type))
        assert(Enums.GUID:CanHaveID(type), format([[GUID "%s" does not contain ID]], guid))
        return tonumber(guid:sub(7, 7 + 6 - 1), 16)
    end

    function Utils:MakeGUID(type, id)
        assert(Enums.GUID:CanHaveID(type), format("GUID of type %d (%s) cannot contain ID", type, Enums.GUID:GetName(type) or "Unknown"))
        return format("0x%04X%06X%06X", type, id, 0)
    end
-- Patch 6.0.2 (2014-10-14): Changed to a new format, e.g. for players: Player-[serverID]-[playerUID]
elseif Version:IsBelowLegacyVersion(60000) then
    -- 4.0.1 - 5.4.8
    Enums.GUID.Player     = tonumber("000", 16)
    Enums.GUID.Item       = tonumber("400", 16)
    Enums.GUID.Creature   = tonumber("F13", 16)
    Enums.GUID.Vehicle    = tonumber("F15", 16)
    Enums.GUID.GameObject = tonumber("F11", 16)

    function Utils:GetGUIDType(guid)
        return guid and tonumber(guid:sub(3, 3 + 3 - 1), 16)
    end

    function Utils:GetIDFromGUID(guid)
        if not guid then
            return
        end
        local type = assert(self:GetGUIDType(guid), format([[Failed to determine the type of GUID "%s"]], guid))
        assert(Enums.GUID:GetName(type), format("Unknown GUID type %d", type))
        assert(Enums.GUID:CanHaveID(type), format([[GUID "%s" does not contain ID]], guid))
        return tonumber(guid:sub(6, 6 + 5 - 1), 16)
    end

    function Utils:MakeGUID(type, id)
        assert(Enums.GUID:CanHaveID(type), format("GUID of type %d (%s) cannot contain ID", type, Enums.GUID:GetName(type) or "Unknown"))
        return format("0x%03X%05X%08X", type, id, 0)
    end
end

-- Patch 6.0.2 (2014-10-14): Removed returns 'questTag' and 'isDaily'. Added returns 'frequency', 'isOnMap', 'hasLocalPOI', 'isTask', and 'isStory'.
if Version:IsBelowLegacyVersion(60000) then
    local dummyQuestIDMap = { NEXT = -1 }
    local oldGetQuestLogTitle = GetQuestLogTitle -- Store original function before BEQL (Bayi's Extended Questlog) overrides it and starts prepending quest level
    function GetQuestLogTitle(questIndex)
        local title, level, questTag, suggestedGroup, isHeader, isCollapsed, isComplete, isDaily, questID, displayQuestID
        -- Patch 2.0.3 (2007-01-09): Added the 'suggestedGroup' return.
        if Version:IsBelowLegacyVersion(20000) then
            title, level, questTag, isHeader, isCollapsed, isComplete = oldGetQuestLogTitle(questIndex)
        else
            title, level, questTag, suggestedGroup, isHeader, isCollapsed, isComplete, isDaily, questID, displayQuestID = oldGetQuestLogTitle(questIndex)
        end
        -- Patch 3.3.0 (2009-12-08): Added the 'questID' return.
        if Version:IsBelowLegacyVersion(30300) then
            questID = DataModules:GetQuestID("accept", title, "", "")
            if not questID then
                -- Try assuming that the last quest with the same title that the player has accepted is the quest that's currently in the quest log
                questID = Addon.db.char.RecentQuestTitleToID[title]
            end
            if not questID then
                -- Return a dummy quest ID unique per quest title, just to support having multiple quest log buttons in their current implementation (i.e. keyed by quest ID instead of button index)
                questID = dummyQuestIDMap[title]
                if not questID then
                    questID = dummyQuestIDMap.NEXT
                    dummyQuestIDMap.NEXT = dummyQuestIDMap.NEXT - 1
                    dummyQuestIDMap[title] = questID
                end
            end
        end
        local frequency = isDaily and 2 or 1
        return title, level, suggestedGroup, isHeader, isCollapsed, isComplete, frequency, questID
    end
end

local RegionMixins = {}
local RegionOverrides = {}
local FrameMixins = {}
local FrameOverrides = {}
local FontStringMixins = {}
local ModelMixins = {}
local function ApplyMixinsAndOverrides(self, mixins, overrides)
    if mixins then
        for k, v in pairs(mixins) do
            if not self[k] then
                self[k] = v
            end
        end
    end
    if overrides then
        for k, v in pairs(overrides) do
            if self[k] then
                self["_" .. k], self[k] = self[k], v
            end
        end
    end
end
local hookFrame
local hookModel
function CreateFrame(frameType, name, parent, template)
    if UIParent.SetBackdrop and template == "BackdropTemplate" then
        template = nil
    end

    local frame = _G.CreateFrame(frameType, name, parent, template)
    ApplyMixinsAndOverrides(frame, RegionMixins, RegionOverrides)
    ApplyMixinsAndOverrides(frame, FrameMixins, FrameOverrides)
    if hookFrame then
        hookFrame(frame)
    end
    if frameType == "Model" or frameType == "PlayerModel" or frameType == "DressUpModel" then
        ApplyMixinsAndOverrides(frame, ModelMixins)
        if hookModel then
            hookModel(frame)
        end
    end
    return frame
end

function RegionMixins:SetShown(shown)
    if shown then
        self:Show()
    else
        self:Hide()
    end
end
function RegionMixins:SetSize(width, height)
    self:SetWidth(width)
    self:SetHeight(height)
end
function FrameMixins:SetResizeBounds(minWidth, minHeight, maxWidth, maxHeight)
    self:SetMinResize(minWidth, minHeight)
    if maxWidth and maxHeight then
        self:SetMaxResize(maxWidth, maxHeight)
    end
end

if Version.IsLegacyVanilla then

    LibStub("AceConfig-3.0"):Embed(Addon)

    local function getargn(...)
        return arg.n
    end
    function GetNumGossipActiveQuests()
        return getargn(GetGossipActiveQuests())
    end
    function GetNumGossipAvailableQuests()
        return getargn(GetGossipAvailableQuests())
    end

    function Utils:GetNPCName()
        return UnitName("npc")
    end

    function Utils:GetNPCGUID()
        return nil
    end

    function Utils:IsNPCObjectOrItem()
        return not UnitExists("npc")
    end

    function Utils:IsNPCPlayer()
        return UnitIsPlayer("npc")
    end

    function RegionOverrides:SetPoint(point, region, relativeFrame, offsetX, offsetY)
        if region == nil and relativeFrame == nil and offsetX == nil and offsetY == nil then
            self:_SetPoint(point, 0, 0)
        else
            self:_SetPoint(point, region, relativeFrame, offsetX, offsetY)
        end
    end
    function FrameOverrides:SetScript(script, handler)
        self:_SetScript(script, script == "OnEvent"
            and function() handler(this, event, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end
            or  function() handler(this,        arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end)
    end
    function FrameMixins:HookScript(script, handler)
        local old = self:GetScript(script)
        self:_SetScript(script, script == "OnEvent"
            and function() if old then old() end handler(this, event, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end
            or  function() if old then old() end handler(this,        arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end)
    end

    hooksecurefunc(GameTooltip, "SetOwner", function(self, owner, anchor)
        self._owner = owner
    end)
    function GameTooltip:GetOwner()
        return self._owner
    end

    function Addon.OnAddonLoad.EQL3() -- Extended Quest Log 3
        QUESTS_DISPLAYED = EQL3_QUESTS_DISPLAYED

        QuestLogFrame = EQL3_QuestLogFrame
        QuestLogListScrollFrame = EQL3_QuestLogListScrollFrame

        function Utils:GetQuestLogTitleFrame(index)
            return _G["EQL3_QuestLogTitle" .. index]
        end

        function Utils:GetQuestLogTitleNormalText(index)
            return _G["EQL3_QuestLogTitle" .. index .. "NormalText"]
        end

        function Utils:GetQuestLogTitleCheck(index)
            return _G["EQL3_QuestLogTitle" .. index .. "Check"]
        end

        -- Hook the new function created by EQL3
        hooksecurefunc("QuestLog_Update", function()
            QuestOverlayUI:Update()
        end)
    end

end
-- Patch 3.0.2 (2008-10-14): script handlers started receiving the frame and the event as
-- arguments. Before it they read the globals `this`, `event` and `arg1`...`arg9`, so a handler
-- written the modern way is called with nils. 1.12 gets this from the block above; 2.4.3 needs
-- it for the same reason, and only these frames are affected - the override reaches whatever
-- was built through this file's CreateFrame.
if Version.IsLegacyBurningCrusade then
    function FrameOverrides:SetScript(script, handler)
        self:_SetScript(script, script == "OnEvent"
            and function() handler(this, event, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end
            or  function() handler(this,        arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end)
    end
end
if Version.IsLegacyVanilla or Version.IsLegacyBurningCrusade then

    function FrameOverrides:HookScript(script, handler)
        if self:GetScript(script) then
            self:_HookScript(script, handler)
        else
            self:SetScript(script, handler)
        end
    end
    function FrameOverrides:CreateTexture(name, layer)
        local region = self:_CreateTexture(name, layer)
        ApplyMixinsAndOverrides(region, RegionMixins, RegionOverrides)
        return region
    end
    function FrameOverrides:CreateFontString(name, layer, template)
        local region = self:_CreateFontString(name, layer, template)
        ApplyMixinsAndOverrides(region, RegionMixins, RegionOverrides)
        ApplyMixinsAndOverrides(region, FontStringMixins)
        return region
    end
    function FrameOverrides:SetNormalTexture(file)
        local texture = self:CreateTexture(nil, "ARTWORK")
        local success = texture:SetTexture(file)
        texture:SetAllPoints()
        self._normalTexture = texture
        self:_SetNormalTexture(texture)
        return success
    end
    function FrameMixins:GetNormalTexture()
        return self._normalTexture
    end
    function FrameOverrides:SetPushedTexture(file)
        local texture = self:CreateTexture(nil, "ARTWORK")
        local success = texture:SetTexture(file)
        texture:SetAllPoints()
        self._pushedTexture = texture
        self:_SetPushedTexture(texture)
        return success
    end
    function FrameMixins:GetPushedTexture()
        return self._pushedTexture
    end
    function FrameOverrides:SetDisabledTexture(file)
        local texture = self:CreateTexture(nil, "ARTWORK")
        local success = texture:SetTexture(file)
        texture:SetAllPoints()
        self._disabledTexture = texture
        self:_SetDisabledTexture(texture)
        return success
    end
    function FrameMixins:GetDisabledTexture()
        return self._disabledTexture
    end
    function FrameOverrides:SetHighlightTexture(file)
        local texture = self:CreateTexture(nil, "HIGHLIGHT")
        local success = texture:SetTexture(file)
        texture:SetAllPoints()
        self._highlightTexture = texture
        self:_SetHighlightTexture(texture)
        return success
    end
    function FrameMixins:GetHighlightTexture()
        return self._highlightTexture
    end
    function FontStringMixins:SetWordWrap(wrap)
        if not wrap then
            self:SetHeight((select(2, self:GetFont())))
        end
    end

    function GameTooltip_Hide()
        -- Used for XML OnLeave handlers
        GameTooltip:Hide()
    end

end
if Version.IsLegacyBurningCrusade then
end
if Version.IsLegacyWrath then

    function Utils:GetQuestLogScrollOffset()
        return HybridScrollFrame_GetOffset(QuestLogScrollFrame)
    end

    function Utils:GetQuestLogTitleFrame(index)
        return _G["QuestLogScrollFrameButton" .. index]
    end

    function Utils:GetQuestLogTitleNormalText(index)
        return _G["QuestLogScrollFrameButton" .. index .. "NormalText"]
    end

    function Utils:GetQuestLogTitleCheck(index)
        return _G["QuestLogScrollFrameButton" .. index .. "Check"]
    end

    local prefix
    local QuestLogTitleButton_Resize = QuestLogTitleButton_Resize
    function QuestOverlayUI:UpdateQuestTitle(questLogTitleFrame, playButton, normalText, questCheck)
        if not prefix then
            local text = normalText:GetText()
            for i = 1, 20 do
                normalText:SetText(string.rep(" ", i))
                if normalText:GetStringWidth() >= 24 then
                    prefix = normalText:GetText()
                    break
                end
            end
            prefix = prefix or "  "
            normalText:SetText(text)
        end

        playButton:SetPoint("LEFT", normalText, "LEFT", 4, 0)
        normalText:SetText(prefix .. (normalText:GetText() or ""):trim())
        QuestLogTitleButton_Resize(questLogTitleFrame)
    end

    hooksecurefunc(Addon, "OnInitialize", function()
        QuestLogScrollFrame.update = QuestLog_Update
    end)

    function Utils:GetQuestLogTitleCheck(index)
        return _G["QuestLogListScrollFrameButton" .. index .. "Check"]
    end

    local QuestLogTitleButton_Resize = QuestLogTitleButton_Resize -- Store original function before LeatrixPlus's "Enhance quest log" hooks into it
    local prefix
    function QuestOverlayUI:UpdateQuestTitle(questLogTitleFrame, playButton, normalText, questCheck)
        if not prefix then
            local text = normalText:GetText()
            for i = 1, 20 do
                normalText:SetText(string.rep(" ", i))
                if normalText:GetStringWidth() >= 24 then
                    prefix = normalText:GetText()
                    break
                end
            end
            prefix = prefix or "  "
            normalText:SetText(text)
        end

        playButton:SetPoint("LEFT", normalText, "LEFT", 4, 0)
        normalText:SetText(prefix .. (normalText:GetText() or ""):trim())
        QuestLogTitleButton_Resize(questLogTitleFrame)
    end

    hooksecurefunc(Addon, "OnInitialize", function()
        QuestLogListScrollFrame.update = QuestLog_Update
    end)

    function Addon.OnAddonLoad.Guidelime()
        QuestLogFrame:HookScript("OnUpdate", function()
            -- Update QuestOverlayUI again after Guidelime decorates the titles
            QuestOverlayUI:Update()
        end)
    end

end
-- Asked of the API rather than the project id: Forever took this shim as mainline until
-- build 70170 gave it a project id of its own, and the next build may change it again.
if C_GossipInfo and not GetGossipText then

    GetGossipText = C_GossipInfo.GetText
    GetNumGossipActiveQuests = C_GossipInfo.GetNumActiveQuests
    GetNumGossipAvailableQuests = C_GossipInfo.GetNumAvailableQuests

end

-- The Forever client (1.60.1, interface 16001) reports itself as mainline and draws the
-- modern map-attached quest log. `QuestLogFrame`, `QuestLog_Update`, `GetQuestLogTitle` and
-- `QUESTS_DISPLAYED` do not exist there, and the rows are pooled frames with no names, so
-- QuestOverlayUI's walk over `QuestLogTitle1..QUESTS_DISPLAYED` had nothing to walk and no
-- hook to run from: the play button was simply absent from the quest log on that client.
--
-- Feature-detected rather than keyed to the client, since this is the quest log every
-- mainline-flavoured client draws, and the one the Era client will draw if it ever adopts it.
if QuestLogQuests_Update and QuestScrollFrame and QuestScrollFrame.titleFramePool and
    QuestScrollFrame.titleFramePool.EnumerateActive then

    local POI_BUTTON_SIZE = 20

    function QuestOverlayUI:GetPlayButtonParent()
        return QuestScrollFrame
    end

    --- The client's own objective icon for this quest, drawn when "Quest objectives" is on: a
    --- small square button carrying the quest's ID, anchored to the row's top left corner and
    --- pooled beside the rows rather than parented to them. The play button is the one frame
    --- of that size and shape that is not it.
    local function QuestPOIButton(row)
        local questID = row.questID
        for _, child in ipairs({ row:GetParent():GetChildren() }) do
            if child ~= QuestOverlayUI.questPlayButtons[questID] and child.questID == questID and
                child:IsShown() and child.GetObjectType and child:GetObjectType() == "Button" and
                math.abs(child:GetWidth() - POI_BUTTON_SIZE) < 1 then
                return child
            end
        end
    end

    -- Left of the title, in the inset the row leaves at its left - unless "Quest objectives"
    -- is on, when that inset is the client's own icon and the button goes to the other end of
    -- the row instead, beside the tracking checkbox. Not the blank prefix the old quest log's
    -- buttons indent a title with, either: this title wraps into a height the layout has
    -- already decided, and a prefix re-wraps it inside a row too short to hold the extra line.
    function QuestOverlayUI:UpdateQuestTitle(questLogTitleFrame, playButton)
        playButton:ClearAllPoints()
        local poiButton = QuestPOIButton(questLogTitleFrame)
        if poiButton and questLogTitleFrame.Checkbox then
            playButton:SetPoint("RIGHT", questLogTitleFrame.Checkbox, "LEFT", -2, 0)
        elseif poiButton then
            playButton:SetPoint("TOPRIGHT", questLogTitleFrame, "TOPRIGHT", -4, -2)
        else
            playButton:SetPoint("TOPLEFT", questLogTitleFrame, "TOPLEFT", 6, -4)
        end
    end

    function QuestOverlayUI:Update()
        -- Every button, not only the ones on screen: a row released back to the pool keeps
        -- the button parented to it, and a stale button on a reused row marks the wrong quest.
        for _, button in pairs(self.displayedButtons) do
            button:Hide()
        end
        table.wipe(self.displayedButtons)
        -- Switched off, the part puts nothing on the log.
        if not Addon:IsPartOn() then return end

        for row in QuestScrollFrame.titleFramePool:EnumerateActive() do
            local questID = row.questID
            if questID then
                if not self.questPlayButtons[questID] then
                    self:CreatePlayButton(questID)
                end
                local playButton = self.questPlayButtons[questID]
                local shown = playButton

                if DataModules:PrepareSound({ event = Enums.SoundEvent.QuestAccept, questID = questID }) then
                    self:UpdatePlayButton(QuestOverlayUI:GetQuestTitle(questID, row), questID, row, row.Text,
                        row.Checkbox)
                    playButton:Enable()
                else
                    -- No sound: Contribute where Play would be, or Play greyed out where this
                    -- client cannot contribute.
                    local contribute = self:ContributeButtonFor(questID, QuestOverlayUI:GetQuestTitle(questID, row))
                    if contribute then
                        playButton:Hide()
                        shown = contribute
                    else
                        playButton:Disable()
                    end
                    shown:SetParent(row:GetParent())
                    if contribute then
                        contribute:SetFrameLevel(row:GetFrameLevel() + 2)
                    end
                    self:UpdateQuestTitle(row, shown)
                end

                shown:Show()
                if shown == playButton then
                    self:UpdatePlayButtonTexture(questID)
                end
                table.insert(self.displayedButtons, shown)
            end
        end
    end

    --- The row draws its title with the quest's level in front of it; the sound data
    --- everywhere else is keyed by the title the client reports.
    function QuestOverlayUI:GetQuestTitle(questID, row)
        local title = C_QuestLog and C_QuestLog.GetTitleForQuestID and C_QuestLog.GetTitleForQuestID(questID)
        return title or (row and row.Text and row.Text:GetText()) or ""
    end

    -- The modern log redraws through this one function, which is what `QuestLog_Update` was
    -- on the old one. VoiceOver.lua hooks that name and finds nothing here.
    hooksecurefunc("QuestLogQuests_Update", function()
        QuestOverlayUI:Update()
    end)

    -- The details view is a second place a quest is read from, and the list's buttons cannot
    -- follow it there: a frame has one parent. Play, Report and Contribute, rebound to whichever
    -- quest the panel is showing, in the corner opposite its Back button.
    if QuestMapFrame and QuestMapFrame.DetailsFrame and QuestMapFrame_ShowQuestDetails then
        -- This quest's accept line in the queue, whoever queued it: autoplay, the log's own button
        -- or this one. Found again each time, since a rebind or a reopened panel starts afresh.
        local function QueuedLine(questID)
            for _, clip in ipairs(Player:Queued()) do
                if clip.questID == questID and clip.event == Enums.SoundEvent.QuestAccept then return clip end
            end
        end
        -- Stop while this quest's line speaks, Replay while it is stopped at the head, Play otherwise.
        local function StateOf(questID)
            local clip = QueuedLine(questID)
            if not clip or Spoken:GetCurrent() ~= clip then return "play", clip end
            if Spoken:IsPaused() then return "replay", clip end
            if Spoken:GetNowPlaying() == clip then return "stop", clip end
            return "play", clip
        end
        local function SetRoundPlaying(button)
            button:SetState((StateOf(button.questID)))
        end
        -- The tooltip says what a click does now.
        local TIPS = { play = { L.OPT_PLAY, L.OPT_PLAY_TIP }, stop = { L.OPT_STOP, L.OPT_STOP_TIP },
            replay = { L.OPT_REPLAY, L.OPT_REPLAY_TIP } }
        local function PlayTooltip(button)
            local tip = TIPS[button.state or "play"]
            GameTooltip:SetOwner(button, "ANCHOR_LEFT")
            GameTooltip:SetText(tip[1])
            GameTooltip:AddLine(tip[2], 1, 0.8, 0.2, true)
            GameTooltip:Show()
        end

        function QuestOverlayUI:UpdateDetailsPlayButton()
            if not Addon:IsPartOn() then
                if self.detailsPlayButton then self.detailsPlayButton:Hide() end
                if self.detailsReportButton then self.detailsReportButton:Hide() end
                if self.detailsContributeButton then self.detailsContributeButton:Hide() end
                return
            end
            local details = QuestMapFrame.DetailsFrame
            local questID = details.questID or
                (C_QuestLog and C_QuestLog.GetSelectedQuest and C_QuestLog.GetSelectedQuest())
            if not questID or questID == 0 then
                return
            end

            -- The player draws the round buttons (Spoken:CreateRoundButton); without it there is
            -- nothing to play.
            if not (Spoken and Spoken.CreateRoundButton) then
                return
            end
            if not self.detailsPlayButton then
                -- Play and Report as the lore window and the map's lore panel have them: the
                -- player's own round buttons, 24 across and 4 apart, Report in the corner.
                -- Level with the Back button: its inset and vertical offset on the same strip
                -- keep them on one line whatever the client sizes them to.
                --
                -- Under the panel's own header strip, which is what the Back button hangs
                -- off: a button parented to the details frame itself draws its artwork
                -- beneath the border art and arrives as a floating label with no button
                -- behind it. Detached, because the details panel is open
                -- (Utils:CreateDetachedFrame).
                local header = details.BackFrame or details
                local backButton = header.BackButton
                local _, _, _, backInset, backOffset = backButton and backButton:GetPoint(1)
                local report = Spoken:CreateRoundButton(header, "report")
                report:SetFrameLevel(header:GetFrameLevel() + 2)
                report:SetPoint("RIGHT", header, "RIGHT", -(backInset or 11), backOffset or 4)

                local playButton = Spoken:CreateRoundButton(header, "play", "SpokenQuestsDetailsPlayButton")
                playButton:SetFrameLevel(header:GetFrameLevel() + 2)
                playButton:SetPoint("RIGHT", report, "LEFT", -4, 0)
                playButton.setPlayState = SetRoundPlaying
                self.detailsPlayButton = playButton
                -- Stopped or replayed from the subtitle or the windows, the glyph follows.
                if Spoken.RegisterCallback then
                    Spoken:RegisterCallback("AUDIO_CHANGED", function()
                        QuestOverlayUI:SetPlayButtonState(playButton)
                    end)
                end

                -- With no line to play, the pair gives way to Contribute, in words: no glyph
                -- says it. In the corner where Report sits. Named, since UIPanelButtonTemplate
                -- names its pieces after its parent.
                local contributeButton = Utils:CreateDetachedFrame("Button", "SpokenQuestsDetailsContributeButton",
                    header, "UIPanelButtonTemplate")
                contributeButton:SetFrameLevel(header:GetFrameLevel() + 2)
                contributeButton:SetHeight(20)
                contributeButton:SetText(L.OPT_CONTRIBUTE)
                contributeButton:SetWidth(math.max(58, (contributeButton:GetTextWidth() or 0) + 24))
                contributeButton:SetPoint("RIGHT", header, "RIGHT", -(backInset or 11), backOffset or 4)
                contributeButton:SetScript("OnLeave", function()
                    if GameTooltip then GameTooltip:Hide() end
                end)
                contributeButton:Hide()
                self.detailsContributeButton = contributeButton

                -- Report: the game's bug in the player's round button, for a wrong reading
                -- of this quest.
                report:SetScript("OnClick", function(button)
                    local target = ReportButton:TargetForQuest(button.questID, Enums.SoundEvent.QuestAccept)
                    -- The language the line plays in, which PrepareSound records, as the player's
                    -- Report passes it: a fallback line is an English take under another language.
                    local sound = { event = Enums.SoundEvent.QuestAccept, questID = button.questID }
                    local language = DataModules:PrepareSound(sound) and sound.language or nil
                    if target then ReportButton:ShowLink(target, language) end
                end)
                report:HookScript("OnEnter", function(button)
                    GameTooltip:SetOwner(button, "ANCHOR_LEFT")
                    GameTooltip:SetText(L.OPT_REPORT_PROBLEM)
                    GameTooltip:AddLine(L.OPT_REPORT_QUEST_TIP, 1, 0.8, 0.2, true)
                    -- Its right-click opens the debug log's menu, where Spoken Developer is installed.
                    local hint = Spoken and Spoken.LogMenuHint and Spoken:LogMenuHint()
                    if hint then GameTooltip:AddLine(hint, 0.6, 0.6, 0.6, true) end
                    GameTooltip:Show()
                end)
                report:HookScript("OnLeave", function()
                    GameTooltip:Hide()
                end)
                self.detailsReportButton = report
            end
            local playButton = self.detailsPlayButton
            local report = self.detailsReportButton
            local contributeButton = self.detailsContributeButton
            report.questID = questID

            -- Rebound rather than kept: this button stood for a different quest a moment ago. A line
            -- of this quest's already queued is the one it stands for, whoever queued it.
            playButton.questID = questID
            self:BindPlayButton(playButton, questID, self:GetQuestTitle(questID))
            playButton.soundData = QueuedLine(questID)
            -- This quest's line speaking or stopped: Stop or Replay it, as the subtitle's
            -- button does. Waiting behind a line speaking: leave it queued; behind a stopped one: play it.
            -- Otherwise: queue it.
            local bound = playButton:GetScript("OnClick")
            -- Named arguments, not varargs: this file also loads on 1.12, whose Lua 5.0 cannot
            -- parse `...` as an expression, and one parse error loses the whole file.
            playButton:SetScript("OnClick", function(button, mouse, down)
                -- Looked up each click, never the copy kept when the panel opened: a line that has
                -- since finished is no longer in the queue, and holding on to it left the button dead.
                local state, clip = StateOf(button.questID)
                if state == "stop" or state == "replay" then
                    SpokenLayout.Sound("U_CHAT_SCROLL_BUTTON")
                    Spoken:TogglePause()
                elseif clip and Spoken:IsPaused() and Player.source then
                    -- Waiting behind a stopped line: Play on it plays it, and takes the queue out of its stop.
                    SpokenLayout.Sound("U_CHAT_SCROLL_BUTTON")
                    Player.source:PlayNow(clip)
                elseif not clip and bound then
                    -- The bound handler queues the line it holds, so it starts from a fresh one.
                    button.soundData = nil
                    bound(button, mouse, down)
                end
                QuestOverlayUI:SetPlayButtonState(button)
                if GameTooltip:GetOwner() == button then PlayTooltip(button) end
            end)
            playButton:SetScript("OnEnter", function(button)
                if button:IsEnabled() then button.glyph:SetAlpha(1) end
                PlayTooltip(button)
            end)
            playButton:SetScript("OnLeave", function(button)
                if button:IsEnabled() then button.glyph:SetAlpha(0.85) end
                GameTooltip:Hide()
            end)

            -- No sound: Contribute in the pair's place, where this client can contribute at all
            -- (Contribute:CanOfferFromLog); otherwise Play greyed out and nothing to report.
            local contribute = rawget(VoiceOver, "Contribute")
            contributeButton:Hide()
            if DataModules:PrepareSound({ event = Enums.SoundEvent.QuestAccept, questID = questID }) then
                playButton:Enable()
                playButton:Show()
                report:Show()
            elseif contribute and contribute.CanOfferFromLog and contribute:CanOfferFromLog() then
                playButton:Hide()
                report:Hide()
                local title = self:GetQuestTitle(questID)
                contributeButton:SetScript("OnClick", function()
                    contribute:ShowFromLog(questID, title)
                end)
                contributeButton:SetScript("OnEnter", function(button)
                    contribute:ShowTooltip(button)
                end)
                if contribute.OfferLogMenu then contribute:OfferLogMenu(contributeButton) end
                contributeButton:Show()
            else
                playButton:Disable()
                playButton:Show()
                report:Hide()
            end
            -- Play in Report's corner while Report is hidden, rather than beside an empty space.
            playButton:ClearAllPoints()
            if report:IsShown() then
                playButton:SetPoint("RIGHT", report, "LEFT", -4, 0)
            else
                playButton:SetPoint("RIGHT", report, "RIGHT", 0, 0)
            end
            self:SetPlayButtonState(playButton)
        end

        hooksecurefunc("QuestMapFrame_ShowQuestDetails", function()
            QuestOverlayUI:UpdateDetailsPlayButton()
        end)
    end

end
