local _, NPCs = ...

-- A boss's story in Spoken's narrator, as words with no voice, once per character: when the
-- player targets the boss, or when it is killed (Show a Boss's Story, on the Bosses page).

local L = NPCs.L
local ICON = [[Interface\Icons\INV_Misc_Head_Dragon_01]]

local source

-- [creature id] = { map, key }, from Data/Creatures.lua, built on first use.
local byCreature
local function Creatures()
	if byCreature then return byCreature end
	byCreature = {}
	for map, bosses in pairs(_G.SpokenBossCreatures or {}) do
		for key, entry in pairs(bosses) do
			if entry.creature then byCreature[entry.creature] = { map = map, key = key } end
		end
	end
	return byCreature
end

--- The creature id in a unit's GUID ("Creature-0-1-2-3-<id>-..."), or nil for a player, a pet or
--- a GUID the client keeps secret.
local function CreatureID(guid)
	guid = Spoken.NotSecret and Spoken.NotSecret(guid) or nil
	if type(guid) ~= "string" then return nil end
	local kind, id = guid:match("^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)")
	if kind ~= "Creature" and kind ~= "Vehicle" then return nil end
	return tonumber(id)
end

--- Registers the bosses' stories with Spoken as a part of its own, after the settings are read.
function NPCs:SetupStories()
	if source or not (Spoken and Spoken.RegisterSource and Spoken.ShowsNarratorFor) then return end
	source = Spoken:RegisterSource("bosses", {
		title = L.OPT_PAGE_TITLE,
		addon = "Spoken_NPCs",
		icon = ICON,
		about = L.PART_ABOUT,
		order = 5,
		textOnly = true,
	})
end

--- Shows the story of the boss `key` of `map` in the narrator. Nothing when this character has
--- been shown it, the narrator would not show it, or the boss has none. Returns whether it queued.
function NPCs:ReadStory(map, key)
	if not (source and SpokenNPCsCharacter) then return false end
	local id = map .. ":" .. key
	if SpokenNPCsCharacter.storiesRead[id] or not Spoken:ShowsNarratorFor("bosses") then return false end
	local clip = self:StoryClip(map, key)
	if not clip then return false end
	local queued = source:Enqueue(clip)
	if queued then SpokenNPCsCharacter.storiesRead[id] = true end
	return queued and true or false
end

--- The player targeted a unit: its story, where it is a boss and targeting shows them.
function NPCs:TargetChanged()
	if not (SpokenNPCsSettings and SpokenNPCsSettings.storyTrigger == "target") then return end
	local id = CreatureID(UnitGUID and UnitGUID("target"))
	if not id then return end
	-- A boss only Forever has is not among Data/Creatures.lua's: known by its name in the dungeon
	-- the player is in.
	local boss = Creatures()[id] or self:BossNamed(Spoken.NotSecret(UnitName and UnitName("target")))
	if boss then self:ReadStory(boss.map, boss.key) end
end

--- An encounter ended: its boss's story, where it was killed and killing shows them.
function NPCs:EncounterEnded(encounterID, success)
	if not (SpokenNPCsSettings and SpokenNPCsSettings.storyTrigger == "kill") or success ~= 1 then return end
	local boss = self:BossOfEncounter(encounterID)
	if boss then self:ReadStory(boss.map, boss.key) end
end

--- Every story this character was shown can be shown again. Returns how many.
function NPCs:ForgetStories()
	local count = 0
	for _ in pairs(SpokenNPCsCharacter and SpokenNPCsCharacter.storiesRead or {}) do count = count + 1 end
	if SpokenNPCsCharacter then SpokenNPCsCharacter.storiesRead = {} end
	return count
end
