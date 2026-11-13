setfenv(1, VoiceOver)

-- The hidden PlayerModel probe, shared by contributions and the body lookups.
NPCModel = {}

-- Functions run with the guid after a load finishes, whichever way it was noticed.
NPCModel.onLoaded = {}

-- PlayerModel loads asynchronously: probed against a live client, SetUnit followed
-- immediately by GetModelFileID answers nothing, and the same read a moment later answers
-- the real file id. So the model is never read on the click -- it is pre-warmed on the
-- refresh path, into this cache, while the player is still reading the panel (seconds, not
-- one frame), and Capture only ever looks the guid up here.
--
-- Keyed by the NPC's guid, since the probe is asked about a different unit every time a
-- different NPC comes on screen, and a load that already finished for one says nothing
-- about another. `false` remembers "asked, and nothing came back" (a gameobject, a client
-- with no GUID, or a guid whose every load attempt came back empty) so a miss stops being
-- asked for rather than retried on every refresh; a guid missing from this table entirely
-- has never been answered.
local modelCache = {}

-- How many loads each guid has started, and how many it may. A load that came back empty is
-- not taken as the answer while attempts remain: a cursor sweep over a crowd starts a load for
-- each creature and leaves it a moment later, and the model only arrives while the probe is
-- kept on it. Bounded all the same, since every load is a 3D scene this client has hung on.
local loadAttempts = {}
local MAX_LOAD_ATTEMPTS = 2

-- Bumped on every load started, so a poll scheduled for an earlier load of the same guid can
-- tell it is not polling the load now in flight.
local loadSerial = 0

-- The one guid currently waiting on a load, and how many refreshes it has waited without
-- resolving. A second refresh for the same guid while it is still loading must not call
-- SetUnit again -- that is the whole point of keying by guid at all -- and a guid that never
-- resolves must eventually be given up on rather than left loading (and the probe shown)
-- forever.
local loadingGUID
local loadingRefreshes

-- How many refreshes a guid may wait, once primed, before PollLoadingGUID gives up on this
-- load. OnModelLoaded is the fast path -- most of the time this bound is
-- never reached, because the callback (when this client fires it at all) resolves the guid
-- first. This is what makes the client behaving either way converge on the same outcome.
local MAX_LOAD_REFRESHES = 2

-- The frame itself, made once and kept, rather than one per prime: it is only ever handed a
-- different unit. What is NOT kept is it being shown -- a PlayerModel left shown keeps
-- driving a 3D scene draw for as long as the addon runs, and this client has hung its GPU on
-- model rendering before. UI/Portrait.lua's pooled-model Acquire/Release (Compat.lua, for the
-- clients that cannot show an arbitrary creature in a DressUpModel) is this repo's existing
-- answer to the same problem: show it while a load is in flight, then Hide/ClearModel once
-- read, the way Release does.
local modelProbe

local function ModelProbeFrame()
    if not CreateFrame then
        return nil
    end
    if not modelProbe then
        local ok, frame = pcall(CreateFrame, "PlayerModel", nil, UIParent)
        if not ok or not frame then
            return nil
        end
        modelProbe = frame
        if modelProbe.SetSize then modelProbe:SetSize(64, 64) end
        if modelProbe.SetPoint then modelProbe:SetPoint("CENTER") end
        if modelProbe.SetAlpha then modelProbe:SetAlpha(0) end
    end
    return modelProbe
end

--- The file id the probe holds now, or nil while it has none.
local function ReadProbe()
    local probe = modelProbe
    -- Not `probe and pcall(...)`: `and` truncates pcall's two return values down to one, so
    -- `id` would be nil even on a successful read. Separate statements keep both.
    local ok, id = false, nil
    if probe then
        ok, id = pcall(probe.GetModelFileID, probe)
    end
    if ok and type(id) == "number" and id > 0 then
        return id
    end
    return nil
end

