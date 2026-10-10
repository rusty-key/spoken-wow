setfenv(1, VoiceOver)

-- How an NPC's line shows on the Spoken player, for every module that reads NPCs: the speaker's
-- face, and the Report action. Each module adds what is its own (Stop Gossip, the bullets).
local L = SpokenEnv.L

Present = {}

local BOOK = [[Interface\AddOns\Spoken\Textures\Book]]
-- A line from something faceless shows the item that starts the quest, else a posted notice.
local NOTICE = [[Interface\Icons\INV_Misc_Note_01]]
local ICON_CROP = { 0.08, 0.92, 0.08, 0.92 }
local ERROR_DIALOG = "SPOKEN_DIALOGUE_ERROR"

-- The creature to draw, or nil for the book. The book for Items, GameObjects, players,
-- a missing GUID, and 2.4.3, which cannot show an arbitrary creature -- what
-- ShouldShowBookFor used to decide inside the frame, decided here instead and handed
-- over as a fallback.
local function CreatureFor(soundData)
    if soundData.unitIsObjectOrItem or Version.IsLegacyBurningCrusade then
        return nil
    end
    local guid = soundData.unitGUID
    if guid and Utils.GetGUIDType and Utils.GetIDFromGUID then
        return Utils:GetCreatureIDFromGUID(guid)
    end
    -- 1.12 has no GUIDs; the pooled model shows the "npc" unit and this is only what
    -- tells one clip's portrait from the next.
    if Version.IsLegacyVanilla then
        return soundData.questID or soundData.name
    end
    return nil
end

local function Faceless(soundData)
    local icon, crop
    if Spoken and Spoken.QuestItemIcon then icon, crop = Spoken:QuestItemIcon(soundData.questID) end
    return { kind = "texture", texture = icon or NOTICE, texCoord = crop or ICON_CROP }
end

--- The portrait for a line: the speaker's model, or the book where none can be drawn.
function Present:Portrait(soundData)
    if soundData.unitIsObjectOrItem then return Faceless(soundData) end
    return {
        kind = "model",
        creatureID = CreatureFor(soundData),
        animation = 60,
        fallback = { kind = "texture", texture = BOOK },
    }
end

Present.REPORT = {
    id = "report",
    -- An icon in the corner rather than a word beside the line: the label never changed,
    -- and the strip it used to sit in pushed the queue up to make room for it. The bug
    -- icon postdates the three legacy clients, where the texture is missing and
    -- the button would be a blank square; `text` is what they draw instead.
    icon = [[Interface\HelpFrame\HelpIcon-Bug]],
    label = L.DIALOGUE_REPORT_PROBLEM,
    text = "R",
    anchor = "topright",
    tooltip = function(tooltip)
        tooltip:SetText(L.DIALOGUE_REPORT_PROBLEM)
        tooltip:AddLine(L.DIALOGUE_REPORT_LINE_TIP, 1, 0.8, 0.2, true)
    end,
    onClick = function(clip)
        -- The line itself first: by the time Report is clicked the NPC's window may be shut.
        local target = ReportButton:TargetForClip(clip) or ReportButton:CurrentTarget()
        if target then
            -- The language the clip was spoken in, which PrepareSound recorded: a fallback line
            -- is an English take even under a German selection, and its report is about that.
            ReportButton:ShowLink(target, clip.language)
        else
            StaticPopup_Show(ERROR_DIALOG, L.DIALOGUE_REPORT_NO_LINE)
        end
    end,
}

--- Once, by whichever module sets up first: the Report action's dialogs, and its switch in
--- Spoken's settings.
function Present:Setup()
    if self.ready then
        return
    end
    self.ready = true
    StaticPopupDialogs[ERROR_DIALOG] =
    {
        text = "Spoken|n|n%s",
        button1 = OKAY,
        timeout = 0,
        whileDead = 1,
    }
    -- Guarded because a failure to build a dialog must not stop playback initializing.
    local ready, err = pcall(ReportButton.Initialize, ReportButton)
    if not ready then
        Debug:Record("report-button-error", tostring(err))
    end
    -- Switchable from the player's settings. The zones addon declares the same id, so one
    -- setting covers whichever is speaking.
    if Spoken and Spoken.RegisterOptionalAction then
        Spoken:RegisterOptionalAction("report", L.DIALOGUE_REPORT)
    end
end
