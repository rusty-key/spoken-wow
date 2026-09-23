setfenv(1, SpokenEnv)

-- What the client's "blocked from an action only available to the Blizzard UI" popup leaves
-- out, gathered for a bug report.
--
-- The client fires ADDON_ACTION_FORBIDDEN (always protected) or ADDON_ACTION_BLOCKED
-- (protected in combat) with the addon it blames and the function it refused. That name alone
-- narrows the search a lot. The stack at that moment is only this handler's, so what caused
-- it is read off the state instead: `issecurevariable` says which addon last wrote a variable,
-- and a Blizzard frame field or global written by one of ours is where the taint came from.
-- The client's own taint log is the full record; `/spoken taint on` turns it on.
--
-- Listed by Contribute.xml, so the private-server clients never load it: their Lua cannot
-- parse it, and they have fewer protected paths to trip.

TaintReport = { events = {}, noticed = {} }

local MAX_EVENTS = 5
local MAX_GLOBALS = 40

-- Our addons, and the names they had before: the client blames by folder name.
local function IsOurs(addon)
    return type(addon) == "string" and (addon:find("^Spoken") or addon == "VoiceOverRedux"
        or addon:find("^ZoneLore")) and true or false
end

-- Blizzard frames our code hooks, anchors to or reparents into. A field on one of these that
-- an addon wrote is read by Blizzard code, which then runs tainted.
local FRAMES = {
    "QuestScrollFrame", "QuestScrollFrame.Contents", "QuestMapFrame", "QuestMapFrame.DetailsFrame",
    "QuestMapFrame.DetailsFrame.BackFrame", "WorldMapFrame", "WorldMapFrame.ScrollContainer",
    "QuestLogFrame", "QuestLogListScrollFrame", "QuestLogScrollFrame", "QuestLogDetailFrame",
    "QuestFrame", "GossipFrame", "ItemTextFrame", "GameTooltip", "UIParent",
}

-- Blizzard globals our code hooks or, on the older clients, replaces.
local GLOBALS = {
    "GetQuestLogTitle", "QuestLog_Update", "QuestLogQuests_Update", "QuestMapFrame_ShowQuestDetails",
    "QuestFrame_OnEvent", "SelectQuestLogEntry", "AbandonQuest", "SelectGossipOption",
    "QUESTS_DISPLAYED", "CreateFrame", "PlaySoundFile", "StopSound",
}

-- Frames whose being open says what the player was doing.
local OPEN = { "WorldMapFrame", "QuestMapFrame", "QuestLogFrame", "QuestFrame", "GossipFrame", "ItemTextFrame" }

local function Resolve(path)
    local value = _G
    for part in path:gmatch("[^.]+") do
        if type(value) ~= "table" then return nil end
        value = rawget(value, part)
    end
    return type(value) == "table" and value or nil
end

-- Every field of `frame` an addon wrote, as "path.key (Addon)". Keys that are not strings
-- (the userdata handle at [0]) cannot be asked about.
local function TaintedFields(path, found)
    local frame = Resolve(path)
    if not frame then return end
    for key in pairs(frame) do
        if type(key) == "string" then
            local secure, by = issecurevariable(frame, key)
            if not secure then
                table.insert(found, format("%s.%s (%s)", path, key, by or "?"))
            end
        end
    end
end

-- The suspects' state now, which is as close to the moment of the block as an event gets.
local function Probe()
    local found = {}
    if not issecurevariable then return found end
    for _, path in ipairs(FRAMES) do
        TaintedFields(path, found)
    end
    for _, name in ipairs(GLOBALS) do
        if rawget(_G, name) ~= nil then
            local secure, by = issecurevariable(name)
            if not secure then
                table.insert(found, format("%s (%s)", name, by or "?"))
            end
        end
    end
    table.sort(found)
    return found
end

local function OpenFrames()
    local open = {}
    for _, name in ipairs(OPEN) do
        local frame = rawget(_G, name)
        if type(frame) == "table" and frame.IsShown and frame:IsShown() then
            table.insert(open, name)
        end
    end
    return open
end

