-- Write the Debug Log for an AI Agent. No addon can write a file, nor make the game write its
-- saved variables: the game does that only at a reload, a logout or exit. So an AI agent on this
-- computer reading Spoken_Developer.lua sees the log as it stood at the last of those. This takes
-- the detailed snapshot of the moment (the window and quest open, what Spoken Quests would read
-- for it, Read Automatically, the queue), marks it, and has the interface reload, which writes the
-- file; scripts/developer/read-log.py reads it from there.
--
-- Forever refuses C_UI.Reload to an addon even inside a click ("Interface action failed because
-- of an AddOn"), but not the game's own /reload. So the Write buttons (the menu's row, the
-- Developer page's) are covered, while the pointer is on them, by one secure button whose click
-- runs the macro "/reload" as the player's own command would; its PreClick takes the snapshot
-- first. Where that cannot be (in combat, or a client without the template) and from
-- `/spoken log write`, the snapshot is taken and the chat box opens with /reload typed in:
-- the player's Enter writes it.

local _, Developer = ...

local Log, Copy = Developer.Log, Developer.Copy

local Write = {}
Developer.Write = Write

-- The diag block's head and the session line's; read-log.py looks for these words.
local HEAD = "written for an AI agent"
Write.HEAD = HEAD

-- A secure button fires PreClick on the press and on the release (it listens to both, for the
-- game's "act on key down" setting): one snapshot per click.
local ONE_CLICK = 0.5

--- The snapshot and the mark. False, saying why, while the log is off.
function Write:Prepare()
	if not Log:IsOn() then
		Developer:Print("the debug log is off, so there is nothing to write: Spoken > Developer > Enable Debug Log Recording")
		return false
	end
	local now = GetTime()
	if self.prepared and now - self.prepared < ONE_CLICK then return true end
	self.prepared = now
	Copy:Snapshot(HEAD)
	local at = date and date("%Y-%m-%d %H:%M:%S") or "?"
	Log:Add("session", "%s at %s", HEAD, at)
	Developer:DB().written = { at = at, lines = Log:Count(), bytes = Log:Bytes() }
	return true
end

--- Without the secure button: the snapshot, then /reload typed in the chat box for the player's
--- Enter. False while the log is off or in combat.
function Write:Now()
	if InCombatLockdown and InCombatLockdown() then
		Developer:Print("the interface cannot reload in combat: write the log after the fight")
		return false
	end
	if not self:Prepare() then return false end
	-- A frame later: typed in while the chat box is still handling an Enter (/spoken log write's),
	-- it is cleared when that Enter finishes.
	if ChatFrame_OpenChat then C_Timer.After(0, function() ChatFrame_OpenChat("/reload") end) end
	Developer:Print("the log is ready: press Enter to run /reload, which writes it")
	return true
end

--------------------------------------------------------------------------------
-- The secure button over a Write button
--------------------------------------------------------------------------------

local secure

local function Uncover()
	if not secure or (InCombatLockdown and InCombatLockdown()) then return end
	local target = secure.target
	secure.target = nil
	secure:Hide()
	secure:ClearAllPoints()
	if target then
		if target.UnlockHighlight then target:UnlockHighlight() end
		local leave = target:GetScript("OnLeave")
		if leave then leave(target) end
	end
end
Write.Uncover = Uncover

local function Build()
	if secure ~= nil then return secure end
	secure = false
	local ok, button = pcall(CreateFrame, "Button", "SpokenDeveloperWriteButton", UIParent, "SecureActionButtonTemplate")
	if not ok or not button then return false end
	button:SetAttribute("type", "macro")
	button:SetAttribute("macrotext", "/reload")
	button:RegisterForClicks("LeftButtonUp", "LeftButtonDown")
	button:SetScript("PreClick", function() Write:Prepare() end)
	-- The covered button's tooltip, which the cover took the pointer from.
	button:SetScript("OnEnter", function(self)
		local target = self.target
		local enter = target and target:GetScript("OnEnter")
		if enter then enter(target) end
	end)
	button:SetScript("OnLeave", Uncover)
	button:Hide()
	-- Let go of whatever it covers before combat locks it in place.
	button:RegisterEvent("PLAYER_REGEN_DISABLED")
	button:SetScript("OnEvent", Uncover)
	secure = button
	return secure
end

local function Scale(frame)
	return frame.GetEffectiveScale and frame:GetEffectiveScale() or 1
end

--- Put the secure button where `target` is on screen, anchored to UIParent's corner, never to
--- the target: a protected frame cannot be anchored to a frame whose own anchors lead to a text or
--- a texture ("Cannot anchor protected frames to regions"), and the subtitle's round buttons sit by
--- its words. UIParent always may be. False where that cannot be done either.
local function Place(target)
	local left, top = target:GetLeft(), target:GetTop()
	if not (left and top) then return false end
	-- Offsets are in the secure button's own scale; the target's are in its own.
	local scale = Scale(target) / Scale(secure)
	secure:ClearAllPoints()
	secure:SetSize((target:GetWidth() or 0) * scale, (target:GetHeight() or 0) * scale)
	return (pcall(secure.SetPoint, secure, "TOPLEFT", UIParent, "BOTTOMLEFT", left * scale, top * scale))
end

--- Put the secure button over `target`, as it looks: its highlight lit and its tooltip shown.
--- Where it cannot be placed, the target's own click writes the log through the chat box.
local function Cover(target)
	if InCombatLockdown and InCombatLockdown() then return end
	if not (target.writes and Log:IsOn() and Build()) then return end
	secure:SetParent(Developer:HostFor(target))
	secure:SetFrameStrata(target:GetFrameStrata())
	secure:SetFrameLevel(target:GetFrameLevel() + 5)
	if not Place(target) then
		secure:ClearAllPoints()
		secure:Hide()
		return
	end
	secure.target = target
	secure:Show()
	if target.LockHighlight then target:LockHighlight() end
end

--- Make `target` a Write button: clicked, it writes the log in one go where the secure button can
--- cover it, and through the chat box otherwise. `target.writes` says whether it is one right now
--- (the menu's rows are reused for other items).
function Write:Attach(target)
	target.writes = true
	if target.coveredForWrite then return end
	target.coveredForWrite = true
	target:HookScript("OnEnter", Cover)
end

--- After the reload: say once that the log is written, and where.
function Write:Announce()
	local db = Developer:DB()
	local written = db.written
	if type(written) ~= "table" then return end
	db.written = nil
	Developer:Print("debug log written at %s: %s lines, %s. An AI agent on this computer can read it now.",
		tostring(written.at), tostring(written.lines), Developer.FormatBytes(written.bytes or Log:Bytes()))
end
