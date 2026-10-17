setfenv(1, VoiceOver)

--- @type table<number, boolean>
local questsPlayed = {}

--- @param questID number
--- @param origin string
local function TryPlayQuest(questID, origin)
    if Addon.db.profile.Audio.QuestingAutoplay ~= true or questsPlayed[questID] then
        return
    end

    local questLogIdx = C_QuestLog.GetLogIndexForQuestID(questID)
    if questLogIdx == nil then return end

    local info = C_QuestLog.GetInfo(questLogIdx)
    if info == nil then return end

    local type, id = DataModules:GetQuestLogQuestGiverTypeAndID(questID)
    if type == nil or id == nil then return end

    local queued = Player:PlayNow({
        event = Enums.SoundEvent.QuestAccept,
        questID = questID,
        name = id and DataModules:GetObjectName(type, id) or "Unknown Name",
        title = info.title,
        unitGUID = id and Enums.GUID:CanHaveID(type) and Utils:MakeGUID(type, id) or nil,
        origin = "QuestingTriggers for event " .. origin,
    })

    if queued then
        questsPlayed[questID] = true
    end
end

local questEventFrame = CreateFrame("Frame")
questEventFrame:RegisterEvent("PLAYER_INSIDE_QUEST_BLOB_STATE_CHANGED")
questEventFrame:RegisterEvent("QUEST_WATCH_UPDATE")
questEventFrame:SetScript("OnEvent", function(_, event, ...)
    if event == "PLAYER_INSIDE_QUEST_BLOB_STATE_CHANGED" then
        local questID, isInside = ...
        if isInside then
            TryPlayQuest(questID, event)
        end
    elseif event == "QUEST_WATCH_UPDATE" then
        local questID = ...
        TryPlayQuest(questID, event)
    end
end)
