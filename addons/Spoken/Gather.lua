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

Gather = { CAP = 2000 } -- a few kilobytes each, so a full store stays a file the site will take
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

local function IndexOf(key)
    local lines = Store().Lines
    for i = 1, #lines do
        if lines[i].key == key then
            return i
        end
    end
    return nil
end

--- Keep one envelope under `key`, replacing whatever that key held. Does nothing unless the
--- player opted in: a feature addon may call this on every panel without asking first.
---@return boolean stored
function Gather:Add(key, envelope)
    if not self:IsEnabled() then
        return false
    end
    if type(key) ~= "string" or key == "" or type(envelope) ~= "string" or envelope == "" then
        return false
    end
    local lines = Store().Lines
    local at = IndexOf(key)
    if at then
        lines[at].envelope = envelope
        return true
    end
    lines[#lines + 1] = { key = key, envelope = envelope }
    -- Oldest out first. The player has almost certainly uploaded those already, or was never
    -- going to, and a file that grows forever is one the site eventually refuses whole.
    while #lines > self.CAP do
        table.remove(lines, 1)
    end
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

--- Forget everything gathered. The addon cannot see the upload happen, so this is the
--- player's to press once they have sent the file.
function Gather:Clear()
    Store().Lines = {}
end