--- Put the probe away without deciding anything about `guid` -- the difference between this
--- and FinishModelLoad is exactly that it never writes modelCache. Used when there is simply
--- nothing left on screen to keep the probe up for: the player closed the dialog, or clicked
--- away, with no retarget to another NPC to trigger the guard NPCModel:Prime already has.
--- Left uncached, a guid abandoned this way is primed again (one more SetUnit) the next time
--- it is asked for, rather than permanently remembered as a miss it never actually resolved
--- to -- only running out of MAX_LOAD_ATTEMPTS is allowed to decide that.
local function AbandonModelLoad(guid)
    local probe = modelProbe
    -- First act, not last: ClearModel below can itself fire OnModelLoaded on some clients, and
    -- that callback is FinishModelLoad closed over this same guid. Clearing the script before
    -- touching the model at all means a re-entrant call has nothing left to run.
    if probe and probe.SetScript then
        pcall(probe.SetScript, probe, "OnModelLoaded", nil)
    end
    if probe then
        -- pcall'd like every other probe call here: ClearModel is exactly the kind of call
        -- that can itself trigger a client callback, and one client's blowup on it must not
        -- skip the Hide beneath it.
        if probe.ClearModel then pcall(probe.ClearModel, probe) end
        if probe.Hide then probe:Hide() end
    end
    if loadingGUID == guid then
        loadingGUID, loadingRefreshes = nil, nil
    end
end

--- Read back whatever the probe currently has for `guid`, cache it, and put the probe away.
--- The one place that finalises a load, regardless of what noticed it was time to: the
--- OnModelLoaded callback (the fast path), or PollLoadingGUID reading the probe directly
--- (the fallback that does not depend on that callback ever firing).
local function FinishModelLoad(guid)
    -- The script is cleared before the read, so a callback the read itself fires finds
    -- nothing to run; the read comes before AbandonModelLoad's ClearModel empties the probe.
    local probe = modelProbe
    if probe and probe.SetScript then
        pcall(probe.SetScript, probe, "OnModelLoaded", nil)
    end
    local id = ReadProbe()
    AbandonModelLoad(guid)
    -- Absent rather than zero: the site reads a missing model as "race unknown", and 0 is a
    -- file id that would mean something.
    modelCache[guid] = id or false
    for _, callback in ipairs(NPCModel.onLoaded) do
        pcall(callback, guid)
    end
end

--- Stop a load that came back empty: a miss for good once the guid has no attempts left,
--- otherwise only put away, so the next ask loads it again.
local function GiveUpModelLoad(guid)
    if (loadAttempts[guid] or 0) >= MAX_LOAD_ATTEMPTS then
        FinishModelLoad(guid)
    else
        AbandonModelLoad(guid)
    end
end

--- A refresh for a guid that is still loading, with no cached answer yet: OnModelLoaded may
--- or may not exist on this client, and may or may not have fired already -- there is no way
--- to tell from here, and no need to. The probe is still shown regardless (nothing but
--- FinishModelLoad ever hides it), so read it directly. Finalise on success, or give this
--- load up once it has waited long enough that leaving the probe shown any longer is not
--- worth it either.
local function PollLoadingGUID(guid)
    loadingRefreshes = loadingRefreshes + 1
    if ReadProbe() then
        FinishModelLoad(guid)
    elseif loadingRefreshes >= MAX_LOAD_REFRESHES then
        GiveUpModelLoad(guid)
    end
end

