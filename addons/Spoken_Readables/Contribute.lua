-- A page this corpus does not carry, as something that can be sent.
--
-- The gap is a page whose words the corpus does not have: one Reader.lua's PageOnScreen
-- answers with nil, or with a page it only told by what opened it or by most of its words.
-- On a 1.12-derived corpus that is every post-vanilla book, every locale but one, custom
-- text a server added itself, and a page the server lays out or words its own way.
--
-- MAIL NEVER LEAVES THE CLIENT. IsMail is already how the reader refuses to narrate a letter,
-- and the reason is stronger here: a letter is a player's own words to another player, and
-- this is the one path in the addon that would put them on a server of ours.
--
-- `page` is the client-side checksum, of the page with the reader's name, class and race put
-- back as tokens, not a pageTextID. The frozen id `b:{pageTextID}` names a
-- page the corpus has; a page it has never seen has no id to be named by, and gets one only if
-- triage accepts it.

local ADDON_NAME, SpokenReadables = ...

-- A value the game hands over as a secret, in an instance or in combat, reads as nil.
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

--- Whether the Spoken folder beside this addon has what Detemplate calls. An older one does not,
--- and a player on it has no contribute button rather than an error.
local function CoreIsCurrent()
	local contribute = _G.Spoken and Spoken.Contribute
	return contribute and contribute.NameWords and contribute.ReplaceWord and true or false
end

--- The fields every readables envelope starts with: which addon, which client, which language.
local function BaseFields(self)
	return
	{
		{ "addon", format("%s/%s", ADDON_NAME, self.version or "dev") },
		{ "build", format("%s/%s", (GetBuildInfo and select(1, GetBuildInfo())) or "?",
		                           (GetBuildInfo and select(2, GetBuildInfo())) or "?") },
		-- The client's, because the page is as the client shows it. The packs' language goes
		-- beside it, so triage can see what the player was hearing.
		{ "locale", (GetLocale and GetLocale()) or "enUS" },
		{ "pack", self:GetPackLanguage() },
		{ "packVersion", self:GetPackVersion(self:GetPackLanguage()) },
	}
end

