-- Saved settings from before the caption scroll modes: AutoScroll, a yes or no, became
-- ScrollMode. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

local function Load(transcript)
    _G.SpokenSettings = transcript and { profiles = { Default = { Transcript = transcript } } } or nil
    stub.ResetTimers()
    return stub.LoadSpoken(SPOKEN).Addon.db.profile.Transcript
end

local cfg = Load({ AutoScroll = false })
Expect("following turned off stays off", cfg.ScrollMode, "off")
Expect("...and the old setting goes", cfg.AutoScroll, nil)

cfg = Load({ AutoScroll = true })
Expect("following left on goes line by line", cfg.ScrollMode, "line")
Expect("...and the old setting goes", cfg.AutoScroll, nil)

cfg = Load({ AutoScroll = false, ScrollMode = "page" })
Expect("a mode already chosen is kept", cfg.ScrollMode, "page")

cfg = Load(nil)
Expect("a first install goes line by line", cfg.ScrollMode, "line")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll scroll mode upgrade tests passed")
