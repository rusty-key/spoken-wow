-- The frame a contribution is copied out of. Run with `make test-player`.
--
-- A StaticPopup edit box cannot hold this: hasEditBox is one line sized for a character name,
-- and an envelope is a few kilobytes over many lines.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("16001")
local env = stub.LoadSpoken(SPOKEN)
local Spoken = env.Spoken

local envelope = Spoken.Contribute:Envelope("quests", { { "quest", "9123" } }, "Words.")

Expect("a nil envelope shows nothing", Spoken:ShowContribution(nil, "https://x"), false)
Expect("an envelope is shown", Spoken:ShowContribution(envelope, "https://x"), true)

local box = Spoken.ContributeBox
Expect("the box holds the whole envelope", box.editBox:GetText(), envelope)
Expect("...with no byte limit", box.editBox:GetMaxBytes(), 0)
Expect("...selected, so Ctrl+C is the only keystroke", box.editBox.highlighted, true)
Expect("...and focused the first time it opens, or Ctrl+C goes to the game", box.editBox:HasFocus(), true)
Expect("...and is multi-line", box.editBox.multiLine, true)
Expect("the address is shown beside it", box.address:GetText(), "https://x")
Expect("the hint describes pasting, in the fallback case", box.hint:GetText(), "Press Ctrl+C, then paste it at:")

-- Typing into it would destroy the payload before the player copied it.
box.editBox:SetText("nonsense")
box.editBox.handlers.OnTextChanged(box.editBox)
Expect("a keystroke restores the envelope", box.editBox:GetText(), envelope)

------------------------------------------------------------------------------- the link case
local link = "https://spoken.rusty.one/contribute#e1=abc"
Expect("a link is shown", Spoken:ShowContribution(link, "https://x", true), true)
Expect("the box holds the link itself", box.editBox:GetText(), link)
Expect("...with the link-specific hint", box.hint:GetText(), "Copy this and open it in your browser:")
Expect("...and no redundant address line, since the link already carries it", box.address:GetText(), "")

------------------------------------------------------------------------------- a report
local report = "https://spoken.rusty.one/quests/r/quest/5/accept"
Expect("a report is shown", Spoken:ShowReport(report, function() return envelope end), true)
local address, carried = H.SplitReportLink(box.editBox:GetText())
Expect("...at its own address", address, report)
Expect("...carrying the context in its fragment", carried, envelope)
Spoken:ShowReport(report, function() error("broken") end)
Expect("a context that errors leaves the bare address", box.editBox:GetText(), report)
Spoken:ShowReport(report, function() return nil end)
Expect("...as does no context at all", box.editBox:GetText(), report)

------------------------------------------------------------------------------- collected text
Spoken.Gather:SetEnabled(true)
Spoken.Gather:Add("q:9123:accept", envelope)
local gathered = Spoken:ShowGatheredText()
Expect("the collected-lines button opens a separate window", gathered and gathered.frame:IsShown(), true)
Expect("the collected window has a scrollbar", gathered and gathered.view.bar ~= nil, true)
Expect("the collected window formats the source and field",
    gathered.view.text:GetText():match("1%. Quests\nQuest: 9123") ~= nil, true)
Expect("...and shows the gathered text instead of the raw envelope",
    gathered.view.text:GetText():match("Text:\nWords%.") ~= nil
        and gathered.view.text:GetText():find("!SPOKEN", 1, true) == nil, true)

Spoken.Gather:Clear()
Spoken:RefreshGatheredText()
Expect("clearing the lines empties the open window", gathered.view.text:GetText(), env.L.GATHER_NONE)

for i = 1, 205 do
    Spoken.Gather:Add("q:" .. i, Spoken.Contribute:Envelope("quests", { { "quest", tostring(i) } }, "Line " .. i .. "."))
end
Spoken:ShowGatheredText()
local shown = gathered.view.text:GetText()
Expect("a long store shows only the newest lines", shown:find("Quest: 5\n", 1, true) == nil
    and shown:find("Quest: 6\n", 1, true) ~= nil and shown:find("Quest: 205\n", 1, true) ~= nil, true)
Expect("...and says how many older ones it left out", shown:match("^5 older") ~= nil, true)
Spoken.Gather:Clear()
Spoken.Gather:SetEnabled(false)
gathered.frame:Hide()

------------------------------------------------------------------------------- over a host
-- A dialog window that hides UIParent (DialogueUI's) would hide the box with it, so a feature
-- addon puts it over that window while it is open.
local host = stub.Widget("Frame")
host.GetEffectiveScale = function() return 0.5 end
Spoken:SetContributeHost(host)
Expect("the box sits on the host", box.frame:GetParent(), host)
Expect("...the same size on screen", box.frame:GetScale(), 2)
Spoken:SetContributeHost(nil)
Expect("nil puts it back on UIParent", box.frame:GetParent(), _G.UIParent)
Expect("...at its own size", box.frame:GetScale(), 1)

os.exit(Failures() == 0 and 0 or 1)
