setfenv(1, SpokenEnv)

-- Contributing in the background: every line a feature addon would have offered a Contribute
-- button for, kept in SpokenContributions.lua until the player uploads the file.
--
-- WHY THE SAVED VARIABLES AND NOT A LINK. A Contribute link carries one envelope, and a
-- player who meets a hundred gaps in an evening will not click a hundred times. The saved
-- variables file is the one thing an addon can write that leaves the game, and the site's
-- /contribute page reads it back: the envelopes in it are the same bytes a link would carry,
-- so the server checks them exactly as it checks a click.
--
-- Here, not in each feature addon, so there is one file to upload whichever addons gathered.
-- The table itself is SpokenContributionsDB, declared by the SpokenContributions folder the
-- player ships beside itself, so the file is SavedVariables/SpokenContributions.lua and holds
-- nothing but this: a file named after the player would carry its settings along too.
--
-- Keyed by what the line IS (quest, stage and speaker; page checksum), not by the envelope's
-- own checksum: an envelope captured again a second later can differ only in the NPC model a
-- slow cache has since answered, and that should replace the first rather than sit beside it.

-- A line is a few kilobytes and a sighting about a hundred bytes, so a full store stays a file the
-- site will take.
Gather = { CAP = 2000, SEEN_CAP = 2000 }
Spoken.Gather = Gather

-- Read through _G on every call rather than cached: the client assigns the table when the
-- SpokenContributions folder loads, which may be after this file ran. A player installed
-- without that folder still gathers, into a table the client simply never writes out.
local function Store()
    local store = rawget(_G, "SpokenContributionsDB")
    if type(store) ~= "table" then
        store = {}
        _G.SpokenContributionsDB = store
    end
    store.Lines = store.Lines or {}
    store.Seen = store.Seen or {}
    return store
end

function Gather:IsEnabled()
    -- On unless the player said otherwise: nothing gathered ever leaves the game by
    -- itself -- the file goes out only in an upload the player runs -- so the default
    -- is to keep everything, and the switch (here, and mirrored in the feature
    -- addons) is the opt-out. A stored false is the only off.
    return Store().Enabled ~= false
end

function Gather:SetEnabled(enabled)
    Store().Enabled = enabled and true or false
    Callbacks:Fire("CONTRIBUTE_SETTINGS_CHANGED")
end

function Gather:IsIntroduced()
    return Store().Introduced and true or false
end

function Gather:SetIntroduced()
    Store().Introduced = true
end

local function IndexOf(key, list)
    list = list or Store().Lines
    for i = 1, #list do
        if list[i].key == key then
            return i
        end
    end
    return nil
end

-- Keep `entry` in `list` under its key, replacing what that key held, oldest out past `cap`. The
-- player has almost certainly uploaded those already, or was never going to, and a file that
-- grows forever is one the site eventually refuses whole.
local function Keep(list, cap, entry)
    local at = IndexOf(entry.key, list)
    if at then
        list[at] = entry
        return
    end
    list[#list + 1] = entry
    while #list > cap do
        table.remove(list, 1)
    end
end

local function Valid(key, envelope)
    return type(key) == "string" and key ~= "" and type(envelope) == "string" and envelope ~= ""
end

--- Keep one envelope under `key`, replacing whatever that key held. Does nothing unless the
--- player opted in: a feature addon may call this on every panel without asking first.
---@return boolean stored
function Gather:Add(key, envelope)
    if not (self:IsEnabled() and Valid(key, envelope)) then
        return false
    end
    Keep(Store().Lines, self.CAP, { key = key, envelope = envelope })
    return true
end

function Gather:Count()
    return #Store().Lines
end

--- Every line kept, oldest first, each `{ key = ..., envelope = ... }`: the store itself, for a
--- feature addon tidying the lines it kept. Read whether or not gathering is on, since lines kept
--- before the player opted out still go out with the file.
function Gather:Lines()
    return Store().Lines
end

---@return string|nil
function Gather:Get(key)
    local at = IndexOf(key)
    return at and Store().Lines[at].envelope or nil
end

---@return boolean removed
function Gather:Remove(key)
    local at = IndexOf(key)
    if at then
        table.remove(Store().Lines, at)
    end
    return at ~= nil
end

--- Whether the lines kept by earlier versions were tidied at login: a feature addon does that
--- once, and the file says so.
function Gather:IsTidied()
    return Store().Tidied and true or false
end

function Gather:SetTidied()
    Store().Tidied = true
end

--- Keep one NPC's sighting envelope under `npc` ("creature:3429"), with the zones it names, so
--- the next sighting adds to them without reading the envelope back. Beside the lines rather than
--- among them, so sightings never push a line out of CAP; the upload finds every envelope in the
--- file wherever it sits. Does nothing unless the player opted in.
---@return boolean stored
function Gather:See(npc, zones, envelope)
    if not (self:IsEnabled() and Valid(npc, envelope) and type(zones) == "table") then
        return false
    end
    Keep(Store().Seen, self.SEEN_CAP, { key = npc, zones = zones, envelope = envelope })
    return true
end

--- The envelope kept for `npc`, and the zones it names.
---@return string|nil envelope
---@return table|nil zones
function Gather:GetSeen(npc)
    local seen = Store().Seen
    local at = IndexOf(npc, seen)
    if at then
        return seen[at].envelope, seen[at].zones
    end
end

function Gather:SeenCount()
    return #Store().Seen
end

--- How Sent.lua names a sent envelope: its sum and its length in bytes, read without hashing it.
--- Nil for anything that is not an envelope.
function Gather:SentMark(envelope)
    local sum = type(envelope) == "string" and envelope:match("\nsum=(%d+)\n$")
    return sum and string.format("%s:%d", sum, #envelope) or nil
end

--- Drop every line the Spoken Manager sent. The game saved the file before it loaded Sent.lua, so a
--- line kept since is not in `sent` and stays. Sightings stay: they are how SeeSpeaker knows a zone is told already, and
--- without them every visit would gather and send the same zone again.
---@param sent table|nil  mark -> true, from Sent.lua
---@return number dropped
function Gather:DropSent(sent)
    if type(sent) ~= "table" then
        return 0
    end
    local lines, kept = Store().Lines, {}
    for _, entry in ipairs(lines) do
        local mark = self:SentMark(entry.envelope)
        if not (mark and sent[mark]) then
            kept[#kept + 1] = entry
        end
    end
    Store().Lines = kept
    return #lines - #kept
end

--- Forget everything gathered. The addon cannot see the upload happen, so this is the
--- player's to press once they have sent the file.
function Gather:Clear()
    Store().Lines = {}
    Store().Seen = {}
end
