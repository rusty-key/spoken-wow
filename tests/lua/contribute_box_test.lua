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

stub.SetClient("11509")
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
