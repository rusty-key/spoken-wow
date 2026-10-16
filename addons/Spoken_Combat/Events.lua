local name, Combat = ...

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function(_, event, addon)
    if event == "ADDON_LOADED" and addon == name then Combat:Setup()
    elseif event == "PLAYER_LOGIN" then Combat:SetupOptions() end
end)