function TaintReport:OnEvent(event, addon, func)
    table.insert(self.events, {
        event = event,
        addon = addon or "?",
        func = func or "?",
        time = date("%H:%M:%S"),
        combat = InCombatLockdown and InCombatLockdown() or false,
        open = OpenFrames(),
        tainted = Probe(),
    })
    if #self.events > MAX_EVENTS then
        table.remove(self.events, 1)
    end

    -- Once per addon and function a session: the client fires this every time the path runs,
    -- and a player who opens the quest log ten times needs telling once.
    local key = tostring(addon) .. ":" .. tostring(func)
    if IsOurs(addon) and not self.noticed[key] then
        self.noticed[key] = true
        print(format(L.TAINT_NOTICE, tostring(addon), tostring(func)))
    end
end

-- Globals our addons wrote into _G, which in a private environment should be only the ones
-- written on purpose: saved variables, slash commands, the shared tables. Anything else is a
-- leak, and a leak of a Blizzard name is a taint. Walked when the report is asked for rather
-- than on the event: _G is tens of thousands of entries.
local function OurGlobals()
    local found = {}
    if not issecurevariable then return found end
    for name in pairs(_G) do
        if type(name) == "string" then
            local secure, by = issecurevariable(name)
            if not secure and IsOurs(by) then
                table.insert(found, format("%s (%s)", name, by))
            end
        end
    end
    table.sort(found)
    return found
end

local function LoadedAddons()
    local lines = {}
    for i = 1, GetNumAddOns() do
        local name = GetAddOnInfo(i)
        if name and IsAddOnLoaded(name) then
            local version = GetAddOnMetadata(i, "Version")
            table.insert(lines, version and version ~= "" and (name .. " " .. version) or name)
        end
    end
    table.sort(lines)
    return lines
end

local function Flavor()
    if Version.IsCamelot then return "WoW Forever"
    elseif Version.IsRetailMainline then return "Retail"
    elseif Version.IsRetailVanilla then return "Classic Era"
    elseif Version.IsRetailBurningCrusade then return "Burning Crusade Classic"
    elseif Version.IsRetailWrath then return "Wrath Classic" end
    return "other"
end

local function List(lines, items, empty)
    if #items == 0 then
        table.insert(lines, "  " .. empty)
    end
    for _, item in ipairs(items) do
        table.insert(lines, "  " .. item)
    end
end

--- The report as text, for the copy box and for the tests.
function TaintReport:Build()
    local lines = {
        format("Spoken taint report, SpokenPlayer %s", AddonVersion),
        format("Client: %s %s (build %s, interface %s)", Flavor(), tostring(Version.Client),
            tostring(Version.Build), tostring(Version.Interface)),
        format("Taint log: %s", GetCVar and tostring(GetCVar("taintLog")) or "?"),
        "",
    }
    if #self.events == 0 then
        table.insert(lines, "No action has been blocked this session.")
    end
    for _, e in ipairs(self.events) do
        table.insert(lines, format("%s %s: %s blocked from %s%s", e.time, e.event, e.addon, e.func,
            e.combat and ", in combat" or ""))
        table.insert(lines, "  open: " .. (#e.open > 0 and table.concat(e.open, ", ") or "none of the watched frames"))
        table.insert(lines, "  tainted Blizzard fields and globals:")
        List(lines, e.tainted, "none found")
    end

    table.insert(lines, "")
    table.insert(lines, "Globals written by Spoken addons:")
    local globals = OurGlobals()
    local shown = {}
    for i = 1, math.min(#globals, MAX_GLOBALS) do shown[i] = globals[i] end
    List(lines, shown, "none")
    if #globals > MAX_GLOBALS then
        table.insert(lines, format("  ...and %d more", #globals - MAX_GLOBALS))
    end

    table.insert(lines, "")
    table.insert(lines, "Loaded addons:")
    List(lines, LoadedAddons(), "none")
    return table.concat(lines, "\n")
end

function TaintReport:Show()
    Spoken:ShowCopyText(self:Build(), L.TAINT_COPY_HINT)
end

--- Turn the client's own taint log on or off. It writes Logs\taint.log in the game folder,
--- and the setting outlives the session, so the message says how to turn it off again.
function TaintReport:SetLogging(on)
    SetCVar("taintLog", on and "1" or "0")
    print(on and L.TAINT_LOG_ON or L.TAINT_LOG_OFF)
end

local watcher = CreateFrame("Frame")
for _, event in ipairs({ "ADDON_ACTION_FORBIDDEN", "ADDON_ACTION_BLOCKED" }) do
    pcall(watcher.RegisterEvent, watcher, event)
end
watcher:SetScript("OnEvent", function(_, event, addon, func)
    TaintReport:OnEvent(event, addon, func)
end)
