local _, Bosses = ...

-- Spoken Bosses: the bosses of the dungeons and raids and their stories, in Azeroth's Compendium
-- (UI/Bosses.lua).

_G.SpokenBossesAddon = Bosses

-- The module's icon.
Bosses.ICON = [[Interface\Icons\INV_Misc_Head_Dragon_01]]

local defaults = {
	-- Every boss openable, met or not (on Spoken's page); and the list leaving out those not met.
	unlockUnfound = false,
	compendiumFoundOnly = true,
}

--- The settings and what this character has met. The settings are how the tab behaves, and the
--- account's; the bosses met are the character's, as the readables found are.
function Bosses:InitDB()
	SpokenBossesSettings = SpokenBossesSettings or {}
	for key, value in pairs(defaults) do
		if SpokenBossesSettings[key] == nil then SpokenBossesSettings[key] = value end
	end
	-- A Found Only saved off before it was on by default would read as the player's choice: turned
	-- on once behind this marker. An off set after that is kept.
	if not SpokenBossesSettings.foundOnlyDefaultOn then
		SpokenBossesSettings.foundOnlyDefaultOn = true
		SpokenBossesSettings.compendiumFoundOnly = true
	end
	SpokenBossesCharacter = SpokenBossesCharacter or {}
	SpokenBossesCharacter.found = SpokenBossesCharacter.found or {}
	-- "map:key" of each boss whose story this character was shown in the narrator.
	SpokenBossesCharacter.storiesRead = SpokenBossesCharacter.storiesRead or {}
end

--- The Bosses page's Defaults: its settings back. What this character has met is kept, and so is
--- Unlock Unfound Bosses, which is on Spoken's page and reset from there.
function Bosses:ResetOptions()
	for key, value in pairs(defaults) do
		if key ~= "unlockUnfound" then SpokenBossesSettings[key] = value end
	end
end

--- How the boss `key` of `map` is filed in what a character has met and been told: "map:key".
function Bosses.Key(map, key)
	return map .. ":" .. key
end
local Key = Bosses.Key

-- [encounter id] = { { map, key }, ... }, from Data/Bosses.lua, built on first use. A fight against
-- two bosses at once (the Weaver and Dreamscythe) is one encounter of both.
local byEncounter
local function Encounters()
	if byEncounter then return byEncounter end
	byEncounter = {}
	for map, bosses in pairs(_G.SpokenBosses and SpokenBosses.maps or {}) do
		for _, boss in ipairs(bosses) do
			for _, id in ipairs(boss.ids) do
				byEncounter[id] = byEncounter[id] or {}
				table.insert(byEncounter[id], { map = map, key = boss.key })
			end
		end
	end
	return byEncounter
end

--- The bosses { map, key } of the game's encounter `encounterID`: none, one, or two fought at once.
function Bosses:BossesOfEncounter(encounterID)
	return encounterID and Encounters()[encounterID] or {}
end

--- Whether this character has met the boss `key` of the dungeon `map`.
function Bosses:IsBossFound(map, key)
	return SpokenBossesCharacter ~= nil and SpokenBossesCharacter.found[Key(map, key)] == true
end

-- The bosses { map, key } are met: noted, and the tab told. Returns whether one was not met before.
local function Meet(self, bosses)
	local new = false
	for _, boss in ipairs(bosses) do
		if not self:IsBossFound(boss.map, boss.key) then
			SpokenBossesCharacter.found[Key(boss.map, boss.key)] = true
			new = true
		end
	end
	-- The list is drawn again only where it is seen, and opening it draws it.
	if new and self.bosses and self.bosses:IsVisible() then self:RefreshBosses() end
	return new
end

--- The bosses of the game's encounter `encounterID` are met. Returns whether one was a boss not
--- met before.
function Bosses:FoundEncounter(encounterID)
	local bosses = SpokenBossesCharacter and encounterID and Encounters()[encounterID]
	return bosses and Meet(self, bosses) or false
end

--- The boss `key` of `map` is met. Returns whether it was not met before.
function Bosses:FoundBoss(map, key)
	if not SpokenBossesCharacter then return false end
	return Meet(self, { { map = map, key = key } })
end

--- The instance map the player is in, or nil.
function Bosses:InstanceMap()
	return GetInstanceInfo and Spoken.NotSecret((select(8, GetInstanceInfo()))) or nil
end
