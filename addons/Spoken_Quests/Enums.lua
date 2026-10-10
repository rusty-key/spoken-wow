setfenv(1, VoiceOver)
---@type table<string, Enum>
Enums = {}

---@enum SoundEvent
Enums.SoundEvent =
{
    QuestAccept = 1,
    QuestProgress = 2,
    QuestComplete = 3,
    QuestGreeting = 4,
    Gossip = 5,
    -- What an NPC says in chat after the player accepts or turns in a quest (Followup.lua).
    -- Neither a quest event nor gossip: it has no questID-keyed file and no dialog text.
    QuestFollowup = 6,
}
---@param event SoundEvent
---@return boolean isQuestEvent Is event related to a quest (`SoundData.questID` must be present)
function Enums.SoundEvent:IsQuestEvent(event)
    return event == self.QuestAccept or event == self.QuestProgress or event == self.QuestComplete
end
---@param event SoundEvent
---@return boolean isGossipEvent Is event related to a gossip (`SoundData.text` must be present)
function Enums.SoundEvent:IsGossipEvent(event)
    return event == self.Gossip or event == self.QuestGreeting
end

---@enum GossipFrequency
Enums.GossipFrequency =
{
    Always = 1,
    OncePerQuestNPC = 2,
    OncePerNPC = 3,
    Never = 4,
}

---@enum GUID
Enums.GUID =
{
    Player = 2,
    Item = 3,
    Creature = 8,
    Vehicle = 9,
    GameObject = 11,
}
---@param type GUID GUID type
---@return boolean isCreature GUID type is representing a server-controlled Creature
function Enums.GUID:IsCreature(type)
    return type == self.Creature or type == self.Vehicle
end
---@param type GUID GUID type
---@return boolean isCreature GUID string can contain WorldObject ID
function Enums.GUID:CanHaveID(type)
    return type == self.Creature or type == self.Vehicle or type == self.GameObject
end



---@class Enum
local Enum = {}
Enum.__index = Enum

---@param value number Enum element value
---@return string|nil name Enum element name
function Enum:GetName(value)
    for k, v in pairs(self) do
        if v == value then
            return k
        end
    end
end

for name, enum in pairs(Enums) do
    if type(enum) == "table" then
        local metatable
        for k, v in pairs(enum) do
            -- Move all functions from the enum to its metatable (which also "inherits" from Enum)
            if type(v) == "function" then
                if not metatable then
                    metatable = setmetatable({}, { __index = Enum })
                    metatable.__index = metatable
                end
                metatable[k] = v
                enum[k] = nil
            end
        end
        Enums[name] = setmetatable(enum, metatable or Enum)
    end
end
