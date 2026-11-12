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
local link = "https://spoken.quest/contribute#e1=abc"
Expect("a link is shown", Spoken:ShowContribution(link, "https://x", true), true)
Expect("the box holds the link itself", box.editBox:GetText(), link)
Expect("...with the link-specific hint", box.hint:GetText(), "Copy this and open it in your browser:")
-- A link on one line, as a pack's address is, gets a box no taller than the line: the full
-- height is for an envelope or a report link, which wrap.
local short = box.frame:GetHeight()
Expect("a link that fits on one line gets a short box", short < 120, true)
local long = "https://spoken.quest/contribute#e1=" .. string.rep("a", 120)
Spoken:ShowContribution(long, nil, true)
Expect("a link that wraps gets the full box", box.frame:GetHeight() > short, true)
Spoken:ShowContribution(envelope, "https://x")
Expect("...as an envelope does", box.frame:GetHeight() > short, true)
Spoken:ShowContribution(link, "https://x", true)
Expect("...and no redundant address line, since the link already carries it", box.address:GetText(), "")

------------------------------------------------------------------------------- a report
local report = "https://spoken.quest/quests/r/quest/5/accept"
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

local readable = Spoken.Contribute:Envelope("readables",
    { { "book", "Runa codificada" }, { "item", "9550" }, { "number", "1" } }, "A note.")
Spoken.Gather:Add("b:9550", readable)
Spoken:RefreshGatheredText()
Expect("the collected window labels a readable's item source", gathered.view.text:GetText():match("Item ID: 9550") ~= nil, true)

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

------------------------------------------------------------------------------- under the controller UI
-- The controller moves only between windows the frame controls manager knows of. Unregistered,
-- the box opened over the settings and the d-pad and B went on driving the settings under it.
box.frame:Hide()
-- The stub fires OnShow hooks but not OnHide ones; the client fires both.
local stubHide = box.frame.Hide
function box.frame:Hide()
    local was = self:IsShown()
    stubHide(self)
    if was then for _, fn in ipairs(self.hooks.OnHide or {}) do fn(self) end end
end
local calls = {}
local restricted = false
_G.InputUtil = { IsGamepadUIEnabled = function() return true end }
_G.GamepadMode = { FrameControlsManager = {
    HandlePopupShown = function(_, frame) table.insert(calls, { "shown", frame }) end,
    HandlePopupHide = function(_, frame) table.insert(calls, { "hide", frame }) end,
} }
_G.Enum = _G.Enum or {}
_G.Enum.AddOnRestrictionType = { Combat = 1 }
_G.C_RestrictedActions = { IsAddOnRestrictionActive = function() return restricted end }

Spoken:ShowContribution(link, "https://x", true)
Expect("the box takes the controller's focus as a popup", calls[1] and calls[1][1], "shown")
Expect("...for itself", calls[1] and calls[1][2], box.frame)
Expect("B has a close button to press", type(box.frame.CloseButton), "table")
box.frame.CloseButton:GetScript("OnClick")(box.frame.CloseButton)
Expect("closing hands the focus back", calls[2] and calls[2][1], "hide")
Expect("...from the box", calls[2] and calls[2][2], box.frame)

calls = {}
restricted = true
Spoken:ShowContribution(link, "https://x", true)
box.frame:Hide()
Expect("in combat the manager is left alone, as it refuses addons then", #calls, 0)
restricted = false

_G.InputUtil.IsGamepadUIEnabled = function() return false end
Spoken:ShowContribution(link, "https://x", true)
box.frame:Hide()
Expect("without the controller UI it is not registered at all", #calls, 0)
_G.InputUtil, _G.GamepadMode, _G.C_RestrictedActions = nil, nil, nil

os.exit(Failures() == 0 and 0 or 1)
