if not SpokenGossipEnv then return end
setfenv(1, SpokenGossipEnv)

-- The Listen/Stop button on the greeting and gossip windows, while NPC Greetings is at Never and
-- nothing reads itself. The button itself is the dialogue core's (PlayButton.lua); this says
-- which windows are this addon's and when it wants the button.
PlayButton = DialoguePlayButton:New({
    panels = {
        QUEST_GREETING = "QuestFrameGreetingPanel",
        GOSSIP_SHOW = "GossipFrame",
    },
    frames = { "QuestFrame", "GossipFrame" },
    frameFor = function(event) return event == "GOSSIP_SHOW" and "GossipFrame" or "QuestFrame" end,
    wanted = function() return Addon:IsPartOn() and Addon:IsNever() end,
    line = function() return Addon:GetVisibleLine() end,
    queued = function() return Player:Queued() end,
    remove = function(clip) Player:Remove(clip) end,
    read = function() Addon:ReadVisible("dialog Play button") end,
    offTip = L.OPT_NEVER_TIP,
    later = function(fn, seconds) Addon:ScheduleTimer(fn, seconds) end,
})
