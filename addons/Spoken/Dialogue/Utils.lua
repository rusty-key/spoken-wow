setfenv(1, VoiceOver)
Utils = {}

--- Returns `Enum.GUID` type of the provided GUID.
--- - Removed in clients before 2.3 as those don't provide `UnitGUID(unitID)` function.
--- - Overridden for clients before 6.0 that use an older GUID format.
---@param guid string GUID returned by the API
---@return GUID guid
function Utils:GetGUIDType(guid)
    return guid and Enums.GUID[select(1, strsplit("-", guid, 2))]
end

--- Returns WorldObject ID of the provided GUID.
---
--- Only supported for GUID types that can contain the ID, checkable via `Enums.GUID:CanHaveID(type)`.
--- - Removed in clients before 2.3 as those don't provide `UnitGUID(unitID)` function.
--- - Overridden for clients before 6.0 that use an older GUID format.
---@param guid string GUID returned by the API
---@return number id
function Utils:GetIDFromGUID(guid)
    local type, rest = strsplit("-", guid, 2)
    type = assert(Enums.GUID[type], format("Unknown GUID type %s", type))
    assert(Enums.GUID:CanHaveID(type), format([[GUID "%s" does not contain ID]], guid))
    return assert(tonumber((select(5, strsplit("-", rest)))), format([[Failed to retrieve ID from GUID "%s"]], guid))
end

--- Returns the creature ID a GUID names, or nil for any other object, a GUID the helpers
--- above reject, or a client before 2.3 where Compatibility.lua removes them. Guarded with
--- pcall because those helpers assert, and the callers run on chat and playback events.
function Utils:GetCreatureIDFromGUID(guid)
    if type(guid) ~= "string" or guid == "" or not (self.GetGUIDType and self.GetIDFromGUID) then
        return nil
    end
    local okType, guidType = pcall(self.GetGUIDType, self, guid)
    if not (okType and guidType and Enums.GUID:IsCreature(guidType) and Enums.GUID:CanHaveID(guidType)) then
        return nil
    end
    local okID, id = pcall(self.GetIDFromGUID, self, guid)
    return okID and id or nil
end

--- Returns a dummy WorldObject GUID using the provided `Enums.GUID` type and ID.
--- - Returns nil in clients before 2.3 as those don't provide `UnitGUID(unitID)` function.
--- - Overridden for clients before 6.0 that use an older GUID format.
---@param type GUID
---@param id number
---@return string|nil guid
function Utils:MakeGUID(type, id)
    assert(Enums.GUID:CanHaveID(type), format("GUID of type %d (%s) cannot contain ID", type, Enums.GUID:GetName(type) or "Unknown"))
    local typeName = assert(Enums.GUID:GetName(type), format("Unknown GUID type %d", type))
    return format("%s-%d-%d-%d-%d-%d-%d", typeName, 0, 0, 0, 0, id, 0)
end

--- Returns the name of the NPC that's being interacted with while a GossipFrame or QuestFrame is visible.
---
--- Uses "questnpc" unitID when available, falls back to "npc" unitID.
--- - Overridden in 1.12 to only return "npc" as "questnpc" unitID is unavailable in 1.12 and causes an error.
---@return string|nil name
function Utils:GetNPCName()
    return UnitName("questnpc") or UnitName("npc")
end

--- Returns the GUID of the NPC that's being interacted with while a GossipFrame or QuestFrame is visible.
---
--- Uses "questnpc" unitID when available, falls back to "npc" unitID.
--- - Returns nil in 1.12 due to the lack of `UnitGUID(unitID)` function.
---@return string|nil guid
function Utils:GetNPCGUID()
    return UnitGUID("questnpc") or UnitGUID("npc")
end

--- Returns whether the NPC that's being interacted with while a GossipFrame or QuestFrame is visible is a GameObject or Item.
---
--- Uses "questnpc" unitID when available, falls back to "npc" unitID.
--- - Overridden in 1.12 to only return "npc" as "questnpc" unitID is unavailable in 1.12 and causes an error.
---@return boolean isObjectOrItem
function Utils:IsNPCObjectOrItem()
    return not (UnitExists("questnpc") or UnitExists("npc"))
end

