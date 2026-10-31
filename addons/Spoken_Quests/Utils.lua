setfenv(1, VoiceOver)
Utils = {}

--- Returns `Enum.GUID` type of the provided GUID.
---@param guid string GUID returned by the API
---@return GUID guid
function Utils:GetGUIDType(guid)
    return guid and Enums.GUID[select(1, strsplit("-", guid, 2))]
end

--- Returns WorldObject ID of the provided GUID.
---
--- Only supported for GUID types that can contain the ID, checkable via `Enums.GUID:CanHaveID(type)`.
---@param guid string GUID returned by the API
---@return number id
function Utils:GetIDFromGUID(guid)
    local type, rest = strsplit("-", guid, 2)
    type = assert(Enums.GUID[type], format("Unknown GUID type %s", type))
    assert(Enums.GUID:CanHaveID(type), format([[GUID "%s" does not contain ID]], guid))
    return assert(tonumber((select(5, strsplit("-", rest)))), format([[Failed to retrieve ID from GUID "%s"]], guid))
end

--- Returns the creature ID a GUID names, or nil for any other object or a GUID the helpers
--- above reject. Guarded with pcall because those helpers assert, and the callers run on chat
--- and playback events.
function Utils:GetCreatureIDFromGUID(guid)
    guid = NotSecret(guid)
    if type(guid) ~= "string" or guid == "" then
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
---@param type GUID
---@param id number
---@return string guid
function Utils:MakeGUID(type, id)
    assert(Enums.GUID:CanHaveID(type), format("GUID of type %d (%s) cannot contain ID", type, Enums.GUID:GetName(type) or "Unknown"))
    local typeName = assert(Enums.GUID:GetName(type), format("Unknown GUID type %d", type))
    return format("%s-%d-%d-%d-%d-%d-%d", typeName, 0, 0, 0, 0, id, 0)
end

--- Returns the name of the NPC that's being interacted with while a GossipFrame or QuestFrame is visible.
---
--- Uses "questnpc" unitID when available, falls back to "npc" unitID.
---@return string|nil name
function Utils:GetNPCName()
    return NotSecret(UnitName("questnpc")) or NotSecret(UnitName("npc"))
end

--- Returns the GUID of the NPC that's being interacted with while a GossipFrame or QuestFrame is visible.
---
--- Uses "questnpc" unitID when available, falls back to "npc" unitID.
---@return string|nil guid
function Utils:GetNPCGUID()
    return NotSecret(UnitGUID("questnpc")) or NotSecret(UnitGUID("npc"))
end

local SEX_UNITS = { "questnpc", "npc", "target", "mouseover" }

--- The sex (UnitSex: 2 male, 3 female) the unit a GUID names is drawn as, where a unit token
--- on screen still points at it: the one being talked to, the target, the mouseover, or its
--- nameplate, which is how a creature shouting as it aggroes is usually seen.
---@param unitGUID string|nil
---@return number|nil sex
function Utils:GetSexForGUID(unitGUID)
    if not unitGUID or not UnitSex then
        return
    end
    local token = UnitTokenFromGUID and NotSecret(UnitTokenFromGUID(unitGUID))
    local sex = token and NotSecret(UnitSex(token))
    if sex then
        return sex
    end
    for _, unit in ipairs(SEX_UNITS) do
        if NotSecret(UnitGUID(unit)) == unitGUID then
            return NotSecret(UnitSex(unit))
        end
    end
end

local SPEAKER_UNITS = { "target", "mouseover", "softenemy", "softinteract" }
for i = 1, 40 do
    table.insert(SPEAKER_UNITS, "nameplate" .. i)
end

-- One more unit into a group: its first GUID, the sex they share, and whether they do not (an
-- unreadable sex counts as not).
local function Fold(first, sex, mixed, guid, unitSex)
    if not first then
        return guid, unitSex, unitSex == nil
    end
    return first, sex, mixed or unitSex ~= sex
end

