-- A place this addon has no lore for, as something a player can describe.
--
-- No text, unlike the quests and books envelopes: zone lore is wiki-sourced rather than
-- client-sourced, so the client has nothing to hand over. What this sends names the place --
-- the map, the zone, the subzone -- and the contribute page asks the player for the part that
-- is actually missing: a description of it.
--
-- It travels the same format for one reason: one triage queue for three addons.

local ADDON_NAME, SpokenZones = ...


--- Whether this client can offer Contribute at all: a player that carries contributing (an
--- older bundled one does not), and the buttons not hidden in its settings.
function SpokenZones:CanContribute()
    if not (_G.Spoken and Spoken.Contribute and Spoken.ShowContribution) then
        return false
    end
    if Spoken.AreContributeButtonsHidden and Spoken:AreContributeButtonsHidden() then
        return false
    end
    return true
end

--- The fields every zones envelope starts with: which addon, which client, which language.
local function BaseFields(self)
    return
    {
        -- SpokenZones.VERSION does not exist -- Core.lua computes the real .toc version into
        -- the lowercase SpokenZones.version; "dev" is what a source checkout with no .toc
        -- metadata at all reads back as.
        { "addon", format("SpokenZones/%s", self.version or "dev") },
        { "build", format("%s/%s", (GetBuildInfo and select(1, GetBuildInfo())) or "?",
                                   (GetBuildInfo and select(2, GetBuildInfo())) or "?") },
        { "locale", (GetLocale and GetLocale()) or "enUS" },
        -- The language narration plays in, said outright so triage can see what the player
        -- was hearing beside what their client shows.
        { "pack", self:GetPackLanguage() },
    }
end

--- BaseFields and the place: the map, and its name as this client shows it.
local function PlaceFields(self, mapID)
    local fields = BaseFields(self)
    fields[#fields + 1] = { "map", mapID }
    local zone = self:GetMapName(mapID)
    if zone and zone ~= "" then
        fields[#fields + 1] = { "zone", zone }
    end
    return fields
end

--- The envelope for a place the panel is showing with no lore, or nil with no map to name.
---
--- The place the player is looking at, not where they stand: every zone and subzone is already
--- known, what is missing is what to say about it, and a player reading the map of a zone they
--- have been to can describe it from anywhere. The description itself is written on the
--- contribute page, which asks for it -- the client has nothing to hand over.
function SpokenZones:CaptureContribution(mapID, subzone)
    if not mapID then
        return nil
    end

    local fields = PlaceFields(self, mapID)
    -- Omitted rather than sent empty for the zone itself: the site keys a contribution on the
    -- map, or the map and the subzone, and an empty subzone is a key it would have to decide
    -- about.
    if subzone and subzone ~= "" then
        fields[#fields + 1] = { "subzone", subzone }
    end

    return Spoken.Contribute:Envelope("zones", fields, nil)
end

-- Compression belongs here, not in CaptureContribution: this runs once, on the click.
function SpokenZones:ShowContribution(mapID, subzone)
    local envelope = self:CaptureContribution(mapID, subzone)
    if not envelope then
        return
    end
    local address = format("%s/contribute", Spoken.SITE_URL)
    -- Encode is absent on an older Spoken; Link
    -- returns nil for that or for an oversized result, and the two-copy fallback still works.
    local link = Spoken.Contribute.Encode and Spoken.Contribute:Link(address, envelope)
    if link then
        Spoken:ShowContribution(link, address, true)
    else
        Spoken:ShowContribution(envelope, address)
    end
end

--- What a report carries beside its address: this client, and the place by name as it shows it.
---
--- `key`, not `subzone`: a subzone field is what a contribution is keyed on, and a report is
--- about lore that exists. The lore itself is ours, so it is not sent back.
function SpokenZones:ReportContext(mapID, areaKey)
    if not (mapID and _G.Spoken and Spoken.Contribute) then
        return nil
    end
    local fields = PlaceFields(self, mapID)
    if areaKey then
        fields[#fields + 1] = { "key", areaKey }
    end
    return Spoken.Contribute:Envelope("zones", fields, nil)
end

--- The report address for a place, with its context in the fragment. The bare address in the
--- popup under a Spoken too old to say more.
function SpokenZones:ShowReport(mapID, areaKey, language)
    local url = self:ReportURL(mapID, areaKey, language)
    if not url then
        return
    end
    if _G.Spoken and Spoken.ShowReport then
        Spoken:ShowReport(url, function()
            return self:ReportContext(mapID, areaKey)
        end)
        return
    end
    self:ShowCopyLink(url, self.L.OPT_REPORT_LINE_ADDRESS)
end
