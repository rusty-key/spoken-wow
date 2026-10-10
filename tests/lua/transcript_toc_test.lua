-- Captions are left out of the 1.12 client: UI/Transcript.lua uses the length operator and
-- string methods, which its Lua 5.0 cannot parse. So every .toc but 1.12's lists
-- Transcript.xml, 1.12's lists the stub 1.12\Transcript.lua instead, and addon.xml, which every
-- client loads, lists neither. The players call Transcript unconditionally, so the stub must
-- define every method called on it outside UI/Transcript.lua. Nothing else runs a 5.0 parser to
-- catch a miss. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local PLAYER = here .. "/../../addons/Spoken/"

local function Read(path) return assert(io.open(path)):read("*a") end

local function Lists(path, file)
    local toc, pattern = Read(path), file:gsub("[%.%\\]", "%%%0")
    return toc:find("\n" .. pattern .. "%s*\n") ~= nil or toc:find("\n" .. pattern .. "%s*$") ~= nil
end

local legacy = PLAYER .. "Spoken_1.12.toc"
Expect("Spoken_1.12.toc does not load captions", Lists(legacy, "Transcript.xml"), false)
Expect("...but loads the stub in their place", Lists(legacy, "1.12\\Transcript.lua"), true)
for _, flavor in ipairs({ "", "_Mainline", "_Vanilla", "_TBC", "_Wrath", "_2.4.3", "_3.3.5" }) do
    Expect("Spoken" .. flavor .. ".toc loads captions",
        Lists(PLAYER .. "Spoken" .. flavor .. ".toc", "Transcript.xml"), true)
end
Expect("addon.xml, which every client loads, carries no caption file",
    Read(PLAYER .. "addon.xml"):find("Transcript") == nil, true)

local defined = {}
for name in Read(PLAYER .. "1.12/Transcript.lua"):gmatch("function Transcript:(%w+)") do defined[name] = true end
local callers = { "Core.lua", "UI/PlayerFrame.lua", "UI/MinimalPlayer.lua", "UI/DialogueUIPlayer.lua", "UI/Options.lua" }
for _, file in ipairs(callers) do
    for name in Read(PLAYER .. file):gmatch("Transcript:(%w+)%(") do
        Expect("the 1.12 stub defines Transcript:" .. name .. " (" .. file .. ")", defined[name], true)
    end
end

os.exit(Failures() == 0 and 0 or 1)
