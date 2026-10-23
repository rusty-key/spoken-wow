local _, NPCs = ...

-- Spoken NPCs: the people of Azeroth and what is told of them, in Azeroth's Compendium. For now
-- the bosses of the dungeons and raids (UI/Bosses.lua).

_G.SpokenNPCs = NPCs

-- The module's icon.
NPCs.ICON = [[Interface\Icons\INV_Misc_Head_Dragon_01]]

local defaults = {
	-- Every boss openable, met or not (on Spoken's page); and the list leaving out those not met.
	unlockUnfound = false,
	compendiumFoundOnly = false,
	-- When a boss's story shows in Spoken's narrator: "target" when the player targets it, "kill" when
	-- it is killed.
	storyTrigger = "target",
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
	-- "map:key" of each boss whose story this character was shown in the narrator.
	SpokenNPCsCharacter.storiesRead = SpokenNPCsCharacter.storiesRead or {}
end

--- The Bosses page's Defaults: its settings back. What this character has met is kept, and so is
--- Unlock Unfound Bosses, which is on Spoken's page and reset from there.
function NPCs:ResetOptions()
	for key, value in pairs(defaults) do
		if key ~= "unlockUnfound" then SpokenNPCsSettings[key] = value end
	end
end

local function Key(map, key)
	return map .. ":" .. key
end

-- [encounter id] = { { map, key }, ... }, from Data/Bosses.lua, built on first use. A fight against
-- two bosses at once (the Weaver and Dreamscythe) is one encounter of both. onTarget["map:key"] =
-- true for a boss met when targeted, built alongside.
local byEncounter, onTarget
local function Encounters()
	if byEncounter then return byEncounter end
	byEncounter, onTarget = {}, {}
	for map, bosses in pairs(_G.SpokenBosses and SpokenBosses.maps or {}) do
		for _, boss in ipairs(bosses) do
			for _, id in ipairs(boss.ids) do
				byEncounter[id] = byEncounter[id] or {}
				table.insert(byEncounter[id], { map = map, key = boss.key })
			end
			if boss.onTarget then onTarget[Key(map, boss.key)] = true end
		end
	end
	return byEncounter
end

--- The bosses { map, key } of the game's encounter `encounterID`: none, one, or two fought at once.
function NPCs:BossesOfEncounter(encounterID)
	return encounterID and Encounters()[encounterID] or {}
end

--- Whether this character has met the boss `key` of the dungeon `map`.
function NPCs:IsBossFound(map, key)
	return SpokenNPCsCharacter ~= nil and SpokenNPCsCharacter.found[Key(map, key)] == true
end

-- The bosses { map, key } are met: noted, and the tab told. Returns whether one was not met before.
local function Meet(self, bosses)
	local new = false
	for _, boss in ipairs(bosses) do
		if not self:IsBossFound(boss.map, boss.key) then
			SpokenNPCsCharacter.found[Key(boss.map, boss.key)] = true
			new = true
		end
	end
	-- At a boss's pull: the list is drawn again only where it is seen, and opening it draws it.
	if new and self.bosses and self.bosses:IsVisible() then self:RefreshBosses() end
	return new
end

--- The bosses of the game's encounter `encounterID` are met. Returns whether one was a boss not
--- met before.
function NPCs:FoundEncounter(encounterID)
	local bosses = SpokenNPCsCharacter and encounterID and Encounters()[encounterID]
	return bosses and Meet(self, bosses) or false
end

--- The player targeted the boss `key` of `map`: met where it is one whose fight may start no
--- encounter (`onTarget` in Data/Bosses.lua), once it can be fought, as the Grim Guzzler's townsfolk
--- are only after a quest or a theft turns them. Returns whether it was not met before.
function NPCs:FoundTarget(map, key)
	if not SpokenNPCsCharacter or self:IsBossFound(map, key) then return false end
	Encounters()
	if not onTarget[Key(map, key)] then return false end
	if not (UnitCanAttack and Spoken.NotSecret(UnitCanAttack("player", "target"))) then return false end
	return Meet(self, { { map = map, key = key } })
end

--- The instance map the player is in, or nil.
function NPCs:InstanceMap()
	return GetInstanceInfo and Spoken.NotSecret((select(8, GetInstanceInfo()))) or nil
end
