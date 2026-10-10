-- The box the log is shown in, selected for copying: the game has no clipboard, so a copy is the
-- text highlighted in an edit box for Ctrl+C. Read-only in effect: typing puts the text back.

local _, Developer = ...

local L = Developer.L

local Box = {}
Developer.Box = Box

local frame

local function Build()
	frame = CreateFrame("Frame", "SpokenDeveloperLogBox", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
	frame:SetSize(780, 480)
	frame:SetPoint("CENTER")
	frame:SetFrameStrata("DIALOG")
	frame:SetClampedToScreen(true)
	frame:SetMovable(true)
	frame:EnableMouse(true)
	frame:RegisterForDrag("LeftButton")
	frame:SetScript("OnDragStart", function(self) self:StartMoving() end)
	frame:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
	if frame.SetBackdrop then
		frame:SetBackdrop({ bgFile = [[Interface\DialogFrame\UI-DialogBox-Background-Dark]],
			edgeFile = [[Interface\Tooltips\UI-Tooltip-Border]], tile = true, tileSize = 16, edgeSize = 14,
			insets = { left = 4, right = 4, top = 4, bottom = 4 } })
	end
	local title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
	title:SetPoint("TOPLEFT", 12, -10)
	title:SetPoint("RIGHT", -32, 0)
	title:SetJustifyH("LEFT")
	frame.title = title
	local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
	close:SetPoint("TOPRIGHT", -2, -2)
	local scroll = CreateFrame("ScrollFrame", "SpokenDeveloperLogScroll", frame, "UIPanelScrollFrameTemplate")
	scroll:SetPoint("TOPLEFT", 12, -32)
	scroll:SetPoint("BOTTOMRIGHT", -32, 12)
	local edit = CreateFrame("EditBox", nil, scroll)
	edit:SetMultiLine(true)
	edit:SetFontObject(ChatFontNormal or GameFontHighlightSmall)
	edit:SetWidth(720)
	edit:SetAutoFocus(false)
	if edit.SetMaxBytes then edit:SetMaxBytes(0) end
	edit:SetScript("OnEscapePressed", function() frame:Hide() end)
	-- Typing would change what is copied: the text goes back, selected again.
	edit:SetScript("OnTextChanged", function(self, userInput)
		if userInput and frame.text and self:GetText() ~= frame.text then
			self:SetText(frame.text)
			self:HighlightText()
		end
	end)
	scroll:SetScrollChild(edit)
	frame.edit = edit
	if UISpecialFrames then table.insert(UISpecialFrames, "SpokenDeveloperLogBox") end
end

--- `text` in the box, selected, under `title`. Opened from a button on a window that hides
--- UIParent (DialogueUI's), it shows over that window.
function Box:Show(text, title, anchor)
	if not frame then Build() end
	local host = Developer:HostFor(anchor)
	if frame:GetParent() ~= host then
		frame:SetParent(host)
		frame:SetFrameStrata(host == UIParent and "DIALOG" or "FULLSCREEN_DIALOG")
	end
	frame.text = text
	frame.title:SetText(title or L.LOG_BOX_TITLE)
	frame.edit:SetText(text)
	frame:Show()
	frame.edit:SetFocus()
	frame.edit:HighlightText()
end

function Box:Hide()
	if frame then frame:Hide() end
end

function Box:Frame()
	return frame
end
