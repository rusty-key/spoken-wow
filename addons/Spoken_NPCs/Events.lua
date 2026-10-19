local _, NPCs = ...

-- The bosses' tab in Azeroth's Compendium is registered once the world is up, as the other
-- modules' are; the window itself is built the first time it is opened. A boss is met when its
-- fight starts.
local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("ENCOUNTER_START")
frame:SetScript("OnEvent", function(self, event, arg1)
	if event == "ADDON_LOADED" then
		-- Every addon's load fires this; the saved variables are read when this one's does.
		if arg1 == "Spoken_NPCs" then
			NPCs:InitDB()
			self:UnregisterEvent("ADDON_LOADED")
		end
	elseif event == "ENCOUNTER_START" then
		NPCs:FoundEncounter(arg1)
	else
		if NPCs.SetupBosses then NPCs:SetupBosses() end
		self:UnregisterEvent("PLAYER_ENTERING_WORLD")
	end
end)
