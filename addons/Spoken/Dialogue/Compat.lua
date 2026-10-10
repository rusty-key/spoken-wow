setfenv(1, VoiceOver)

-- The client differences both dialogue modules need, quests and gossip: the addon list, the
-- gossip API, GUIDs, and the frames and scripts of the legacy clients. Private to the
-- dialogue core's environment, so other addons are not affected. What only the quests module
-- needs -- the quest log, a quest ID on clients without one -- stays in its Compatibility.lua.

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
