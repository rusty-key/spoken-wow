-- A page this corpus does not carry, as something that can be sent.
--
-- The gap is the same one Reader.lua's PageOnScreen answers with nil: a page whose checksum
-- no lookup holds. On a 1.12-derived corpus that is every post-vanilla book, every locale but
-- one, and custom text a server added itself.
--
-- MAIL NEVER LEAVES THE CLIENT. IsMail is already how the reader refuses to narrate a letter,
-- and the reason is stronger here: a letter is a player's own words to another player, and
-- this is the one path in the addon that would put them on a server of ours.
--
-- `page` is the client-side checksum, not a pageTextID. The frozen id `b:{pageTextID}` names a
-- page the corpus has; a page it has never seen has no id to be named by, and gets one only if
-- triage accepts it.

local ADDON_NAME, SpokenBooks = ...

-- A value the game hands over as a secret, in an instance or in combat, reads as nil.
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

--- The fields every books envelope starts with: which addon, which client, which language.
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

--- The envelope for the page on screen, or nil when there is nothing to send.
function SpokenBooks:CaptureContribution()
	if self:IsMail() then
		return nil
	end

	local text = ItemTextGetText and NotSecret(ItemTextGetText())
	if type(text) ~= "string" or text == "" then
		return nil
	end

	-- Once: the page field and Gather's key are the same checksum, and it is a pass over the
	-- whole page each time.
	local sum = self:ChecksumOf(text)
	local fields = BaseFields(self)
	fields[#fields + 1] = { "page", sum }
	fields[#fields + 1] = { "book", (ItemTextGetItem and NotSecret(ItemTextGetItem())) or "" }
	fields[#fields + 1] = { "number", (ItemTextGetPage and NotSecret(ItemTextGetPage())) or 1 }

	-- The second value is what Gather keys the page on: its checksum, the same id the site
	-- files it under, so reading a page twice keeps it once.
	return Spoken.Contribute:Envelope("books", fields, text), format("b:%d", sum)
end

--- What a report carries beside its address: this client, and the page as the player read it.
---
--- `id`, the corpus page, not `page`: that field is a contribution's client checksum. The text
--- is the open page's when it is the one reported, else the copy the reader kept of it.
function SpokenBooks:ReportContext(pageId)
	if type(pageId) ~= "number" or self:IsMail() or not (_G.Spoken and Spoken.Contribute) then
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
	return Spoken.Contribute:Envelope("books", fields, text)
end

--- The report address for a page, with its context in the fragment. The bare address in the
--- popup under a Spoken too old to say more.
---
--- Filed under the voice language, not the language the page played in: a page missing from a
--- German pack plays the English fallback, and "no German" belongs beside the German page.
function SpokenBooks:ShowReport(pageId)
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

--- Keep the page on screen for later, if the player opted into gathering and the corpus has
--- no id for it. Called on every ITEM_TEXT_READY, which fires for each page turned; the
--- hide-buttons setting does not apply, and mail is refused by CaptureContribution itself.
function SpokenBooks:GatherContribution()
	if not (_G.Spoken and Spoken.Gather and Spoken.Gather:IsEnabled()) then
		return false
	end
	if self:PageOnScreen() then
		return false
	end
	local envelope, key = self:CaptureContribution()
	return envelope and Spoken.Gather:Add(key, envelope) or false
end

--- Whether the contribute button belongs on the page: text to send, and no page id for it.
function SpokenBooks:HasContributionGap()
	if not (_G.Spoken and Spoken.Contribute and Spoken.ShowContribution) then
		return false
	end
	-- Hidden in the Spoken settings. Guarded: an older bundled player lacks the method.
	if Spoken.AreContributeButtonsHidden and Spoken:AreContributeButtonsHidden() then
		return false
	end
	if self:PageOnScreen() then
		return false
	end
	return self:CaptureContribution() ~= nil
end

-- Compression belongs here, not in CaptureContribution or HasContributionGap: those run on
-- every page turn to decide whether the button belongs on screen, and paying deflate's cost
-- there would tax every page the player merely reads, for a result thrown away unhandled on
-- every one that isn't a gap. This runs once, on the click.
function SpokenBooks:ShowContribution()
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
