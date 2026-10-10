setfenv(1, VoiceOver)

--- The Report button and the copy box behind it.
---
--- The game cannot open a URL or send anything anywhere, so the only way a player can report a
--- bad line is to copy an address and open it themselves. Everything here serves that: the
--- button builds an address, the popup makes it selectable.
---
--- The address is built from what the client can see - a quest id and an event, or a unit GUID
--- - and never from soundData. When the data module fails to load there is no soundData at
--- all, and a quest that plays nothing is the report most worth having.

local SITE_URL = "https://voiceover.rusty.one"

-- Where a report on another language's line goes. The old host redirects /r/ to the English
-- page and nothing else, and its links must keep working as they are, so a language's report
-- goes straight to the merged site, whose /{lang}/ prefix files it with that language's lines.
local LANGUAGE_REPORT_URL = "https://spoken.rusty.one/%s/quests/r/%s"

local COPY_DIALOG = "VOICEOVER_COPY_REPORT_LINK"

ReportButton =
{
    ---@type Button[]
}

-- A copy of VoiceOver.lua's helper of the same name, which is a local there and so not
-- reachable from this file. IsVisible is absent on the oldest clients, where IsShown is the
-- closest equivalent.
local function IsFrameVisible(frame)
    if not frame then
        return false
    elseif frame.IsVisible then
        return frame:IsVisible()
    end
    return frame:IsShown()
end

local PAGE_EVENTS =
{
    QUEST_DETAIL = Enums.SoundEvent.QuestAccept,
    QUEST_PROGRESS = Enums.SoundEvent.QuestProgress,
    QUEST_COMPLETE = Enums.SoundEvent.QuestComplete,
}

local EVENT_PATHS =
{
    [Enums.SoundEvent.QuestAccept] = "accept",
    [Enums.SoundEvent.QuestProgress] = "progress",
    [Enums.SoundEvent.QuestComplete] = "complete",
}

function ReportButton:TargetForQuest(questID, event)
    local path = EVENT_PATHS[event]
    if not path or not questID or questID == 0 then
        return nil
    end
    return format("quest/%d/%s", questID, path)
end

--- The creature behind a GUID, or nil when this client cannot tell us.
---
--- Guarded twice over: Utils:GetIDFromGUID is absent on 1.12 and asserts on a GUID carrying no
--- id, and an error thrown here would land on a player who only wanted to complain about audio.
function ReportButton:TargetForGUID(guid)
    if not guid or not Utils.GetGUIDType or not Utils.GetIDFromGUID then
        return nil
    end

    local readType, guidType = pcall(Utils.GetGUIDType, Utils, guid)
    if not readType or not guidType or not Enums.GUID:CanHaveID(guidType) then
        return nil
    end

    local readID, id = pcall(Utils.GetIDFromGUID, Utils, guid)
    if not readID or not id then
        return nil
    end
    return format("npc/%d", id)
end

--- The line a clip is, from what the clip carries: its quest and event, or the NPC who said
--- it. Unlike CurrentTarget this needs no window open -- the subtitle and the windows keep
--- playing, and offering Report, after the quest frame has closed.
function ReportButton:TargetForClip(clip)
    if not clip then return nil end
    return self:TargetForQuest(clip.questID, clip.event) or self:TargetForGUID(clip.unitGUID)
end

--- What the player is looking at, preferring the quest they can see over the NPC showing it.
function ReportButton:CurrentTarget()
    local event
    if IsFrameVisible(QuestFrameRewardPanel) then
        event = Enums.SoundEvent.QuestComplete
    elseif IsFrameVisible(QuestFrameProgressPanel) then
        event = Enums.SoundEvent.QuestProgress
    elseif IsFrameVisible(QuestFrameDetailPanel) then
        event = Enums.SoundEvent.QuestAccept
    else
        local page = Utils:DialogueUIPage()
        event = page and PAGE_EVENTS[page]
    end

    local target = event and self:TargetForQuest(GetQuestID and GetQuestID(), event)
    if target then
        return target
    end

    -- Gossip, or a client reporting quest id 0: fall back to the NPC, which the landing page
    -- can list every line for.
    return self:TargetForGUID(Utils:GetNPCGUID())
end

-- The address the popup is currently showing. Held here rather than passed to
-- StaticPopup_Show, whose `data` argument and the dialog/data handler signature both postdate
-- the legacy clients: there the popup would open with an empty box.
local shownLink

--- The report address for `target`, filed under `language` -- the language of the clip being
--- reported, which is not necessarily the client's. English keeps the address it always had.
---@param target string
---@param language? string
---@return string url
function ReportButton:Link(target, language)
    if language and language ~= Language.BASE then
        return format(LANGUAGE_REPORT_URL, language, target)
    end
    return format("%s/r/%s", SITE_URL, target)
end

--- DialogueUI hides UIParent and the game's popups with it, so under its window the address
--- goes to Spoken's copy box, which shows over that window.
local function ShowCopy(url)
    if Utils:DialogueUIPage() and Spoken and Spoken.ShowContribution then
        Spoken:ShowContribution(url, nil, true)
        return
    end
    shownLink = url
    StaticPopup_Show(COPY_DIALOG)
end

function ReportButton:ShowLink(target, language)
    ShowCopy(self:Link(target, language))
end

--- The same popup, for an address that is not a report: the settings panel offers one per
--- sound pack, since the game cannot open a link and a player has to copy it out.
function ReportButton:ShowAddress(url)
    ShowCopy(url)
end

function ReportButton:Initialize()
    -- A genuinely read-only edit box cannot be mouse-selected, so the text is restored on any
    -- keystroke instead. Making the player select the text first is the difference between a
    -- link people use and a link people read.
    StaticPopupDialogs[COPY_DIALOG] =
    {
        text = L.OPT_REPORT_COPY,
        button1 = OKAY,
        timeout = 0,
        whileDead = 1,
        hasEditBox = true,
        editBoxWidth = 260,
        -- `dialog or this`, here and below: before 3.x a StaticPopup handler is called with no
        -- arguments at all and the frame arrives as the global `this`.
        OnShow = function(dialog)
            dialog = dialog or this
            local editBox = dialog and (dialog.editBox or _G[dialog:GetName() .. "EditBox"])
            if not editBox then
                return
            end
            -- editBoxWidth is read by newer StaticPopup code only, so set it here as well.
            editBox:SetWidth(260)
            editBox.voiceoverLink = shownLink
            editBox:SetText(shownLink or "")
            editBox:SetFocus()
            editBox:HighlightText()
        end,
        EditBoxOnTextChanged = function(editBox)
            editBox = editBox or this
            if editBox.voiceoverLink and editBox:GetText() ~= editBox.voiceoverLink then
                editBox:SetText(editBox.voiceoverLink)
                editBox:HighlightText()
            end
        end,
        EditBoxOnEscapePressed = function(editBox)
            editBox = editBox or this
            editBox:GetParent():Hide()
        end,
    }

    -- The button itself is created on demand by Player.lua as an action on the Spoken
    -- player's frame, which is present for gossip, for progress and completion text, and
    -- while audio is playing -- which is when the complaint occurs to someone.
end
