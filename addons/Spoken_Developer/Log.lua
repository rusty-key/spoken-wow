-- The debug log: what Spoken and its modules did and why, kept for finding out afterwards why a
-- line played late, twice or not at all. On from the start, since the module is installed on
-- purpose; while turned off nothing is kept.
--
-- Kept in SpokenDeveloperDB (WTF\Account\<account>\SavedVariables\Spoken_Developer.lua), so it
-- survives a /reload and can be read straight out of that file. Each line is
-- "<GetTime> <category> <text>". This file writes the sessions and Spoken's queue as Spoken
-- reports it to every addon (queued, started, stopped, dropped, and why); Spoken and the
-- feature addons write the rest through Spoken:Log. Other logs, such as another computer's, can
-- be handed in to read beside this one, on one timeline.

local _, Developer = ...

local Log = { sources = {} }
Developer.Log = Log

-- Kept lines. A busy evening is a few hundred, so this is hours.
local MAX_LINES = 2000
Log.MAX_LINES = MAX_LINES
-- Trimmed in a batch this far past the limit: removing from the front moves every line.
local TRIM_SLACK = 200

function Log:IsOn()
	return Developer:DB().on == true
end

--- Record one line while the log is on. `message` is a format string when arguments follow.
function Log:Add(category, message, ...)
	local db = Developer:DB()
	if not db.on then return end
	local text = message
	if select("#", ...) > 0 then
		local ok, formatted = pcall(format, message, ...)
		text = ok and formatted or tostring(message)
	end
	local lines = db.lines
	lines[#lines + 1] = format("%.3f %s %s", GetTime(), tostring(category), tostring(text))
	if #lines > MAX_LINES + TRIM_SLACK then
		local keep = {}
		for i = #lines - MAX_LINES + 1, #lines do keep[#keep + 1] = lines[i] end
		db.lines = keep
	end
end

--- Who, which client and when, so two computers' logs can be laid side by side: the wall clock
--- that goes with this GetTime(). Then what Spoken plays for.
function Log:Session(how)
	local version, build = GetBuildInfo()
	local Spoken = _G.Spoken
	self:Add("session", "%s: %s, Spoken %s, Spoken Developer %s, client %s build %s", how or "start",
		Developer:PlayerName(), tostring(Spoken and Spoken.ADDON_VERSION), Developer.version,
		tostring(version), tostring(build))
	self:Add("session", "wall clock %s at GetTime %.3f", (date and date("%Y-%m-%d %H:%M:%S") or "?"), GetTime())
	local parts = {}
	if Spoken and Spoken.IterateSources then
		for key, source in Spoken:IterateSources() do
			parts[#parts + 1] = key .. " (" .. tostring(source.addon or "?") .. ")"
		end
	end
	self:Add("session", "modules: %s", #parts > 0 and table.concat(parts, ", ") or "none")
end

function Log:SetOn(on)
	local db = Developer:DB()
	on = on and true or false
	if db.on == on then return end
	if on then
		db.on = true
		self:Session("log on")
		if Developer.Copy then Developer.Copy:Snapshot("log on") end
	else
		self:Add("session", "log off")
		db.on = false
	end
	if Developer.RefreshOptions then Developer:RefreshOptions() end
end

--- The last `count` lines, oldest first (all of them without a count). A copy.
function Log:Lines(count)
	local lines = Developer:DB().lines
	local first = 1
	if count and count < #lines then first = #lines - count + 1 end
	local out = {}
	for i = first, #lines do out[#out + 1] = lines[i] end
	return out
end

function Log:Count()
	return #Developer:DB().lines
end

-- What the game writes around the lines: `SpokenDeveloperDB = {`, `["on"] = true,`,
-- `["lines"] = {`, the closing braces, and the mark a Write leaves.
local FILE_OVERHEAD = 64

--- About the room the log takes in Spoken_Developer.lua, in bytes, as the game writes it: each
--- line quoted, its backslashes, quotes and line breaks escaped, then a comma and the line end
--- (two bytes on Windows).
function Log:Bytes()
	local bytes = FILE_OVERHEAD
	for _, line in ipairs(Developer:DB().lines) do
		local _, escapes = line:gsub('[\\"\n]', "")
		bytes = bytes + #line + escapes + 5
	end
	return bytes
end

--- How many other players' logs the sources hold (Spoken Party Sync's, collected).
function Log:Others()
	local count = 0
	for _, source in ipairs(self.sources) do
		local ok, logs = pcall(source.list)
		if ok and type(logs) == "table" then count = count + #logs end
	end
	return count
end

--- Empty the log and what each source collected, so what follows reads as a test session of
--- its own; it starts with a session line (`how` says why).
function Log:Clear(how)
	Developer:DB().lines = {}
	for _, source in ipairs(self.sources) do
		if source.clear then pcall(source.clear) end
	end
	self:Session(how or "cleared")
	-- The Developer page's size, which is read again only when asked.
	if Developer.RefreshOptions then Developer:RefreshOptions() end
end

--------------------------------------------------------------------------------
-- Spoken's queue, as it reports it to every addon
--------------------------------------------------------------------------------

local function Describe(clip)
	if type(clip) ~= "table" then return tostring(clip) end
	local source = clip.source and clip.source.key or "?"
	return tostring(clip.key) .. " [" .. tostring(source) .. "]"
end
Log.Describe = Describe

function Log:Watch()
	local Spoken = Developer:Spoken()
	if self.watching or not Spoken then return end
	self.watching = true
	Spoken:RegisterCallback("CLIP_QUEUED", function(clip)
		local held = Spoken:GetHeldReason(clip)
		Log:Add("player", "queued %s, %d in queue%s%s", Describe(clip), Spoken:GetQueueSize(),
			held and (", held: " .. tostring(held)) or "",
			clip.title and (", " .. tostring(clip.title)) or "")
	end)
	Spoken:RegisterCallback("CLIP_STARTED", function(clip)
		Log:Add("player", "started %s, length %s%s", Describe(clip), tostring(clip and clip.length),
			Spoken.IsCaptionsOnly and Spoken:IsCaptionsOnly() and ", captions only" or "")
	end)
	Spoken:RegisterCallback("CLIP_STOPPED", function(clip, finished)
		Log:Add("player", "%s %s", finished and "finished" or "stopped", Describe(clip))
	end)
	Spoken:RegisterCallback("CLIP_DROPPED", function(clip, reason)
		Log:Add("player", "dropped %s: %s", Describe(clip), tostring(reason))
	end)
	local stopped
	Spoken:RegisterCallback("AUDIO_CHANGED", function()
		local now = Spoken:IsPaused() and true or false
		if now ~= stopped then
			if stopped ~= nil then Log:Add("player", now and "queue stopped" or "queue playing again") end
			stopped = now
		end
	end)
end

--------------------------------------------------------------------------------
-- Other logs, read beside this one
--------------------------------------------------------------------------------

--- `list()` returns { { name, lines, offset }, ... }, each on its own clock, `offset` mapping it
--- onto this one; `clear()`, if given, drops them when this log is cleared.
function Log:AddSource(list, clear)
	self.sources[#self.sources + 1] = { list = list, clear = clear }
end

--- This log and every source's, on this client's clock, oldest first, each line headed by whose
--- it is. `count` keeps the newest lines.
function Log:Merged(count)
	local rows = {}
	-- `n` keeps lines with the same time in the order they were written: many happen in one
	-- frame, and their order is often the very thing being looked for.
	local function AddAll(lines, who, offset, rank)
		for i, line in ipairs(lines) do
			local t, rest = line:match("^(%-?[%d%.]+) (.*)$")
			t = tonumber(t)
			if t then
				rows[#rows + 1] = { t = t + (offset or 0), who = who, text = rest, rank = rank, n = i }
			end
		end
	end
	AddAll(self:Lines(), Developer:PlayerName(), 0, 0)
	local rank = 0
	for _, source in ipairs(self.sources) do
		local ok, logs = pcall(source.list)
		if ok and type(logs) == "table" then
			for _, log in ipairs(logs) do
				rank = rank + 1
				AddAll(log.lines or {}, tostring(log.name or "?"), log.offset or 0, rank)
			end
		end
	end
	table.sort(rows, function(x, y)
		if x.t ~= y.t then return x.t < y.t end
		if x.rank ~= y.rank then return x.rank < y.rank end
		return x.n < y.n
	end)
	local first = 1
	if count and count < #rows then first = #rows - count + 1 end
	local out = {}
	for i = first, #rows do
		local row = rows[i]
		out[#out + 1] = format("%10.3f  %-16s %s", row.t, row.who, row.text)
	end
	return out
end
