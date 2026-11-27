-- The invitation to rate upcoming voices on the site: a chat line with a link to the copy box,
-- shown at every load to a player who hears English voices until the setting hides it, and
-- again on /sp feedback.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local URL = "https://spoken.quest/listen"

local function Clean(locale)
    stub.SetClient("16001"); stub.ResetTimers(); stub.ResetUIActions()
    stub.SetLocale(locale or "enUS")
    _G.SpokenSettings = nil
end

local function Login(before)
    stub.ResetUIActions()
    local env = stub.LoadSpoken(SPOKEN)
    -- The welcome window also opens at a first login, and the stub cannot draw it.
    env.Addon.db.global.Welcomed = true
    if before then before(env) end
    stub.FireEvent("PLAYER_ENTERING_WORLD", true, false)
    return env
end

local function Invitations()
    local found = {}
    for _, line in ipairs(stub.chat) do
        if line:find("spoken.quest/listen", 1, true) then table.insert(found, line) end
    end
    return found
end

-- The link as the chat frame hands it to SetItemRef on a click: what sits between |H and |h.
local function Click(line)
    local link, text = line:match("|H(.-)|h(.-)|h")
    _G.SetItemRef(link, text, "LeftButton", _G.DEFAULT_CHAT_FRAME)
end

------------------------------------------------------------------ English: after a wait
Clean()
local env = Login()
Expect("nothing is said while the world is still loading", #Invitations(), 0)
stub.Advance(env.Feedback.DELAY)
local said = Invitations()
Expect("a player hearing English is invited", #said, 1)
Expect("...with the address as a link", said[1] and said[1]:find("|Haddon:Spoken:feedback|h[spoken.quest/listen]|h", 1, true) ~= nil, true)
Expect("...tagged with Spoken's name, in gold, and icon", said[1] and said[1]:find("|cffffd100Spoken|r |TInterface\\AddOns\\Spoken\\icon.tga", 1, true) ~= nil, true)

Click(said[1])
local box = env.Spoken.ContributeBox
Expect("a click on the link opens the copy box", box and box.frame:IsShown(), true)
Expect("...holding the full address", box and box.editBox:GetText(), URL)
Expect("...selected for copying", box and box.editBox.highlighted, true)
Expect("...and the item tooltip is not asked to show it", #stub.itemRefShown, 0)

box.frame:Hide()
_G.SetItemRef("addon:OtherAddon:feedback", "[x]", "LeftButton", _G.DEFAULT_CHAT_FRAME)
Expect("another addon's link does not open it", box.frame:IsShown(), false)

------------------------------------------------------------------ every load, until hidden
stub.Logout()
env = Login()
stub.Advance(env.Feedback.DELAY)
Expect("the next load invites again", #Invitations(), 1)

env.Addon:Enable()
local hide
for _, entry in ipairs(_G.SpokenContributeOptionsPanel.layout.entries) do
    if entry.label == env.L.OPT_HIDE_FEEDBACK then hide = entry.frame end
end
Expect("Contribute & Report has Hide Voice Feedback Invitation", hide ~= nil, true)
Expect("...off by default", hide and hide:GetChecked(), false)
hide:SetChecked(true)
hide:GetScript("OnClick")(hide)
stub.Logout()
env = Login()
stub.Advance(env.Feedback.DELAY)
Expect("with it on, a load says nothing", #Invitations(), 0)
env.Addon:Enable()
_G.SlashCmdList.SPOKEN("feedback")
Expect("...but /sp feedback still does", #Invitations(), 1)

------------------------------------------------------------------ another voice language: never
Clean()
env = Login(function(e) e.Spoken:SetVoiceOrder({ "deDE", "enUS" }) end)
stub.Advance(env.Feedback.DELAY)
Expect("a player whose first voice is German is not invited", #Invitations(), 0)

Clean("deDE")
env = Login()
stub.Advance(env.Feedback.DELAY)
Expect("a German client with no list of voices hears German, and is not invited", #Invitations(), 0)

Clean("deDE")
env = Login(function(e) e.Spoken:SetVoiceOrder({ "enUS", "deDE" }) end)
stub.Advance(env.Feedback.DELAY)
Expect("a German client whose first voice is English is invited", #Invitations(), 1)

------------------------------------------------------------------ /sp feedback, in any language
Clean()
env = Login(function(e) e.Spoken:SetVoiceOrder({ "deDE" }) end)
env.Addon:Enable()
stub.Advance(env.Feedback.DELAY)
_G.SlashCmdList.SPOKEN("feedback")
said = Invitations()
Expect("/sp feedback says it, whatever the voice", #said, 1)
Click(said[1])
Expect("...and its link opens the copy box", env.Spoken.ContributeBox.editBox:GetText(), URL)

local help = {}
local quiet = _G.print
_G.print = function(text) table.insert(help, text) end
_G.SlashCmdList.SPOKEN("help")
_G.print = quiet
local listed = false
for _, line in ipairs(help) do
    if line:find("/sp feedback", 1, true) then listed = true end
end
Expect("/sp help lists it", listed, true)

os.exit(Failures() == 0 and 0 or 1)
