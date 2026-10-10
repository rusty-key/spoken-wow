setfenv(1, VoiceOver)

-- The quests module's, when it loaded: read raw, as a global of that name from some other addon
-- is not it.
local ENV = getfenv(1)
Debug = {}

Debug.runtime = {
    stage = "addon-loaded",
    message = "Waiting for a quest or gossip event",
}

function Debug:Record(stage, message)
    self.runtime.stage = stage
    self.runtime.message = message
    self.runtime.time = GetTime and GetTime() or 0
    self:Print(message, stage)
end

function Debug:GetRuntimeStatus()
    return self.runtime.stage, self.runtime.message, self.runtime.time
end

function Debug:Print(msg, header)
    local addon = rawget(ENV, "Addon")
    if addon and addon.db and addon.db.profile.DebugEnabled then
        if header then
            print(Utils:ColorizeText("Spoken Quests", NORMAL_FONT_COLOR_CODE) ..
                Utils:ColorizeText(" (" .. header .. ")", GRAY_FONT_COLOR_CODE) ..
                " - " .. msg)
        else
            print(Utils:ColorizeText("Spoken Quests", NORMAL_FONT_COLOR_CODE) ..
                " - " .. msg)
        end
    end
end

--------------------------------------------------------------------------------
-- Spoken's debug log (the Spoken_Developer module, where it is installed)
--------------------------------------------------------------------------------
--
-- Every stage recorded above also goes to the log, as `quests <stage>: <message>`: the stages are
-- what /spq diagnostics calls the last runtime stage, and in the log they read as the whole story
-- of a quest window, from the event to the line queued or the reason it was not. Note covers the
-- decisions that record no stage. Nothing happens without the module, or while its log is off.
--
-- Parsed by the 1.12 client too, so Lua 5.0 syntax: no `#`, no `...`, no string methods.

local function Log(message, a, b, c, d)
    if Spoken and Spoken.Log then Spoken:Log("quests", message, a, b, c, d) end
end

-- The stages that name a quest window, the last of which the diagnostics repeat.
local WINDOW_STAGES = { ["quest-detail"] = true, ["quest-progress"] = true, ["quest-complete"] = true }

local recordStage = Debug.Record
function Debug:Record(stage, message)
    recordStage(self, stage, message)
    if WINDOW_STAGES[stage] then
        self.lastWindow = { message = message, time = GetTime and GetTime() or 0 }
    end
    Log("%s: %s", tostring(stage), tostring(message))
end

-- What each topic last said, so a decision asked about ten times a second (the quest watcher, a
-- window polling for its Play button) is written once, and again only when the answer changes.
local lastNoted = {}

--- One line in the log about `topic`, unless the last one about it had the same `key`.
function Debug:Note(topic, key, message, a, b, c)
    if lastNoted[topic] == key then return end
    lastNoted[topic] = key
    Log(message, a, b, c)
end