--- Start a model load for this NPC's guid, if nothing has answered for it yet. HasGap calls
--- it on every quest and gossip event, and a second call for a guid already cached or already
--- loading must be free.
function NPCModel:Prime(guid, unit)
    -- Whatever is on screen now, a load left in flight for a DIFFERENT guid is no longer
    -- relevant to anything -- retargeting between two quest givers faster than a load
    -- resolves is ordinary play, not an edge case. Settle it before doing anything else, so
    -- the probe is never left associated with an abandoned target: not while priming the new
    -- one, and not indefinitely afterward if the player then lingers on a guid that happens to
    -- already be cached. Cached if its model is in; otherwise given up, which leaves it to be
    -- loaded again later while it has attempts left.
    if loadingGUID and loadingGUID ~= guid then
        if ReadProbe() then
            FinishModelLoad(loadingGUID)
        else
            GiveUpModelLoad(loadingGUID)
        end
    end

    if not guid or modelCache[guid] ~= nil then
        return
    end
    if loadingGUID == guid then
        PollLoadingGUID(guid)
        return
    end

    local probe = ModelProbeFrame()
    if not probe or not probe.SetUnit or not probe.GetModelFileID
        or (loadAttempts[guid] or 0) >= MAX_LOAD_ATTEMPTS then
        modelCache[guid] = false
        return
    end

    loadAttempts[guid] = (loadAttempts[guid] or 0) + 1
    loadSerial = loadSerial + 1
    loadingGUID = guid
    loadingRefreshes = 0
    if probe.Show then probe:Show() end
    -- Before SetUnit, not after: SetUnit can itself deliver the model synchronously enough on
    -- some clients (or fire OnModelLoaded off the same tick) that a script installed afterward
    -- would miss it, and every refresh in between would then still find a stale closure from
    -- whatever guid this probe last loaded, briefly live for the wrong NPC. A fast path, not a
    -- requirement either way: PollLoadingGUID below reads the probe directly on the next
    -- refresh regardless of whether this ever fires, so correctness here never depends on this
    -- client generation supporting the script at all, only on how many refreshes it costs
    -- before the fallback notices. SetScript on an unrecognised script type is a Lua error on a
    -- real client, which is what the pcall is for.
    if probe.SetScript then
        pcall(probe.SetScript, probe, "OnModelLoaded", function() FinishModelLoad(guid) end)
    end
    pcall(probe.SetUnit, probe, unit or "npc")

    -- Whoever asked may never refresh again -- a target with no dialog after, or a dialog
    -- closed on a creature whose bodies keep its load from being abandoned -- so the load
    -- polls itself and is settled within two seconds even if OnModelLoaded never fires.
    local serial = loadSerial
    local function Poll()
        if loadSerial == serial and loadingGUID == guid then
            PollLoadingGUID(guid)
        end
    end
    C_Timer.After(1, Poll)
    C_Timer.After(2, Poll)
end

--- What the model probe has cached for the NPC on screen, reading it directly as a last
--- resort on a miss for the guid that is still loading.
---
--- A gossip interaction fires exactly one refresh (GOSSIP_SHOW) before the player reads and
--- clicks, so a cache built only from refreshes and timed polls could still lack a model the
--- probe has. SetUnit happened when the panel opened, seconds before this click, and
--- live-client evidence says that is enough: read the probe (never SetUnit it again -- that
--- would be asking a second time, which NPCModel:Prime already guards against).
---
--- Only a successful read finalises anything here. A click quick enough to beat the load --
--- distinct from a load that has genuinely finished with nothing to show -- must not write
--- `false`: doing so would clear loadingGUID and cache a permanent miss, foreclosing the
--- callback or the next poll from ever resolving this guid for the rest of the session. Only
--- running out of MAX_LOAD_ATTEMPTS is allowed to give up for real; this is not that, so an
--- empty read here simply leaves the guid exactly as it was and omits the field for this one
--- capture.
function NPCModel:Get(guid)
    if not guid then
        return nil
    end
    if modelCache[guid] == nil and loadingGUID == guid and ReadProbe() then
        FinishModelLoad(guid)
    end
    return modelCache[guid] or nil
end

--- Put the probe away without caching anything, if a load is in flight.
function NPCModel:Abandon()
    if loadingGUID then
        AbandonModelLoad(loadingGUID)
    end
end

--- Whether a load is in flight: any, or the one for `guid`.
function NPCModel:IsLoading(guid)
    if guid then
        return loadingGUID == guid
    end
    return loadingGUID ~= nil
end

-- A split creature's greeting plays the moment its dialog opens, too soon for a model asked for
-- then. Targeting or pointing at it first is nearly always how a dialog is opened, so its model
-- is asked for then. Only a split creature: nothing else is heard differently by its model.
-- DataModules loads after this file, so it is reached at event time.
local function PrimeUnit(unit)
    local guid = UnitGUID and UnitGUID(unit)
    local id = guid and Utils:GetCreatureIDFromGUID(guid)
    if not (id and DataModules and DataModules:IsSplit(id)) then
        return
    end
    NPCModel:Prime(guid, unit)
end

if CreateFrame then
    local ok, events = pcall(CreateFrame, "Frame")
    if ok and events then
        pcall(events.RegisterEvent, events, "PLAYER_TARGET_CHANGED")
        pcall(events.RegisterEvent, events, "UPDATE_MOUSEOVER_UNIT")
        pcall(events.SetScript, events, "OnEvent", function(_, event)
            PrimeUnit(event == "PLAYER_TARGET_CHANGED" and "target" or "mouseover")
        end)
    end
end
