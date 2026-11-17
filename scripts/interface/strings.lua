-- The English strings of Spoken and its modules, for the makers of an interface pack
-- (docs/contributors/INTERFACE-PACKS.md).
--
--   luajit scripts/interface/strings.lua template <code>           a pack's Lua to start from: every
--                                                                  string, in English, as its module
--                                                                  lists them
--   luajit scripts/interface/strings.lua check <code> <pack-folder>  what a pack lacks, has that no
--                                                                  module reads, or formats otherwise
--
-- The English is taken by running each module's own strings file, so the words are the ones the
-- game has; the order is the file's. `check` runs the pack's Lua files as its .toc lists them,
-- against a Spoken that only takes the strings. It fails on a key no module reads and on a string
-- whose format arguments differ from the English, which would show wrong or not at all. A key the
-- pack lacks is listed, not failed: it reads the language below, then the English.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
local ADDONS = here .. "/../../addons/"

-- Each module's English strings file, and how it hands its table over.
local MODULES = {
    { name = "Spoken", file = "Spoken/Strings.lua", env = "SpokenEnv" },
    { name = "Quests", file = "Spoken_Quests/Strings.lua", env = "VoiceOver" },
    { name = "Places", file = "Spoken_Places/Locale/enUS.lua" },
    { name = "Readables", file = "Spoken_Readables/Locale/enUS.lua" },
    { name = "Bosses", file = "Spoken_Bosses/Locale/enUS.lua" },
    { name = "Developer", file = "Spoken_Developer/Locale/enUS.lua" },
}

local function Read(path)
    local file = assert(io.open(path, "rb"))
    local text = file:read("*a")
    file:close()
    return text
end

--- The keys of `path`'s strings in the order the file assigns them.
local function Order(path)
    local order, seen = {}, {}
    for line in (Read(path):gsub("\r", "") .. "\n"):gmatch("(.-)\n") do
        local key = line:match("^%s*L%.([%w_]+)%s*=") or line:match("^%s+([%u%d_]+)%s*=%s*[\"%[]")
        if key and not seen[key] then
            seen[key] = true
            order[#order + 1] = key
        end
    end
    return order
end

--- A module's English strings, run as the client runs its file.
local function English(module)
    local path = ADDONS .. module.file
    local chunk = assert(loadfile(path))
    local namespace = { RegisterStrings = function() end }
    if module.env then
        local env = setmetatable({}, { __index = _G })
        rawset(_G, module.env, env)
        setfenv(chunk, env)
        chunk()
        rawset(_G, module.env, nil)
        return env.L, Order(path)
    end
    chunk(module.name, namespace)
    -- Places' table is local to its file and handed to RegisterStrings.
    if not namespace.L then
        namespace.RegisterStrings = nil
        local captured
        namespace.RegisterStrings = function(_, _, strings) captured = strings end
        chunk(module.name, namespace)
        return captured, Order(path)
    end
    return namespace.L, Order(path)
end

--- The format arguments a string takes, in order of their letters: "%1$s of %2$d" is "ds".
local function Arguments(text)
    local letters = {}
    for letter in text:gsub("%%%%", ""):gmatch("%%%d*%$?[%d%.]*([%a])") do letters[#letters + 1] = letter end
    table.sort(letters)
    return table.concat(letters)
end

local function Quote(text)
    return '"' .. text:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r") .. '"'
end

local function Template(code)
    local out = { "-- " .. code .. " strings for Spoken's interface. Every string starts in English: translate the",
        "-- ones you can and delete the rest, which then show in the language below. Keep each %1$s and its",
        "-- number. See docs/contributors/INTERFACE-PACKS.md.", "" }
    for _, module in ipairs(MODULES) do
        local strings, order = English(module)
        out[#out + 1] = ("Spoken:RegisterInterfaceStrings(%q, %q, {"):format(code, module.name)
        for _, key in ipairs(order) do
            if type(strings[key]) == "string" then out[#out + 1] = ("    %s = %s,"):format(key, Quote(strings[key])) end
        end
        out[#out + 1] = "})"
        out[#out + 1] = ""
    end
    io.write(table.concat(out, "\n"))
end

local function Check(code, folder)
    folder = folder:gsub("[/\\]$", "")
    local name = folder:match("([^/\\]+)$")
    local registered = {}
    _G.Spoken = {
        RegisterInterfaceStrings = function(_, language, module, strings)
            if language ~= code then return false end
            registered[module] = registered[module] or {}
            for key, value in pairs(strings) do registered[module][key] = value end
            return true
        end,
        RegisterText = function() return true end,
    }
    for line in (Read(folder .. "/" .. name .. ".toc"):gsub("\r", "") .. "\n"):gmatch("(.-)\n") do
        if line:match("%.lua%s*$") and not line:match("^#") then
            assert(loadfile(folder .. "/" .. line:gsub("\\", "/"):gsub("%s+$", "")))(name, {})
        end
    end
    local failed = false
    for _, module in ipairs(MODULES) do
        local strings, order = English(module)
        local own = registered[module.name] or {}
        local missing, unknown, wrong, count = {}, {}, {}, 0
        for _, key in ipairs(order) do
            if type(strings[key]) == "string" then
                if own[key] == nil then missing[#missing + 1] = key
                elseif Arguments(own[key]) ~= Arguments(strings[key]) then wrong[#wrong + 1] = key end
                count = count + 1
            end
        end
        for key in pairs(own) do if strings[key] == nil then unknown[#unknown + 1] = key end end
        table.sort(unknown)
        print(("%s: %d of %d strings"):format(module.name, count - #missing, count))
        if #unknown > 0 then failed = true; print("  no such key: " .. table.concat(unknown, " ")) end
        if #wrong > 0 then failed = true; print("  arguments differ from the English: " .. table.concat(wrong, " ")) end
        if #missing > 0 then print("  missing: " .. table.concat(missing, " ")) end
    end
    os.exit(failed and 1 or 0)
end

local command, code, folder = arg[1], arg[2], arg[3]
if command == "template" and code then
    Template(code)
elseif command == "check" and code and folder then
    Check(code, folder)
else
    io.stderr:write("usage: luajit scripts/interface/strings.lua template <code>\n" ..
        "       luajit scripts/interface/strings.lua check <code> <pack-folder>\n")
    os.exit(2)
end