--- A live unit on screen of creature `npcID`, for NPC chat that comes without the speaker's GUID
--- (Forever, Classic Era). Those attacking the player are judged first, since they are who shouts on
--- aggro. A group of mixed sex names nobody: the sex is what the GUID is wanted for.
---@param npcID number
---@return string|nil guid
function Utils:GetSpeakerGUID(npcID)
    local first, sex, mixed, attacker, attackerSex, attackersMixed
    for _, unit in ipairs(SPEAKER_UNITS) do
        local guid = NotSecret(UnitGUID(unit))
        if guid and self:GetCreatureIDFromGUID(guid) == npcID and not UnitIsDead(unit) then
            local unitSex = NotSecret(UnitSex(unit))
            if UnitIsUnit(unit .. "target", "player") then
                attacker, attackerSex, attackersMixed = Fold(attacker, attackerSex, attackersMixed, guid, unitSex)
            else
                first, sex, mixed = Fold(first, sex, mixed, guid, unitSex)
            end
        end
    end
    if attacker then
        return not attackersMixed and attacker or nil
    end
    return not mixed and first or nil
end

--- The body (race and sex) a GUID's creature is drawn as, read from its model: nil until the
--- model has loaded (NPCModel), or where no installed pack names that model. NPCModel and
--- DataModules load after this file, so both are reached at call time.
---@param unitGUID string|nil
---@return string|nil body
function Utils:GetBodyForGUID(unitGUID)
    local model = unitGUID and NPCModel and NPCModel:Get(unitGUID)
    if not model or not DataModules then
        return
    end
    for _, module in DataModules:GetModules() do
        local body = module.BodyByModelFileID and module.BodyByModelFileID[model]
        if body then
            return body
        end
    end
end

--- Returns whether the NPC that's being interacted with while a GossipFrame or QuestFrame is visible is a GameObject or Item.
---
--- Uses "questnpc" unitID when available, falls back to "npc" unitID.
---@return boolean isObjectOrItem
function Utils:IsNPCObjectOrItem()
    return not (UnitExists("questnpc") or UnitExists("npc"))
end

--- Returns whether the NPC that's being interacted with while a GossipFrame or QuestFrame is visible is a Player.
---
--- Uses "questnpc" unitID when available, falls back to "npc" unitID.
---@return boolean isPlayer
function Utils:IsNPCPlayer()
    return UnitIsPlayer("questnpc") or UnitIsPlayer("npc")
end

--- Returns the button index offset of the virtualized Quest Log scroll frame.
---@return number offset
function Utils:GetQuestLogScrollOffset()
    return FauxScrollFrame_GetOffset(QuestLogListScrollFrame)
end

--- Returns the `Button` that represents the quest in the Quest Log frame.
---@return Button button
function Utils:GetQuestLogTitleFrame(index)
    return _G["QuestLogTitle" .. index]
end

--- Returns the title `FontString` of the button that represents the quest in the Quest Log frame.
---@return FontString title
function Utils:GetQuestLogTitleNormalText(index)
    return _G["QuestLogTitle" .. index .. "NormalText"]
end

--- Returns the quest tracking check mark `Texture` of the button that represents the quest in the Quest Log frame.
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

--- A line's text with the server's tokens filled in for the local player: name, race, class,
--- the $g branch for the player's sex, and $B as a line break. $c and $r are the class and race
--- in lower case, as the client writes them ("young $c" is "young hunter"), save in German,
--- whose nouns keep their capital.
---@param text string
---@return string
function Utils:FillPlayerTokens(text)
    local name = UnitName and UnitName("player") or ""
    local class = UnitClass and UnitClass("player") or ""
    local race = UnitRace and UnitRace("player") or ""
    local female = UnitSex and UnitSex("player") == 3
    local lowerCase = not (GetLocale and GetLocale() == "deDE")
    local function Cased(word, token)
        return (lowerCase and (token == "c" or token == "r")) and string.lower(word) or word
    end
    -- $gmale:female; and $Gmale:female; - the export keeps Blizzard's spacing, "$GHe : She;".
    text = string.gsub(text, "%$[gG]([^:;]*):([^;]*);", function(male, femaleForm)
        return string.trim(female and femaleForm or male)
    end)
    -- Function replacements, so a % in a name is never read as a capture.
    text = string.gsub(text, "%$[bB]", "\n")
    text = string.gsub(text, "%$[nN]", function() return name end)
    text = string.gsub(text, "%$([cC])", function(token) return Cased(class, token) end)
    text = string.gsub(text, "%$([rR])", function(token) return Cased(race, token) end)
    return text
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
