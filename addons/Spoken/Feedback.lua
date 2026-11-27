setfenv(1, SpokenEnv)

-- A chat line inviting English-voice players to rate upcoming voices on the site, once per
-- account per announcement, and again on /sp feedback.
--
-- The link is an "addon:" hyperlink: on Forever, Classic Era and TBC Anniversary alike the
-- client's SetItemRef hands that type to EventRegistry's "SetItemRef" event and stops there.
-- Any other made-up type falls through to the item tooltip.

Feedback = {
    -- Change it to show a new announcement once more to everyone who saw the last.
    ID = "listen-2026-11",
    PATH = "/listen",
    -- Seconds after entering the world: the login burst of addon messages would bury it.
    DELAY = 10,
}
Spoken.Feedback = Feedback

local LINK = "addon:Spoken:feedback"

local function URL()
    return Spoken.SITE_URL .. Feedback.PATH
end

function Feedback:Message()
    local shown = URL():gsub("^https?://", "")
    local link = format("|cff66bbff|H%s|h[%s]|h|r", LINK, shown)
    return "|cff66bbffSpoken:|r " .. format(L.FEEDBACK_INVITE_FMT, link)
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
    local global = Addon.db and Addon.db.global
    if not global then return end
    if type(global.Announcements) ~= "table" then global.Announcements = {} end
    if global.Announcements[self.ID] or not self:HearsEnglish() then return end
    global.Announcements[self.ID] = true
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
