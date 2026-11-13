setfenv(1, SpokenEnv)

-- What one client has and another lacks, written into the environment, never into _G, so
-- other addons see their own client and not ours. Loads last, so every table it patches
-- (Portrait) already exists.

-- Patch 11.0.2 removed the legacy global AddOn-management API. Current
-- Classic clients expose the same operations through C_AddOns, with the
-- character/addon argument order reversed for GetAddOnEnableState.
-- Kept private to Spoken's environment so other addons are not affected.
if C_AddOns then
    GetNumAddOns = GetNumAddOns or C_AddOns.GetNumAddOns
    GetAddOnInfo = GetAddOnInfo or C_AddOns.GetAddOnInfo
    GetAddOnMetadata = GetAddOnMetadata or C_AddOns.GetAddOnMetadata
    IsAddOnLoadOnDemand = IsAddOnLoadOnDemand or C_AddOns.IsAddOnLoadOnDemand
    LoadAddOn = LoadAddOn or C_AddOns.LoadAddOn
    EnableAddOn = EnableAddOn or C_AddOns.EnableAddOn
    DisableAddOn = DisableAddOn or C_AddOns.DisableAddOn

    if not GetAddOnEnableState and C_AddOns.GetAddOnEnableState then
        function GetAddOnEnableState(character, addon)
            if addon == nil then
                addon = character
                character = nil
            end
            return C_AddOns.GetAddOnEnableState(addon, character)
        end
    end

    if not IsAddOnLoaded and C_AddOns.IsAddOnLoaded then
        function IsAddOnLoaded(addon)
            local loadedOrLoading, loaded = C_AddOns.IsAddOnLoaded(addon)
            if loaded ~= nil then
                return loaded
            end
            return loadedOrLoading
        end
    end
end

-- Camelot's FrameXML no longer defines MouseIsOver. The global was only ever a
-- wrapper over Region:IsMouseOver with the same argument order, and that method is
-- on every client this addon runs on, so the wrapper is safe to restore ourselves.
if not MouseIsOver then
    function MouseIsOver(frame, topOffset, bottomOffset, leftOffset, rightOffset)
        return frame:IsMouseOver(topOffset, bottomOffset, leftOffset, rightOffset)
    end
end

-- Forever runs the modern engine and its HD models.
if Version.Variant == "forever" then
    function Portrait:GetCurrentModelSet()
        return "HD"
    end
end

if Version.Variant == "forever" then
    -- Camelot accepts SetCustomCamera and ignores it: the model keeps the default
    -- full-body framing, so the portrait showed the whole NPC standing in the box.
    -- SetPortraitZoom is the framing that client honours, and 1 is the head shot the
    -- M2's camera 0 used to give. Verified in the client on tauren male (122055).
    -- It frames the head on its own, so the model scale of 2 that the camera-0 clients
    -- need is undone here: with both, the face filled the box past its own edges.
    function Portrait:FrameHead(model)
        model:SetPortraitZoom(1)
        model:SetModelScale(1)
    end
end
