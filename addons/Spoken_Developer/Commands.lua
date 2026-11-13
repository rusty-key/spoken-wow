-- `/spoken log ...`: Spoken hands the words after `log` to this module (Spoken's Core.lua), so the
-- log is reached from the command players already know. Chat stays English, as in every Spoken
-- addon.
--
-- And the provider: the functions Spoken calls (addons/Spoken/Developer.lua says which).

local _, Developer = ...

local L = Developer.L
local Log, Copy, Box, Menu, Write = Developer.Log, Developer.Copy, Developer.Box, Developer.Menu, Developer.Write

local USAGE = "/spoken log [count] | log copy | log write | log on | log off | log clear | log diag"
local FILE = "WTF\\Account\\<account>\\SavedVariables\\Spoken_Developer.lua"

--- The log, merged with any handed in, in the box. Returns how many lines it shows.
local function ShowLog(count, anchor)
	local lines = Log:Merged(count)
	Box:Show(table.concat(lines, "\n"), L.LOG_BOX_TITLE, anchor)
	return #lines
end
Developer.ShowLog = ShowLog

function Developer:Command(rest)
	rest = strtrim((rest or ""):lower())
	if rest == "on" or rest == "off" then
		Log:SetOn(rest == "on")
		self:Print(rest == "on" and "debug log on: /spoken log shows it, right-click Report copies it" or "debug log off")
	elseif rest == "clear" then
		Log:Clear()
		self:Print("debug log cleared; a new session starts")
	elseif rest == "copy" then
		local count = Copy:Show()
		self:Print("%d log lines and the diagnostics, selected: Ctrl+C to copy", count)
	elseif rest == "write" then
		-- An addon's command cannot reload: the snapshot, then /reload typed in for the next Enter.
		Write:Now()
	elseif rest == "diag" then
		if Log:IsOn() then
			Copy:Snapshot("asked")
			self:Print("the diagnostics are in the log")
		else
			self:Print("the debug log is off: /spoken log on")
		end
	elseif rest == "" or tonumber(rest) then
		local shown = ShowLog(tonumber(rest))
		self:Print("%d log lines shown (%s); /spoken log write puts them in %s for an AI agent%s", shown,
			self:SizeText(), FILE, Log:IsOn() and "" or " (the log is off: /spoken log on)")
	else
		self:Print(USAGE)
	end
end

--- One line for `/spoken diagnostics`.
function Developer:Describe()
	if Log:IsOn() then
		return format("debug log on, %d lines, %s (Spoken Developer %s)", Log:Count(),
			Developer.FormatBytes(Log:Bytes()), self.version)
	end
	return format("debug log off (Spoken Developer %s; Spoken > Developer, or /spoken log on)", self.version)
end

Developer.provider = {
	Log = function(category, text) Log:Add(category, "%s", text) end,
	IsLogOn = function() return Log:IsOn() end,
	SetLogOn = function(on) Log:SetOn(on) end,
	Lines = function(count) return Log:Lines(count) end,
	Clear = function(how) Log:Clear(how) end,
	Show = function(count) return ShowLog(count) end,
	AddSource = function(list, clear) Log:AddSource(list, clear) end,
	ShowMenu = function(anchor) return Menu:Show(anchor) end,
	MenuHint = function() return Menu:Hint() end,
	SwitchLabel = function() return L.OPT_LOG_KEEP end,
	SwitchTip = function() return L.WELCOME_LOG_TIP end,
	Command = function(rest) Developer:Command(rest) end,
	Describe = function() return Developer:Describe() end,
}