--- The page with this character's name, class and race put back as the game's tokens, as
--- Spoken_Quests/Contribute.lua's Detemplate does for quest text. The client writes them into
--- a page, and a page sent as it was shown would carry the player's name to the site. $G
--- cannot be undone: the other side of the branch is not on screen.
function SpokenReadables:Detemplate(text)
	local swaps = {}
	local function add(word, token)
		if type(word) == "string" and word ~= "" then
			swaps[#swaps + 1] = { word, token }
		end
	end
	local function addCased(word, upper, lower)
		add(word, upper)
		if type(word) == "string" and string.lower(word) ~= word then
			add(string.lower(word), lower)
		end
	end

	-- Whole or by one part of it, as written or in capitals: a page greets its reader "GRIMBALOR,".
	-- Sorted with the class and race below.
	for _, word in ipairs(Spoken.Contribute:NameWords(UnitName and UnitName("player"))) do
		add(word, "$N")
	end
	if UnitClass then
		local localized, classFile = UnitClass("player")
		addCased(localized, "$C", "$c")
		-- A locale that names a class by gender may write the other form.
		for _, names in ipairs({ _G.LOCALIZED_CLASS_NAMES_MALE or {}, _G.LOCALIZED_CLASS_NAMES_FEMALE or {} }) do
			addCased(classFile and names[classFile], "$C", "$c")
		end
	end
	if UnitRace then
		addCased((UnitRace("player")), "$R", "$r")
	end

	-- Longest first, so "Night Elf" goes as one race before a shorter word inside it.
	table.sort(swaps, function(a, b) return string.len(a[1]) > string.len(b[1]) end)
	for _, pair in ipairs(swaps) do
		text = Spoken.Contribute:ReplaceWord(text, pair[1], pair[2])
	end
	return text
end

--- The envelope for the page on screen, or nil when there is nothing to send.
function SpokenReadables:CaptureContribution()
	if not CoreIsCurrent() or self:IsMail() then
		return nil
	end

	local text = ItemTextGetText and NotSecret(ItemTextGetText())
	if type(text) ~= "string" or text == "" then
		return nil
	end
	text = self:Detemplate(text)

	-- Once: the page field and Gather's key are the same checksum, and it is a pass over the
	-- whole page each time. Taken with the tokens back, so every character's copy of a page
	-- is one page.
	local sum = self:ChecksumOf(text)
	local fields = BaseFields(self)
	fields[#fields + 1] = { "page", sum }
	fields[#fields + 1] = { "book", (ItemTextGetItem and NotSecret(ItemTextGetItem())) or "" }
	fields[#fields + 1] = { "number", (ItemTextGetPage and NotSecret(ItemTextGetPage())) or 1 }

	-- The second value is what Gather keys the page on: its checksum, the same id the site
	-- files it under, so reading a page twice keeps it once.
	return Spoken.Contribute:Envelope("readables", fields, text), format("b:%d", sum)
end

--- What a report carries beside its address: this client, and the page as the player read it.
---
--- `id`, the corpus page, not `page`: that field is a contribution's client checksum. The text
--- is the open page's when it is the one reported, else the copy the reader kept of it.
function SpokenReadables:ReportContext(pageId)
	if type(pageId) ~= "number" or self:IsMail() or not CoreIsCurrent() then
		return nil
	end
	local fields = BaseFields(self)
	fields[#fields + 1] = { "id", pageId }
	local text
	local open = ItemTextGetText and NotSecret(ItemTextGetText())
	if type(open) == "string" and open ~= "" and self:PageOnScreen() == pageId then
		text = open
		fields[#fields + 1] = { "book", (ItemTextGetItem and NotSecret(ItemTextGetItem())) or "" }
		fields[#fields + 1] = { "number", (ItemTextGetPage and NotSecret(ItemTextGetPage())) or 1 }
	else
		local kept = self.pageText and self.pageText[self:GetClientLanguage()]
		text = kept and kept[pageId]
	end
	return Spoken.Contribute:Envelope("readables", fields, type(text) == "string" and self:Detemplate(text) or text)
end

--- The report address for a page, with its context in the fragment. The bare address in the
--- popup under a Spoken too old to say more.
---
--- Filed under the voice language, not the language the page played in: a page missing from a
--- German pack plays the English fallback, and "no German" belongs beside the German page.
function SpokenReadables:ShowReport(pageId)
	local url = self:ReportURL(pageId, self:GetVoiceLanguage())
	if not url then
		return
	end
	if _G.Spoken and Spoken.ShowReport then
		Spoken:ShowReport(url, function()
			return self:ReportContext(pageId)
		end)
		return
	end
	self:ShowCopyLink(url, self.L.REPORT_LINE_ADDRESS)
end

--- Keep the page on screen for later, if the player opted into gathering and the corpus lacks
--- its words. Called on every ITEM_TEXT_READY, which fires for each page turned; the
--- hide-buttons setting does not apply, and mail is refused by CaptureContribution itself.
function SpokenReadables:GatherContribution()
	if not (_G.Spoken and Spoken.Gather and Spoken.Gather:IsEnabled()) then
		return false
	end
	local _, exact = self:PageOnScreen()
	if exact then
		return false
	end
	local envelope, key = self:CaptureContribution()
	return envelope and Spoken.Gather:Add(key, envelope) or false
end

--- Whether the contribute button belongs on the page: text to send, and the corpus without it.
function SpokenReadables:HasContributionGap()
	if not (_G.Spoken and Spoken.Contribute and Spoken.ShowContribution) then
		return false
	end
	-- Hidden in the Spoken settings. Guarded: an older bundled player lacks the method.
	if Spoken.AreContributeButtonsHidden and Spoken:AreContributeButtonsHidden() then
		return false
	end
	local _, exact = self:PageOnScreen()
	if exact then
		return false
	end
	return self:CaptureContribution() ~= nil
end

-- Compression belongs here, not in CaptureContribution or HasContributionGap: those run on
-- every page turn to decide whether the button belongs on screen, and paying deflate's cost
-- there would tax every page the player merely reads, for a result thrown away unhandled on
-- every one that isn't a gap. This runs once, on the click.
function SpokenReadables:ShowContribution()
	local envelope, key = self:CaptureContribution()
	if not envelope then
		return
	end
	local gather = { key = key, envelope = envelope }
	local address = format("%s/contribute", Spoken.SITE_URL)
	-- Encode is absent on an older Spoken; Link
	-- returns nil for that or for an oversized result, and the two-copy fallback still works.
	local link = Spoken.Contribute.Encode and Spoken.Contribute:Link(address, envelope)
	if link then
		Spoken:ShowContribution(link, address, true, gather)
	else
		Spoken:ShowContribution(envelope, address, nil, gather)
	end
end
