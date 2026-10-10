-- The menu a Report or Contribute button's right-click opens (Spoken and Spoken Quests hook them
-- to call it): how big the debug log is, copy it with its diagnostics, or write it for an AI agent
-- (Write.lua). With the log off it offers to turn it on instead, since there is nothing to copy yet.
--
-- Drawn by hand, as the Small window's menu is, rather than with the game's dropdown: it has to
-- show over DialogueUI's window, which hides UIParent and every dropdown with it.

local _, Developer = ...

local L = Developer.L
local Log, Copy, Write = Developer.Log, Developer.Copy, Developer.Write

local Menu = {}
Developer.Menu = Menu

local ROW_HEIGHT, PAD = 22, 8

local menu, rows

local function Close()
	if menu then menu:Hide() end
end

local function Row(index)
	local row = rows[index]
	if row then return row end
	row = CreateFrame("Button", nil, menu)
	row:SetHeight(ROW_HEIGHT)
	row:SetPoint("TOPLEFT", PAD, -PAD - (index - 1) * ROW_HEIGHT)
	row:SetPoint("TOPRIGHT", -PAD, -PAD - (index - 1) * ROW_HEIGHT)
	row.text = row:CreateFontString(nil, "OVERLAY", "GameFontNormal")
	row.text:SetPoint("LEFT", 4, 0)
	row.text:SetJustifyH("LEFT")
	row:SetHighlightTexture([[Interface\QuestFrame\UI-QuestTitleHighlight]])
	local highlight = row:GetHighlightTexture()
	if highlight then highlight:SetAlpha(0.25) end
	row:SetScript("OnClick", function(self)
		Close()
		if self.onClick then self.onClick() end
	end)
	rows[index] = row
	return row
end

local function Build()
	menu = CreateFrame("Frame", "SpokenDeveloperMenu", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
	menu:SetFrameStrata("TOOLTIP")
	menu:SetClampedToScreen(true)
	menu:EnableMouse(true)
	if menu.SetBackdrop then
		menu:SetBackdrop({ bgFile = [[Interface\Tooltips\UI-Tooltip-Background]],
			edgeFile = [[Interface\Tooltips\UI-Tooltip-Border]], tile = true, tileSize = 16, edgeSize = 12,
			insets = { left = 3, right = 3, top = 3, bottom = 3 } })
		menu:SetBackdropColor(0.07, 0.065, 0.05, 0.98)
		menu:SetBackdropBorderColor(0.6, 0.57, 0.48, 1)
	end
	menu:Hide()
	rows = {}
	if UISpecialFrames then table.insert(UISpecialFrames, "SpokenDeveloperMenu") end
	-- However it closes, Escape included, the secure /reload button must not stay over the Write row.
	menu:SetScript("OnHide", Write.Uncover)
	-- A click anywhere else closes it. pcall: an event the client does not define throws. Not a
	-- right-click on its own button, whose release (Menu:Show) closes it instead of opening it again.
	pcall(menu.RegisterEvent, menu, "GLOBAL_MOUSE_DOWN")
	menu:SetScript("OnEvent", function(self, _, button)
		if not self:IsShown() or self:IsMouseOver() then return end
		if button == "RightButton" and self.anchor and self.anchor:IsMouseOver() then return end
		self:Hide()
	end)
end

--- The rows for the log as it stands: { text, onClick }, or { text, label = true } for a line to
--- read. `write` marks the row Write.lua covers with its secure /reload button.
function Menu:Items(anchor)
	if Log:IsOn() then
		return {
			{ text = Developer:SizeText(), label = true },
			{ text = L.MENU_COPY, onClick = function() Copy:Show(anchor) end },
			{ text = L.MENU_WRITE, write = true, onClick = function() Write:Now() end },
		}
	end
	return {
		{ text = L.MENU_TURN_ON, onClick = function()
			Log:SetOn(true)
			Developer:Print("debug log on: right-click Report again to copy it, with what happened from now on")
		end },
	}
end

--- Open it at `anchor`, or close it if it is open there.
function Menu:Show(anchor)
	if not menu then Build() end
	if menu:IsShown() and menu.anchor == anchor then
		Close()
		return
	end
	local host = Developer:HostFor(anchor)
	if menu:GetParent() ~= host then menu:SetParent(host) end
	menu:SetFrameStrata("TOOLTIP")
	local items = self:Items(anchor)
	local width = 0
	for index, item in ipairs(items) do
		local row = Row(index)
		row.text:SetFontObject(item.label and "GameFontDisableSmall" or "GameFontNormal")
		row.text:SetText(item.text)
		row.onClick = item.onClick
		row:SetEnabled(not item.label)
		-- Write is clicked through the secure button that runs /reload (Write.lua).
		if item.write then Write:Attach(row) else row.writes = nil end
		row:Show()
		width = math.max(width, row.text:GetStringWidth() or 0)
	end
	for index = #items + 1, #rows do rows[index]:Hide() end
	menu:SetSize(width + 2 * PAD + 16, #items * ROW_HEIGHT + 2 * PAD)
	menu:ClearAllPoints()
	if anchor then
		menu:SetPoint("TOPLEFT", anchor, "BOTTOMRIGHT", 0, 0)
	else
		menu:SetPoint("CENTER")
	end
	menu.anchor = anchor
	menu:Show()
	return true
end

function Menu:Close()
	Close()
end

--- The tooltip line a Report button ends with.
function Menu:Hint()
	return Log:IsOn() and L.MENU_HINT or L.MENU_HINT_OFF
end
