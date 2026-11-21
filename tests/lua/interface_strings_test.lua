-- scripts/interface/strings.lua, the interface pack makers' tool: its template is a pack that
-- passes its own check with every module's strings, and the check fails on a key no module reads
-- and on a string whose arguments differ. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(print)
local LUA = arg[-1] or "luajit"
local TOOL = here .. "/../../scripts/interface/strings.lua"
local PACK = os.tmpname() .. "_pack/TestPL"

local function Run(command)
    local pipe = io.popen(command .. " 2>&1; echo \"exit=$?\"")
    local out = pipe:read("*a")
    pipe:close()
    return out
end

os.execute("mkdir -p " .. PACK)
local template = Run(LUA .. " " .. TOOL .. " template plPL")
local file = io.open(PACK .. "/Strings.lua", "w")
file:write((template:gsub("exit=0\n$", "")))
file:close()
file = io.open(PACK .. "/TestPL.toc", "w")
file:write("## X-Spoken-Interface: plPL\n## X-Spoken-InterfaceFormat: 1\nStrings.lua\n")
file:close()

local checked = Run(LUA .. " " .. TOOL .. " check plPL " .. PACK)
for _, module in ipairs({ "Spoken", "Quests", "Places", "Readables", "Bosses", "Developer" }) do
    local done, total = checked:match(module .. ": (%d+) of (%d+) strings")
    Expect("the template has every " .. module .. " string", done ~= nil and done == total and tonumber(total) > 0, true)
end
Expect("...and passes the check", checked:match("exit=(%d+)"), "0")

file = io.open(PACK .. "/Strings.lua", "a")
file:write('Spoken:RegisterInterfaceStrings("plPL", "Spoken", { NO_SUCH_KEY = "x", OPT_LANG_AUTO_FMT = "Auto" })\n')
file:write('Spoken:RegisterInterfaceStrings("plPL", "Spoken", { SEARCH_WHERE = "%1$s z %1$s", OPT_KEY_TAKEN_FMT = "%3$s? %2$s ma %1$s." })\n')
file:close()
checked = Run(LUA .. " " .. TOOL .. " check plPL " .. PACK)
Expect("a key no module reads fails the check", checked:find("no such key: NO_SUCH_KEY", 1, true) ~= nil, true)
local differ = " " .. (checked:match("arguments differ from the English: ([^\n]*)") or "") .. " "
Expect("...and so does a string that drops an argument", differ:find(" OPT_LANG_AUTO_FMT ", 1, true) ~= nil, true)
Expect("...and one that repeats an argument in place of another", differ:find(" SEARCH_WHERE ", 1, true) ~= nil, true)
Expect("...while moving arguments, as another word order does, passes",
    differ:find(" OPT_KEY_TAKEN_FMT ", 1, true), nil)
Expect("...with an error", checked:match("exit=(%d+)"), "1")

os.execute("rm -rf " .. PACK:gsub("/TestPL$", ""))
if Failures() > 0 then print(Failures() .. " failure(s)"); os.exit(1) end
print("\nAll interface strings tool tests passed")
