local _, NPCs = ...

-- Spoken NPCs: the people of Azeroth and what is told of them, in Azeroth's Compendium. For now
-- the bosses of the dungeons and raids (UI/Bosses.lua).

_G.SpokenNPCs = NPCs

local defaults = {
	-- Every boss openable, met or not (on Spoken's page); and the list leaving out those not met.
	unlockUnfound = false,
	compendiumFoundOnly = false,
	-- A boss's spell cards under its story, on Spoken's page; off, the page has the story and portrait.
	showAbilities = false,
}

--- The settings and what this character has met. The settings are how the tab behaves, and the
--- account's; the bosses met are the character's, as the readables found are.
function NPCs:InitDB()
	SpokenNPCsSettings = SpokenNPCsSettings or {}
	for key, value in pairs(defaults) do
		if SpokenNPCsSettings[key] == nil then SpokenNPCsSettings[key] = value end
	end
	SpokenNPCsCharacter = SpokenNPCsCharacter or {}
	SpokenNPCsCharacter.found = SpokenNPCsCharacter.found or {}
end

local function Key(map, key)
	return map .. ":" .. key
end

-- [encounter id] = { map, key }, from Data/Bosses.lua, built on first use.
local byEncounter
local function Encounters()
	if byEncounter then return byEncounter end
	byEncounter = {}
	for map, bosses in pairs(_G.SpokenBosses and SpokenBosses.maps or {}) do
		for _, boss in ipairs(bosses) do
			for _, id in ipairs(boss.ids or { boss.id }) do byEncounter[id] = { map = map, key = boss.key } end
		end
	end
	return byEncounter
end

--- Whether this character has met the boss `key` of the dungeon `map`.
function NPCs:IsBossFound(map, key)
	return SpokenNPCsCharacter ~= nil and SpokenNPCsCharacter.found[Key(map, key)] == true
end

--- The boss of the game's encounter `encounterID` is met: noted, and the tab told. Returns whether
--- it was a boss not met before.
function NPCs:FoundEncounter(encounterID)
	local boss = SpokenNPCsCharacter and encounterID and Encounters()[encounterID]
	if not boss or self:IsBossFound(boss.map, boss.key) then return false end
	SpokenNPCsCharacter.found[Key(boss.map, boss.key)] = true
	if self.RefreshBosses then self:RefreshBosses() end
	return true
end
