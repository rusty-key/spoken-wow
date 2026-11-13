-- Every locale file of Spoken, Quests, Places, Readables and Developer holds the same keys as
-- its English base, none left over, and each string takes the same arguments (a %s stays a %s,
-- possibly as %1$s). Places' own data files are checked by its language tests. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(print)
local ADDONS = here .. "/../../addons/"
local CODES = { "deDE", "esES", "frFR", "ptBR", "ruRU", "koKR", "zhCN", "zhTW" }

local function Read(path)
    local file = io.open(path, "rb")
    if not file then return nil end
    local text = file:read("*a")
    file:close()
    return text
end

--- key -> the argument letters its string takes, in sorted order, from `L.KEY = "..."` lines and,
--- where `table` is set, the `KEY = "...",` lines of Spoken's English table.
local function Strings(path, inTable)
    local text = Read(path)
    if not text then return nil end
    local found = {}
    for line in (text:gsub("\r", "") .. "\n"):gmatch("(.-)\n") do
        local key, value = line:match("^%s*L%.([%w_]+)%s*=%s*(.*)$")
        if not key and inTable then key, value = line:match("^%s*([%w_]+)%s*=%s*(\".*)$") end
        if key then
            local letters = {}
            for spec in value:gsub("%%%%", ""):gmatch("%%%d*%$?[%d%.]*([%a])") do letters[#letters + 1] = spec end
            table.sort(letters)
            found[key] = table.concat(letters)
        end
    end
    return found
end

local MODULES = {
    { name = "Spoken", base = "Spoken/Strings.lua", dir = "Spoken/Locale/", table = true },
    { name = "Quests", base = "Spoken_Quests/Strings.lua", dir = "Spoken_Quests/Locale/" },
    { name = "Places", base = "Spoken_Places/Locale/enUS.lua", dir = "Spoken_Places/Locale/" },
    { name = "Readables", base = "Spoken_Readables/Locale/enUS.lua", dir = "Spoken_Readables/Locale/" },
    { name = "Bosses", base = "Spoken_Bosses/Locale/enUS.lua", dir = "Spoken_Bosses/Locale/", min = 5 },
    -- TITLE is the addon's name, the same in every language.
    { name = "Developer", base = "Spoken_Developer/Locale/enUS.lua", dir = "Spoken_Developer/Locale/", same = { TITLE = true } },
}

for _, module in ipairs(MODULES) do
    local english = Strings(ADDONS .. module.base, module.table)
    local count = 0
    for _ in pairs(english or {}) do count = count + 1 end
    Expect(module.name .. ": the English strings are found", count > (module.min or 20), true)
    for _, code in ipairs(CODES) do
        local own = Strings(ADDONS .. module.dir .. code .. ".lua")
        local missing, extra, args = {}, {}, {}
        for key, letters in pairs(english) do
            if module.same and module.same[key] then
                -- Not translated, so not checked.
            elseif own[key] == nil then missing[#missing + 1] = key
            elseif own[key] ~= letters then args[#args + 1] = key end
        end
        for key in pairs(own) do if english[key] == nil then extra[#extra + 1] = key end end
        table.sort(missing); table.sort(extra); table.sort(args)
        local label = module.name .. " " .. code
        Expect(label .. ": no key of the English is missing", table.concat(missing, " "), "")
        Expect(label .. ": no key is left over", table.concat(extra, " "), "")
        Expect(label .. ": every string takes the English one's arguments", table.concat(args, " "), "")
    end
end

if Failures() > 0 then print(Failures() .. " failure(s)"); os.exit(1) end
