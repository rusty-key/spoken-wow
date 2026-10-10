-- Spoken Developer -- tools for trying Spoken out, which a player never needs: the debug log,
-- the copies of it to send with a report, and the Developer page in Spoken's settings.
--
-- A module of its own, so it ships or not on its own. Spoken keeps no log itself: it offers a
-- place to register (Spoken:RegisterDeveloper, addons/Spoken/Developer.lua) and forwards what
-- feature addons write with Spoken:Log here. Without this module those calls do nothing.
--
-- Client targets: Classic Era 1.15.9 (11509), Anniversary 2.5.6 (20506) and Forever 1.60
-- (16001). Not the legacy 1.12/2.4.3/3.3.5 clients: their zips carry Spoken inside the quests
-- addon and nothing of this.

local ADDON_NAME, Developer = ...

local L = Developer.L

local GetAddOnMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata

Developer.name = ADDON_NAME
local version = GetAddOnMeta and GetAddOnMeta(ADDON_NAME, "Version")
Developer.version = (version and version ~= "") and version or "dev"

-- The API version this was written against.
local REQUIRED_API = 1

local function Defaults()
	return {
		-- On: the module is installed by whoever wants a log. Off from the page, the welcome
		-- window or /spoken log off.
		on = true,
		-- "<GetTime> <category> <text>", oldest first.
		lines = {},
	}
end

local fallback = Defaults()

function Developer:DB()
	return SpokenDeveloperDB or fallback
end

function Developer:InitDB()
	SpokenDeveloperDB = type(SpokenDeveloperDB) == "table" and SpokenDeveloperDB or {}
	for key, value in pairs(Defaults()) do
		if SpokenDeveloperDB[key] == nil then SpokenDeveloperDB[key] = value end
	end
	if type(SpokenDeveloperDB.lines) ~= "table" then SpokenDeveloperDB.lines = {} end
end

function Developer:Print(message, ...)
	local text = select("#", ...) > 0 and format(message, ...) or message
	DEFAULT_CHAT_FRAME:AddMessage("|cff66bbffSpoken Developer|r: " .. tostring(text))
end

--- Spoken, where it can take this module (Spoken:RegisterDeveloper); nil otherwise.
function Developer:Spoken()
	local api = _G.Spoken
	if api and api.IsCompatible and api:IsCompatible(REQUIRED_API) and api.RegisterDeveloper then
		return api
	end
	return nil
end

--- A size in bytes as a person reads it: 512 B, 9.6 KB, 96 KB, 1.2 MB.
function Developer.FormatBytes(bytes)
	bytes = tonumber(bytes) or 0
	if bytes < 1024 then return format("%d B", bytes) end
	local kb = bytes / 1024
	if kb < 10 then return format("%.1f KB", kb) end
	if kb < 1024 then return format("%d KB", math.floor(kb + 0.5)) end
	return format("%.1f MB", kb / 1024)
end

--- How much of the log is used and the room it takes: "1234 of 2000 lines, 96 KB", and the other
--- players' logs handed in, where there are any.
function Developer:SizeText()
	local Log = self.Log
	local text = format(L.LOG_SIZE_FMT, Log:Count(), Log.MAX_LINES, Developer.FormatBytes(Log:Bytes()))
	local others = Log:Others()
	if others > 0 then text = text .. format(L.LOG_SIZE_OTHERS_FMT, others) end
	return text
end

--- The character's whole name. Forever's UnitName answers the first name and the surname apart.
function Developer:PlayerName()
	return tostring(GetUnitName and GetUnitName("player") or UnitName("player"))
end

--- The frame to draw over: UIParent, or the top of `anchor`'s own frames where UIParent is hidden,
--- as it is while DialogueUI's window is open, so a menu or a box opened from a button on that
--- window shows over it.
function Developer:HostFor(anchor)
	if not anchor or (UIParent and UIParent:IsShown()) then return UIParent end
	local frame = anchor
	while frame.GetParent and frame:GetParent() and frame:GetParent() ~= UIParent do
		frame = frame:GetParent()
	end
	return frame
end
