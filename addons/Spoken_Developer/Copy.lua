-- The log with its diagnostics, to send with a report.
--
-- The diagnostics are what `/spoken diagnostics` and each module's own diagnostics say
-- (Spoken:Diagnostics), and they are written into the log itself as `diag` lines: at login,
-- when the log is turned on, at each copy, at each Write (Write.lua) and on `/spoken log diag`.
-- So the saved file says how things stood as well as what happened.
--
-- The copy is shown selected in the box (the game has no clipboard: Ctrl+A, Ctrl+C): the
-- diagnostics, then the whole log. An AI agent on the player's computer reads the saved file
-- instead, once Write has had the game write it.

local _, Developer = ...

local L = Developer.L
local Log = Developer.Log

local Copy = {}
Developer.Copy = Copy

local function Diagnostics(detailed)
	local Spoken = Developer:Spoken()
	if not (Spoken and Spoken.Diagnostics) then
		return { "Spoken is missing or too old to say how it stands" }
	end
	local ok, lines = pcall(Spoken.Diagnostics, Spoken, detailed)
	if not ok then return { "diagnostics error: " .. tostring(lines) } end
	return lines
end
Copy.Diagnostics = Diagnostics

--- Write the diagnostics into the log as `diag` lines, while it is on. `why` heads the block.
--- Detailed: an agent reading the saved log has nothing else to tell whether Read Automatically
--- was on or which window was open.
function Copy:Snapshot(why)
	if not Log:IsOn() then return end
	Log:Add("diag", "%s:", why or "diagnostics")
	for _, line in ipairs(Diagnostics(true)) do
		Log:Add("diag", "  %s", line)
	end
	-- Some thirty lines more: the Developer page's size says so, the page's Copy among the callers.
	if Developer.RefreshOptions then Developer:RefreshOptions() end
end

--- The text of a copy. Returns it and how many log lines it holds.
function Copy:Text()
	local out = {}
	local function Add(line) out[#out + 1] = line end
	local stamp = format("%s, GetTime %.3f", (date and date("%Y-%m-%d %H:%M:%S") or "?"), GetTime())
	Add("=== Spoken diagnostics, " .. stamp .. " ===")
	for _, line in ipairs(Diagnostics(false)) do Add(line) end
	local lines = Log:Merged()
	Add("")
	Add(format("=== Debug log, %d lines ===", #lines))
	for _, line in ipairs(lines) do Add(line) end
	if not Log:IsOn() then
		Add("")
		Add("(The debug log is off: nothing new is kept. Spoken > Developer > Enable Debug Log Recording.)")
	end
	return table.concat(out, "\n"), #lines
end

--- Snapshot, then the copy in the box, selected. Returns how many log lines it holds.
function Copy:Show(anchor)
	self:Snapshot("copied")
	local text, count = self:Text()
	Developer.Box:Show(text, L.BOX_TITLE_COPY, anchor)
	return count
end
