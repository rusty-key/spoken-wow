-- Optional dungeon and boss stories beside OpenMap's dungeon maps. Blizzard's own dungeon map
-- (OpenMap's stitched map off) comes through OpenMapAPI's DungeonMapShown callback. OpenMap's own
-- dungeon view and its boss rows have no public API: the view is the global OpenMapDungeonView,
-- holding the instance shown as `inst` ({ instanceID, name }), and each row keeps the item it was
-- drawn from (`item[1]`: "N.  Boss name").

local _, Bosses = ...
local M = Bosses.MapLore
local BossName, BossNameKey, DungeonInstanceByName, Found = M.BossName, M.BossNameKey, M.DungeonInstanceByName, M.Found
local CurrentMapID = M.CurrentMapID

-- What DungeonMapShown last reported, while Blizzard's dungeon map is up.
local currentInfo
-- The instance whose map is up, in either way OpenMap shows it.
local activeDungeonID

-- The instance of an OpenMap `inst`: 0 for one missing from OpenMap's tables (WoW Forever's own
-- dungeons), which only its name identifies.
local function InstanceOf(inst)
	if type(inst) ~= "table" then return end
	local id = tonumber(inst[1])
	if id and id > 0 then return id end
	return DungeonInstanceByName(inst[2])
end

-- On Blizzard's map of several instances (Blackrock Mountain), the one whose list has the boss.
local function InstanceListing(bossName)
	if type(currentInfo) ~= "table" or type(currentInfo.instances) ~= "table" then return end
	local wanted = BossNameKey(bossName)
	for _, instance in ipairs(currentInfo.instances) do
		for _, name in ipairs(instance.bosses or {}) do
			if BossNameKey(name) == wanted then return DungeonInstanceByName(instance.name) end
		end
	end
end

-- The boss of a row: in the dungeon shown, by name, else by its place in the list, as OpenMap
-- numbers its rows in the order Spoken lists them; with no dungeon known, a name no other
-- dungeon shares.
local function BossFor(bossName, bossIndex)
	local wanted = BossNameKey(bossName)
	if not wanted then return end
	local instanceID = InstanceListing(bossName) or activeDungeonID
	if instanceID then
		local bosses = _G.SpokenBosses and SpokenBosses.maps[instanceID] or {}
		for _, boss in ipairs(bosses) do
			if BossNameKey(BossName(boss)) == wanted then return Found(instanceID, boss) end
		end
		local boss = bossIndex and bosses[bossIndex]
		return boss and Found(instanceID, boss) or nil
	end
	return M.BossByName(wanted)
end

local function ShowDungeon(instanceID, again)
	if activeDungeonID == instanceID and not again then return end
	activeDungeonID = instanceID
	if instanceID then M.ShowDungeon(CurrentMapID(), instanceID) end
end

function Bosses:ShowOpenMapBoss(bossName, bossIndex)
	local found = BossFor(bossName, bossIndex)
	return found ~= nil and M.ShowBoss(CurrentMapID(), found)
end

local function RowBossName(item)
	if type(item) ~= "table" or item.kind ~= "row" or type(item[1]) ~= "string" then return end
	local text = item[1]:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
	local index, name = text:match("^%s*(%d+)%.%s+(.+)$")
	return name, tonumber(index)
end

local function RowItem(frame)
	local ok, item = pcall(function() return frame.item end)
	return ok and item or nil
end

local hooked = setmetatable({}, { __mode = "k" })
local view
local ScanView

local function OnRowClick(self, button)
	if button ~= "LeftButton" then return end
	local name, index = RowBossName(RowItem(self))
	if name then Bosses:ShowOpenMapBoss(name, index) end
end

-- Hooks the boss rows under `parent`, and its other buttons to look again once a click has filled
-- the list: OpenMap draws rows from a pool as a tab opens.
local function Scan(parent)
	if not hooked[parent] and parent.HookScript then
		local item = RowItem(parent)
		if type(item) == "table" and item.kind == "row" then
			hooked[parent] = true
			parent:HookScript("OnClick", OnRowClick)
		elseif parent.GetObjectType and parent:GetObjectType() == "Button" then
			hooked[parent] = true
			parent:HookScript("OnClick", ScanView)
		end
	end
	if not parent.GetChildren then return end
	local ok, children = pcall(function() return { parent:GetChildren() } end)
	if not ok then return end
	for _, child in ipairs(children) do Scan(child) end
end

local pending
ScanView = function()
	if pending or not view then return end
	pending = true
	C_Timer.After(0, function()
		pending = nil
		if not view:IsShown() then return end
		Scan(view)
		-- The side panel's tabs hang off the map, past the view's edge.
		if type(view.sideTabs) == "table" then Scan(view.sideTabs) end
	end)
end

-- The view is opened again on another instance without hiding (OpenMap calls Show on it as it is),
-- which fires no OnShow: Show itself is hooked too.
local function ViewShown()
	ShowDungeon(InstanceOf(view.inst))
	ScanView()
end

local events = CreateFrame("Frame")

local function ClearDungeon()
	activeDungeonID = nil
	M.ClearStory()
end

-- OpenMap builds its view the first time a dungeon is opened.
local function FindView()
	local frame = _G.OpenMapDungeonView
	if view or not frame or not frame.HookScript then return end
	view = frame
	events:UnregisterEvent("GLOBAL_MOUSE_UP")
	frame:HookScript("OnShow", ViewShown)
	if hooksecurefunc then hooksecurefunc(frame, "Show", ViewShown) end
	frame:HookScript("OnHide", ClearDungeon)
	if frame:IsShown() then ViewShown() end
end

function Bosses:OpenMapDungeonMapShown(_, info)
	currentInfo = info
	local instance = type(info) == "table" and type(info.instances) == "table" and info.instances[1]
	ShowDungeon(instance and DungeonInstanceByName(instance.name), true)
end

function Bosses:OpenMapDungeonMapHidden()
	currentInfo = nil
	ClearDungeon()
end

local function OpenMapLoaded()
	if C_AddOns and C_AddOns.IsAddOnLoaded then return C_AddOns.IsAddOnLoaded("OpenMap") end
	return IsAddOnLoaded and IsAddOnLoaded("OpenMap") or false
end

local setup
local function Setup()
	if setup or not OpenMapLoaded() then return end
	setup = true
	if _G.OpenMapAPI and OpenMapAPI.RegisterCallback then
		-- CallbackHandler calls a method by name as self:method(event, ...).
		OpenMapAPI.RegisterCallback(Bosses, "OpenMap_DungeonMapShown", "OpenMapDungeonMapShown")
		OpenMapAPI.RegisterCallback(Bosses, "OpenMap_DungeonMapHidden", "OpenMapDungeonMapHidden")
	end
	FindView()
	if not view then events:RegisterEvent("GLOBAL_MOUSE_UP") end
end

events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("ADDON_LOADED")
events:SetScript("OnEvent", function(_, event, addon)
	if event == "GLOBAL_MOUSE_UP" then
		-- After OpenMap's own click handler, which builds the view.
		C_Timer.After(0, FindView)
	elseif event == "PLAYER_ENTERING_WORLD" or addon == "OpenMap" then
		Setup()
	end
end)
