-- The login that wires the module up. It registers with Spoken as this file loads, before the
-- world is entered, so Spoken's welcome window, built at login, already offers the log.

local ADDON_NAME, Developer = ...

local Log, Copy, Write = Developer.Log, Developer.Copy, Developer.Write

-- After the modules have loaded their voice packs, about a second after entering the world, so
-- the snapshot at login says what they found.
local SNAPSHOT_DELAY = 3

local Spoken = Developer:Spoken()
if Spoken then
	Spoken:RegisterDeveloper(Developer.provider)
end

local started = false

local function Start()
	started = true
	if not Developer:Spoken() then
		Developer:Print("|cffffcc00Spoken is missing or too old: there is nothing to log.|r")
		return
	end
	Log:Watch()
	if Log:IsOn() then Log:Session("start") end
	Write:Announce()
	Developer:SetupOptions()
	C_Timer.After(SNAPSHOT_DELAY, function() Copy:Snapshot("login") end)
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:SetScript("OnEvent", function(_, event, name)
	if event == "ADDON_LOADED" and name == ADDON_NAME then
		Developer:InitDB()
	elseif event == "PLAYER_ENTERING_WORLD" and not started then
		Start()
	end
end)
Developer.eventFrame = frame
