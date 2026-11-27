setfenv(1, SpokenEnv)

-- A chat line inviting English-voice players to rate upcoming voices on the site, at every load
-- until Hide Voice Feedback Invitation is on, and again on /sp feedback.
--
-- The link is an "addon:" hyperlink: on Forever, Classic Era and TBC Anniversary alike the
-- client's SetItemRef hands that type to EventRegistry's "SetItemRef" event and stops there.
-- Any other made-up type falls through to the item tooltip.

Feedback = {
    PATH = "/listen",
    -- Seconds after entering the world: the login burst of addon messages would bury it.
    DELAY = 10,
}
Spoken.Feedback = Feedback

local LINK = "addon:Spoken:feedback"

local function URL()
    return Spoken.SITE_URL .. Feedback.PATH
end

-- The tag other addons' announcements wear: gold brackets around the name and icon.
local TAG = "|cffffff00[|r|cffffd100Spoken|r |TInterface\\AddOns\\Spoken\\icon.tga:0:0:0:0|t|cffffff00]|r "
local TEXT, LINK_COLOR = "|cffa0a0ff", "|cff66bbff"

function Feedback:Message()
    local shown = URL():gsub("^https?://", "")
    local link = format("%s|H%s|h[%s]|h|r%s", LINK_COLOR, LINK, shown, TEXT)
    return TAG .. TEXT .. format(L.FEEDBACK_INVITE_FMT, link) .. "|r"
end

function Feedback:Print()
    DEFAULT_CHAT_FRAME:AddMessage(self:Message())
end

-- With no list of voices yet, the voice language decides what plays first.
function Feedback:HearsEnglish()
    local order = Spoken:GetVoiceOrder()
    local first = order and order[1] or Spoken:VoiceLanguage()
    return (Languages:SplitVoice(first)) == "enUS"
end

function Feedback:Announce()
    if not Addon.db or Addon.db.profile.Contribute.HideFeedback or not self:HearsEnglish() then return end
    self:Print()
end

function Feedback:Open()
    Spoken:ShowContribution(URL(), nil, true)
end

if EventRegistry and EventRegistry.RegisterCallback then
    EventRegistry:RegisterCallback("SetItemRef", function(_, link)
        if link == LINK then Feedback:Open() end
    end, Feedback)
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:SetScript("OnEvent", function()
    events:UnregisterEvent("PLAYER_ENTERING_WORLD")
    C_Timer.After(Feedback.DELAY, function() Feedback:Announce() end)
end)
