-- Saved SubtitlePlayer, HideFrame and MinimalPlayer switches upgrading to Frame.Style.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

-- A profile other than the one in use: the suites' loader sets the style of that one.
local function Load(frame)
    _G.SpokenSettings = { profiles = { Other = { Frame = frame } } }
    stub.ResetTimers()
    stub.LoadSpoken(SPOKEN)
    return _G.SpokenSettings.profiles.Other.Frame
end

local cfg = Load({ SubtitlePlayer = false, MinimalPlayer = false })
Expect("the large window chosen stays the large window", cfg.Style, "classic")
Expect("...and the old switches go", cfg.SubtitlePlayer == nil and cfg.HideFrame == nil
    and cfg.MinimalPlayer == nil, true)

cfg = Load({ SubtitlePlayer = false })
Expect("the small window, the old default window, stays the small one", cfg.Style, "minimal")

cfg = Load({ SubtitlePlayer = false, HideFrame = true, MinimalPlayer = false })
Expect("nothing on screen stays Voice Only", cfg.Style, "none")

cfg = Load({ MinimalPlayer = false })
Expect("subtitles, the old default, win over the window remembered under them", cfg.Style, "subtitle")

cfg = Load({ Style = "dialogueui", MinimalPlayer = false })
Expect("a style already chosen is kept", cfg.Style, "dialogueui")

cfg = Load({ FrameScale = 1 })
Expect("a profile that never chose a style is left on the default", cfg.Style, nil)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll style upgrade tests passed")
