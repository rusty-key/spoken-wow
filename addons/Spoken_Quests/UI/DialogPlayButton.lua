if not (VoiceOver and VoiceOver.SpokenDialogue) then return end
setfenv(1, VoiceOver)

-- The Listen/Stop button on the quest windows, for a player who turned autoplay off. The button
-- itself is the dialogue core's (PlayButton.lua); this says which windows are this addon's and
-- when it wants the button.
DialogPlayButton = DialoguePlayButton:New({
    -- The Blizzard panel each event is drawn on. VoiceOver.lua's GetVisibleQuestEvent also
    -- answers from the quest log or the last event when no panel is up, and there is no window to
    -- put a button on then.
    panels = {
        QUEST_DETAIL = "QuestFrameDetailPanel",
        QUEST_PROGRESS = "QuestFrameProgressPanel",
        QUEST_COMPLETE = "QuestFrameRewardPanel",
    },
    -- The greeting and gossip windows have the gossip module's own button (Spoken_Gossip).
    frames = { "QuestFrame" },
    frameFor = function() return "QuestFrame" end,
    wanted = function() return Addon:IsPartOn() and not Addon:IsAutoplayOn() end,
    line = function() return Addon:GetVisibleLine() end,
    queued = function() return Player:Queued() end,
    remove = function(clip) Player:Remove(clip) end,
    read = function() Addon:ReadVisibleQuest("dialog Play button") end,
    offTip = L.OPT_AUTOPLAY_OFF_TIP,
    later = function(fn, seconds) Addon:ScheduleTimer(fn, seconds) end,
})