--- Returns whether the NPC that's being interacted with while a GossipFrame or QuestFrame is visible is a Player.
---
--- Uses "questnpc" unitID when available, falls back to "npc" unitID.
--- - Overridden in 1.12 to only return "npc" as "questnpc" unitID is unavailable in 1.12 and causes an error.
---@return boolean isPlayer
function Utils:IsNPCPlayer()
    return UnitIsPlayer("questnpc") or UnitIsPlayer("npc")
end

--- Returns the button index offset of the virtualized Quest Log scroll frame.
--- - Overridden in 3.3.5 and 3.4 due to the different Quest Log layout that uses `HybridScrollFrame` instead of `FauxScrollFrame`.
---@return number offset
function Utils:GetQuestLogScrollOffset()
    return FauxScrollFrame_GetOffset(QuestLogListScrollFrame)
end

--- Returns the `Button` that represents the quest in the Quest Log frame.
--- - Overridden in 3.3.5 and 3.4 due to the different naming scheme used by the Quest Log.
---@return Button button
function Utils:GetQuestLogTitleFrame(index)
    return _G["QuestLogTitle" .. index]
end

--- Returns the title `FontString` of the button that represents the quest in the Quest Log frame.
--- - Overridden in 3.3.5 and 3.4 due to the different naming scheme used by the Quest Log.
---@return FontString title
function Utils:GetQuestLogTitleNormalText(index)
    return _G["QuestLogTitle" .. index .. "NormalText"]
end

--- Returns the quest tracking check mark `Texture` of the button that represents the quest in the Quest Log frame.
--- - Overridden in 3.3.5 and 3.4 due to the different naming scheme used by the Quest Log.
---@return Texture check
function Utils:GetQuestLogTitleCheck(index)
    return _G["QuestLogTitle" .. index .. "Check"]
end

--- A frame created with no parent and only then moved under `parent`.
---
--- The WoW Forever client's gamepad navigation hooks CreateFrame: when the new frame's parent
--- sits inside an open panel, such as the world map and its quest log, it rebuilds that panel's
--- button groups there and then, inside the caller's execution. Called from an addon, that
--- taints the groups, and the next gamepad close of the panel is blocked from HideUIPanel,
--- which shows the "blocked from an action" dialog, whose own buttons are blocked the same way,
--- over and over until the client hangs. SetParent is not hooked.
---@return Frame frame
function Utils:CreateDetachedFrame(frameType, name, parent, template)
    local frame = CreateFrame(frameType, name, nil, template)
    frame:SetParent(parent)
    return frame
end

--- Returns the provided text enclosed in the provided color tag.
---@param text string
---@param color string Color tag in "|cAARRGGBB" format
---@return string colorizedText
function Utils:ColorizeText(text, color)
    return color .. text .. "|r"
end

--- Returns an iterator to the table sorted with the provided function, or sorted by value if no function was provided.
---@generic K, V
---@param tbl table<K, V>
---@param sorter fun(valueA: V, valueB: V, keyA: K, keyB: K): boolean Should return whether A should precede B
---@return function iterator
---@return table tbl
---@return nil
function Utils:Ordered(tbl, sorter)
    local orderedIndex = {}
    for key in pairs(tbl) do
        table.insert(orderedIndex, key)
    end
    if sorter then
        table.sort(orderedIndex, function(a, b)
            return sorter(tbl[a], tbl[b], a, b)
        end)
    else
        table.sort(orderedIndex)
    end

    local i = 0
    local function orderedNext(t)
        i = i + 1
        return orderedIndex[i], t[orderedIndex[i]]
    end

    return orderedNext, tbl, nil
end

--- The page DialogueUI's window shows, as the dialog event it stands for, or nil while it is
--- closed or the bridge is not loaded.
---@return string?
function Utils:DialogueUIPage()
    local bridge = rawget(VoiceOver, "DialogueUIBridge")
    return bridge and bridge.Page and bridge:Page()
end

--- Whether a text colour is light: DialogueUI writes light on its dark theme, dark on parchment.
function Utils:IsBright(r, g, b)
    return (r or 1) * 0.299 + (g or 1) * 0.587 + (b or 1) * 0.114 >= 0.5
end

--- 1 on DialogueUI's parchment, 2 on its dark theme, told by the colour it gives its text,
--- asked each time: its theme can change while the game runs.
function Utils:DialogueUIThemeID()
    local font = _G.DUIFont_QuestType_Left
    if type(font) == "table" and font.GetTextColor and self:IsBright(font:GetTextColor()) then
        return 2
    end
    return 1
end
