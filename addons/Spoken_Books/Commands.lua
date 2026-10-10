-- /spokenbooks and /spb, matching /spoken and /sp on the player, /spokenquests and /spq,
-- and /spokenzones and /spz.

local ADDON_NAME, SpokenBooks = ...

local function Print(message, ...)
	local text = select("#", ...) > 0 and format(message, ...) or message
	DEFAULT_CHAT_FRAME:AddMessage("|cff80c0ffSpoken Books|r: " .. text)
end

SpokenBooks.Print = function(self, message, ...) Print(message, ...) end

local function Toggle(key, label)
	SpokenBooksSettings[key] = not SpokenBooksSettings[key]
	Print("%s %s", label, SpokenBooksSettings[key] and "enabled" or "disabled")
end

--- Read the page in front of the reader, or say why nothing happened.
---
--- Deliberate, so it works with autoplay off: that is the whole point of the setting, and a
--- command that respected it would leave no way to start narration.
---
function SpokenBooks:ReadOrExplain()
	if self:ReadCurrent() > 0 then
		return
	end
	local pageId = self:PageOnScreen() or self.lastPage
	if not pageId then
		Print("nothing to read -- open a book first")
	elseif not self:HasAudio(pageId) then
		Print(self:DescribeMissingAudio())
	elseif not self.source then
		Print("nothing can read it -- Spoken Books reads through Spoken, which is not installed")
	elseif not self:IsQueued(pageId) then
		Print("Spoken did not take this page")
	elseif Spoken:IsPaused() then
		Print("this page is waiting -- Spoken is stopped; press Replay to carry on")
	else
		Print("already reading this page")
	end
end

local function Status()
	local data = SpokenBooks:Data()
	local books, pages = 0, 0
	for _ in pairs(data and data.books or {}) do books = books + 1 end
	for _ in pairs(data and data.pages or {}) do pages = pages + 1 end

	local packs = SpokenBooks:GetAudioPacks()
	local clips = 0
	for _, pack in ipairs(packs) do
		for _ in pairs(pack.pages) do clips = clips + 1 end
	end

	Print("%d books, %d pages known; %d narrated by %d pack%s", books, pages, clips,
		#packs, #packs == 1 and "" or "s")
	local read = 0
	for _ in pairs(SpokenBooksCharacter and SpokenBooksCharacter.read or {}) do read = read + 1 end

	Print("autoplay %s, whole book %s, read once %s",
		SpokenBooksSettings.autoplay and "on" or "off",
		SpokenBooksSettings.readWholeBook and "on" or "off",
		SpokenBooksSettings.readOnce and "on" or "off")
	Print("gathering %s", SpokenBooks:GatherAvailable() and (Spoken.Gather:IsEnabled() and "on" or "off") or "unavailable")
	-- Said whether or not read-once is on, because the count is what makes `/spb forget`
	-- make sense, and because a reader turning the setting on wants to know what it will
	-- already consider read.
	Print("%d book%s read on this character", read, read == 1 and "" or "s")
	if #packs == 0 then
		Print(SpokenBooks:DescribeMissingAudio())
	end
end

--- What /spb status prints, for the settings' Show Diagnostics.
function SpokenBooks:ShowStatus()
	Status()
end

--- A page every installed pack has, played the way a real one is, to check it can be heard.
function SpokenBooks:PlayTestLine()
	for _, pack in ipairs(self:GetAudioPacks()) do
		local pageId = next(pack.pages)
		if pageId then
			-- One page, queued as a real one plays: not PlayFrom, which marks the book read and
			-- with Read Whole Book on lines up the rest of it.
			local clip = self.source and self:ClipFor(pageId)
			if clip and self.source:Enqueue(clip) then
				Print("playing a test page")
			else
				Print("|cffffcc00the test page could not be queued|r")
			end
			return
		end
	end
	Print(self:DescribeMissingAudio())
end

_G.SLASH_SPOKENBOOKS1 = "/spokenbooks"
_G.SLASH_SPOKENBOOKS2 = "/spb"
SlashCmdList["SPOKENBOOKS"] = function(msg)
	local cmd = string.lower(msg or "")
	cmd = string.match(cmd, "^%s*(%S*)") or ""

	if cmd == "autoplay" then
		Toggle("autoplay", "autoplay")
	elseif cmd == "whole" or cmd == "book" then
		Toggle("readWholeBook", "reading the whole book")
	elseif cmd == "once" then
		Toggle("readOnce", "reading each book only once")
	elseif cmd == "gather" then
		if SpokenBooks:GatherAvailable() then
			Spoken.Gather:SetEnabled(not Spoken.Gather:IsEnabled())
			Print("gathering %s", Spoken.Gather:IsEnabled() and "enabled" or "disabled")
		else
			Print("gathering is unavailable -- this version of Spoken has no background gathering")
		end
	elseif cmd == "forget" then
		local count = SpokenBooks:ForgetRead()
		Print("forgot %d book%s; they will be read again", count, count == 1 and "" or "s")
	elseif cmd == "settings" or cmd == "options" then
		-- Guarded because UI/Options.lua is the one file here that a client can do without:
		-- everything it offers is also a command on this list.
		if SpokenBooks.OpenOptions then
			SpokenBooks:OpenOptions()
		else
			Print("no settings panel on this client -- type /spb for the commands")
		end
	elseif cmd == "compendium" or cmd == "readables" then
		if SpokenBooks.ShowReadables then
			SpokenBooks:ShowReadables()
		else
			Print("no Compendium on this client")
		end
	elseif cmd == "read" or cmd == "play" then
		SpokenBooks:ReadOrExplain()
	elseif cmd == "stop" then
		SpokenBooks:StopReading()
		Print("stopped")
	elseif cmd == "status" then
		Status()
	elseif cmd == "debug" then
		Toggle("debug", "explaining in chat why a page was or was not read")
	else
		Print("/spb read | stop | autoplay | whole | once | gather | forget | compendium | settings | status | debug")
	end
end
