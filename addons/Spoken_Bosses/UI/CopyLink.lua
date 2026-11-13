local _, Bosses = ...

-- A popup holding one selectable address: the client cannot open a browser, so the Bosses page's
-- Download button offers the voice pack's address here, already highlighted, for Ctrl+C.
--
-- The same popup as Places' and Readables' UI/CopyLink.lua, under an id of its own: two addons
-- sharing one StaticPopup id would overwrite each other's dialog.

local POPUP = "SPOKENBOSSES_COPY_LINK"

-- The popup is a shared, reused frame, so the address cannot live on it. This is what OnShow
-- reads and what OnTextChanged puts back.
local pendingURL

StaticPopupDialogs[POPUP] = {
	text = "%s",
	button1 = CLOSE,
	hasEditBox = true,
	-- Wide enough that a store address fits without scrolling; the default is sized for a
	-- character name.
	editBoxWidth = 260,
	timeout = 0,
	whileDead = true,
	hideOnEscape = true,
	-- Off the queue that quest and loot dialogs share: this one answers a button press.
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
function Bosses:ShowCopyLink(url, caption)
	if not url then
		return
	end
	pendingURL = url
	StaticPopup_Show(POPUP, caption or "Copy this address and open it in your browser.")
end
