-- Prints a Lua data file's table as JSON, so the Python side can read what the addons carry as Lua.
--
--   luajit dump.lua pack  <Sounds.lua> <GlobalName> <AddonName>   a voice pack's index
--   luajit dump.lua lore  <Zones.lua | Subzones.lua>               a zones text file, keyed by map

local mode, path, name, addon = ...

local function Encode(value, out)
    local kind = type(value)
    if kind == "table" then
        local array = #value > 0
        out[#out + 1] = array and "[" or "{"
        local first = true
        if array then
            for _, item in ipairs(value) do
                if not first then out[#out + 1] = "," end
                first = false
                Encode(item, out)
            end
        else
            local keys = {}
            for key in pairs(value) do keys[#keys + 1] = key end
            table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
            for _, key in ipairs(keys) do
                if not first then out[#out + 1] = "," end
                first = false
                out[#out + 1] = string.format("%q:", tostring(key)):gsub("\\\n", "\\n")
                Encode(value[key], out)
            end
        end
        out[#out + 1] = array and "]" or "}"
    elseif kind == "string" then
        out[#out + 1] = '"' .. value:gsub('[%c"\\]', function(c)
            if c == '"' then return '\\"' elseif c == "\\" then return "\\\\" end
            return string.format("\\u%04x", c:byte())
        end) .. '"'
    elseif kind == "number" or kind == "boolean" then
        out[#out + 1] = tostring(value)
    else
        out[#out + 1] = "null"
    end
end

local chunk = assert(loadfile(path))
local result
if mode == "pack" then
    -- What the client would answer for the .toc keys a pack reads: nothing, so its defaults hold.
    local env = setmetatable({ GetAddOnMetadata = function() return nil end }, { __index = _G })
    setfenv(chunk, env)
    chunk(addon)
    result = env[name]
    result = result and result[addon]
elseif mode == "lore" then
    local seen
    local registry = {
        ShouldLoadLanguage = function() return true end,
        RegisterLoreData = function(_, _, _, data) seen = data end,
    }
    local env = setmetatable({}, { __index = _G })
    setfenv(chunk, env)
    chunk("Spoken_Places", registry)
    result = seen
end
local out = {}
Encode(result, out)
io.write(table.concat(out))
