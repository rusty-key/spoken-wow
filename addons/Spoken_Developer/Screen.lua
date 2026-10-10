-- What the player had open that Spoken may or may not read, and whether anything of Spoken's is
-- there to read it, for the log and its snapshots: the reading window (a book, a plaque, a sign,
-- a letter: Spoken Books' to read), an open letter in the mailbox, and which of Spoken's modules
-- are installed. Spoken Quests says the quest and gossip windows itself. A book opened without
-- Spoken Books installed is silent and shows nothing, and this is how the log says why.

local _, Developer = ...

local Log = Developer.Log

local Screen = {}
Developer.Screen = Screen

local IsAddOnLoaded = (C_AddOns and C_AddOns.IsAddOnLoaded) or IsAddOnLoaded
local GetAddOnInfo = (C_AddOns and C_AddOns.GetAddOnInfo) or GetAddOnInfo

-- Spoken's modules, and what each one reads.
local MODULES = {
	{ name = "Spoken_Quests", reads = "quests and NPC gossip" },
	{ name = "Spoken_Books", reads = "books, plaques, signs and letters" },
	{ name = "Spoken_Zones", reads = "zone lore" },
}

-- How much of a page the log keeps: enough to tell one book from another.
local EXCERPT = 80

--- "loaded", "installed, turned off in the AddOns list", or "not installed".
function Screen:AddonState(name)
	if IsAddOnLoaded and IsAddOnLoaded(name) then return "loaded" end
	local ok, found, _, _, _, reason = pcall(GetAddOnInfo or function() end, name)
	if not ok or not found or reason == "MISSING" then return "not installed" end
	if reason == "DISABLED" then return "installed, turned off in the AddOns list" end
	return "installed, not loaded" .. (reason and (" (" .. tostring(reason) .. ")") or "")
end

local function Excerpt(text)
	text = tostring(text or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("%s+", " ")
	if #text > EXCERPT then text = text:sub(1, EXCERPT) .. "..." end
	return text
end

--- Who reads the reading window: Spoken Books, or nothing, and why.
local function BooksReader()
	local state = Screen:AddonState("Spoken_Books")
	if state == "loaded" then return "Spoken Books reads it (Spoken_Books loaded)" end
	return "nothing of Spoken reads it: Spoken_Books is " .. state
end

--- The reading window as words, or nil while it is closed. A letter a player wrote has a creator;
--- the books, plaques and signs the game wrote have none.
function Screen:ReadingWindow()
	local frame = _G.ItemTextFrame
	if not (frame and frame:IsVisible()) then return nil end
	local title = ItemTextGetItem and ItemTextGetItem()
	local creator = ItemTextGetCreator and ItemTextGetCreator()
	local material = ItemTextGetMaterial and ItemTextGetMaterial()
	return format("%s %q, page %s%s%s, starting %q", creator and creator ~= "" and "a letter" or "a book",
		tostring(title or "?"), tostring(ItemTextGetPage and ItemTextGetPage() or "?"),
		creator and creator ~= "" and (", from " .. creator) or "",
		material and (", " .. tostring(material)) or "",
		Excerpt(ItemTextGetText and ItemTextGetText()))
end

--- The letter open in the mailbox, as words, or nil.
function Screen:OpenLetter()
	local frame = _G.OpenMailFrame
	if not (frame and frame:IsVisible()) then return nil end
	local id = _G.InboxFrame and InboxFrame.openMailID
	local ok, _, _, sender, subject = pcall(GetInboxHeaderInfo or function() end, id)
	if not ok then return "a letter" end
	return format("a letter %q from %s", tostring(subject or "?"), tostring(sender or "?"))
end

--- The lines the diagnostics carry: the modules, then what is open.
function Screen:Lines()
	local lines = {}
	for _, module in ipairs(MODULES) do
		lines[#lines + 1] = format("%s (%s): %s", module.name, module.reads, self:AddonState(module.name))
	end
	local reading = self:ReadingWindow()
	lines[#lines + 1] = reading and format("reading window: open, %s; %s", reading, BooksReader())
		or "reading window: closed"
	lines[#lines + 1] = "mailbox: " .. (self:OpenLetter() or "no letter open")
	return lines
end

local Spoken = Developer:Spoken()
if Spoken and Spoken.AddDiagnostics then
	Spoken:AddDiagnostics("Spoken modules and the reading window", function() return Screen:Lines() end)
end

-- The log: each page of the reading window as it shows, and its closing. A page turned back to
-- is written again, a page shown twice in a row once.
local shown
local frame = CreateFrame("Frame")
pcall(frame.RegisterEvent, frame, "ITEM_TEXT_READY")
pcall(frame.RegisterEvent, frame, "ITEM_TEXT_CLOSED")
frame:SetScript("OnEvent", function(_, event)
	if event == "ITEM_TEXT_CLOSED" then
		if shown then Log:Add("screen", "reading window closed") end
		shown = nil
		return
	end
	-- READY can come before the frame shows: read the words, whether or not it is drawn yet.
	local title = ItemTextGetItem and ItemTextGetItem()
	local page = ItemTextGetPage and ItemTextGetPage()
	local key = tostring(title) .. "#" .. tostring(page)
	if key == shown then return end
	shown = key
	local creator = ItemTextGetCreator and ItemTextGetCreator()
	Log:Add("screen", "reading window: %s %q, page %s%s, starting %q; %s",
		creator and creator ~= "" and "a letter" or "a book", tostring(title or "?"), tostring(page or "?"),
		creator and creator ~= "" and (", from " .. creator) or "",
		Excerpt(ItemTextGetText and ItemTextGetText()), BooksReader())
end)
Screen.eventFrame = frame
