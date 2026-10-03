-- SpokenZones -- the Report button shown beside a lore description, and the Contribute button
-- shown where a place has none.
--
-- A factory in the same shape as SpokenZones:CreateAudioButton: anchor the returned
-- button yourself, then call SetTarget whenever the panel's content changes.
-- The player's round button with the game's bug in it, as the subtitle shows Report.
--
-- Unlike the play button it does not care whether the line has audio. Play hides
-- with no clip because there is nothing to play; lore text can be wrong whether
-- or not anyone has read it aloud, and a report on a line with no voiceover is
-- one of the more useful kinds.

local ADDON_NAME, SpokenZones = ...

local L = SpokenZones.L

local BUTTON_HEIGHT = 20
local CONTRIBUTE_WIDTH = 100

local ReportButton = {}

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

-- nil areaKey means the zone itself. Passing a nil mapID parks the button: there
-- is nothing to report against, so it hides.
function ReportButton:SetTarget(mapID, areaKey)
	self.mapID = mapID
	self.areaKey = areaKey
	self:Refresh()
end

function ReportButton:Refresh()
	if self.mapID then
		self:Show()
	else
		self:Hide()
	end
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

--- Report as the game's bug icon, the one the player's windows show: a small round button in the
--- page's header, because Report is a rare click that should not compete with Play.
function SpokenZones:CreateReportIcon(parent)
	-- The player's round button, as its windows and subtitle show Report: the ring round the
	-- edge, the bug inside, brighter under the pointer.
	local button = SpokenZones:CreateRoundButton(parent, "report")
	local glyph = button.glyph
	button:Hide()

	button.SetTarget = ReportButton.SetTarget
	button.Refresh = ReportButton.Refresh

	button:SetScript("OnClick", function(self)
		local url = SpokenZones:ReportURL(self.mapID, self.areaKey)
		if url then SpokenZones:ShowCopyLink(url, L.OPT_REPORT_LINE_ADDRESS) end
	end)
	button:SetScript("OnEnter", function(self)
		glyph:SetAlpha(1)
		GameTooltip:SetOwner(self, "ANCHOR_LEFT")
		GameTooltip:SetText(L.OPT_REPORT_PROBLEM)
		GameTooltip:AddLine(L.OPT_REPORT_LINE_TIP, 1, 0.8, 0.2, true)
		GameTooltip:Show()
	end)
	button:SetScript("OnLeave", function()
		glyph:SetAlpha(0.85)
		GameTooltip:Hide()
	end)
	return button
end

--------------------------------------------------------------------------------
-- The "no lore here" button
--------------------------------------------------------------------------------

-- The Contribute button, in the page's body under "nobody has written its lore yet" rather
-- than in the header beside Report: every place is already known, and what is missing is the
-- lore itself, so the offer belongs beside the words that say so. Pointed at a place with SetTarget; hidden
-- with no target, or where this client cannot contribute (SpokenZones:CanContribute).
function SpokenZones:CreateContributeButton(parent)
	local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
	button:SetSize(CONTRIBUTE_WIDTH, BUTTON_HEIGHT + 2)
	button:SetText(L.CONTRIBUTE_BUTTON)
	button:Hide()

	button:SetScript("OnClick", function(self)
		SpokenZones:ShowContribution(self.mapID, self.subzone)
	end)

	button:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		GameTooltip:SetText(L.CONTRIBUTE_BUTTON_TIP_TITLE)
		GameTooltip:AddLine(L.CONTRIBUTE_BUTTON_TIP, 1, 0.8, 0.2, true)
		GameTooltip:Show()
	end)

	button:SetScript("OnLeave", function()
		GameTooltip:Hide()
	end)

	function button:SetTarget(mapID, subzone)
		self.mapID, self.subzone = mapID, subzone
		if mapID and SpokenZones:CanContribute() then
			self:Show()
		else
			self:Hide()
		end
	end

	return button
end
