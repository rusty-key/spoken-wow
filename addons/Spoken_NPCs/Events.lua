local _, NPCs = ...

-- The bosses' tab in Azeroth's Compendium is registered once the world is up, as the other
-- modules' are; the window itself is built the first time it is opened. A boss is met when its
-- fight starts.
local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("ENCOUNTER_START")
frame:RegisterEvent("ENCOUNTER_END")
frame:RegisterEvent("PLAYER_TARGET_CHANGED")
frame:SetScript("OnEvent", function(self, event, arg1, _, _, _, arg5)
	if event == "ADDON_LOADED" then
		-- Every addon's load fires this; the saved variables are read when this one's does.
		if arg1 == "Spoken_NPCs" then
			NPCs:InitDB()
			NPCs:SetupStories()
			self:UnregisterEvent("ADDON_LOADED")
		end
	elseif event == "ENCOUNTER_START" then
		NPCs:FoundEncounter(arg1)
	elseif event == "ENCOUNTER_END" then
		-- encounterID, name, difficulty, group size, success (1 when the boss died).
		NPCs:EncounterEnded(arg1, arg5)
	elseif event == "PLAYER_TARGET_CHANGED" then
		NPCs:TargetChanged()
	else
		if NPCs.SetupBosses then NPCs:SetupBosses() end
		if NPCs.SetupOptions then NPCs:SetupOptions() end
		self:UnregisterEvent("PLAYER_ENTERING_WORLD")
	end
end)
