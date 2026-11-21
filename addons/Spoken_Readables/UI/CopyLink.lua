-- SpokenReadables -- a popup holding one selectable URL.
--
-- The client cannot open a browser or post anywhere, so a Report button can only offer an
-- address: an edit box with it already highlighted, so the player presses Ctrl+C and Escape
-- and nothing else. Making them select the text first is the difference between a link
-- people use and a link people read.
--
-- StaticPopup rather than a frame of our own, because it brings the dialog backdrop, the
-- Escape handling and the edit box with it, and because a modal is the honest shape for
-- something you have to finish before carrying on.
--
-- The places addon carries the same file under the same reasoning: two addons sharing one
-- StaticPopup id would be two addons overwriting each other's dialog.

local _, SpokenReadables = ...

local POPUP = "SPOKENREADABLES_COPY_LINK"

-- The popup is a shared, reused frame, so the address cannot live on it. This is what OnShow
-- reads and what OnTextChanged puts back.
local pendingURL

StaticPopupDialogs[POPUP] = {
	text = "%s",
	button1 = CLOSE,
	hasEditBox = true,
	-- Wide enough that a report address fits without scrolling; the default is sized for a
	-- character name.
	editBoxWidth = 260,
	timeout = 0,
	whileDead = true,
	hideOnEscape = true,
	-- Off the queue that quest and loot dialogs share: this one is a direct response to a
	-- button press, so it should appear when it is pressed.
	preferredIndex = 3,

	OnShow = function(self)
		local editBox = self.editBox or self.EditBox
		if not editBox then
			return
		end
		editBox:SetText(pendingURL or "")
		editBox:SetFocus()
		editBox:HighlightText()
	end,

	-- Read-only in effect but not in fact: an edit box that refuses input cannot be selected
	-- with the mouse, so accept the keystroke and undo it.
	EditBoxOnTextChanged = function(self)
		if self:GetText() ~= pendingURL then
			self:SetText(pendingURL or "")
			self:HighlightText()
		end
	end,

	EditBoxOnEnterPressed = function(self)
		self:GetParent():Hide()
	end,

	EditBoxOnEscapePressed = function(self)
		self:GetParent():Hide()
	end,
}

--- `caption` is the sentence above the box; it says what the address is for.
function SpokenReadables:ShowCopyLink(url, caption)
	if not url then
		return
	end
	pendingURL = url
	StaticPopup_Show(POPUP, caption or "Copy this address and open it in your browser.")
end
