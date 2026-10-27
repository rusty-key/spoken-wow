local _, NPCs = ...

-- The bosses' tab in Azeroth's Compendium is registered once the world is up, as the other
-- modules' are; the window itself is built the first time it is opened. A boss is met when its
-- fight starts or is won, or, where its fight may start no encounter, when it dies after it was targeted
-- or came into view.
local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("ENCOUNTER_START")
frame:RegisterEvent("ENCOUNTER_END")
frame:RegisterEvent("BOSS_KILL")
frame:RegisterEvent("PLAYER_TARGET_CHANGED")
frame:RegisterEvent("NAME_PLATE_UNIT_ADDED")
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
	elseif event == "BOSS_KILL" then
		-- Forever reports a won dungeon fight as ENCOUNTER_END with success 0; this event names the kill.
		NPCs:EncounterEnded(arg1, 1)
	elseif event == "PLAYER_TARGET_CHANGED" then
		NPCs:UnitSeen()
	elseif event == "NAME_PLATE_UNIT_ADDED" then
		NPCs:UnitSeen(arg1)
	else
		-- A reload mid-fight keeps the target without a change to report.
		NPCs:UnitSeen()
		if NPCs.SetupBosses then NPCs:SetupBosses() end
		if NPCs.SetupOptions then NPCs:SetupOptions() end
		self:UnregisterEvent("PLAYER_ENTERING_WORLD")
	end
end)
