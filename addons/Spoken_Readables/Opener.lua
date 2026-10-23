-- What the reader opened the book frame with: an item in the bags or an object in the world.
--
-- The client never says which page it shows, and ITEM_TEXT_BEGIN carries nothing. But the
-- click that opened the frame came a server round trip earlier, and the client does say what
-- that touched: the bag slot a used item sits in, the object a tooltip or the interact key is
-- on. Books.lua's `owners` turns that id into the book, which the page number then narrows to
-- the page. Reader.lua asks only once every checksum has missed.
--
-- Each source is a guess at what was clicked, and a stale one names the wrong book. So an id
-- is only a candidate: it is kept for a few seconds, the frame takes the ones still fresh when
-- it opens, and Reader.lua accepts a candidate only where its book has the page on screen.

local ADDON_NAME, SpokenReadables = ...

-- A value the game hands over as a secret, in an instance or in combat, reads as nil.
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

-- How long a use or a hover still counts as the click that opened the frame, in seconds.
local FRESH = 10

--- The entry id inside a game object's GUID ("GameObject-0-1-2-3-<entry>-<spawn>"), or nil.
function SpokenReadables:ObjectEntryOf(guid)
	guid = NotSecret(guid)
	local entry = type(guid) == "string" and string.match(guid, "^GameObject%-%d+%-%d+%-%d+%-%d+%-(%d+)%-")
	return entry and tonumber(entry) or nil
end

--- Something the reader used or pointed at, which may be what opens the next book.
function SpokenReadables:NoteOpener(kind, id)
	id = NotSecret(id)
	if type(id) ~= "number" then
		return
	end
	self.openers = self.openers or {}
	self.openers[kind] = { kind = kind, id = id, at = GetTime() }
end

--- The interact key's object: a candidate for as long as it stays the target, however long ago
--- it was picked, because pressing the key is what opens it.
function SpokenReadables:NoteSoftInteract(guid)
	local entry = self:ObjectEntryOf(guid)
	self.softObject = entry and { kind = "object", id = entry } or nil
end

--- The frame is opening. Takes the candidates for this book, most recent first, and clears
--- them: the page turns that follow are this book's, and the next book has its own click.
function SpokenReadables:OnTextBegin()
	local now = GetTime()
	local fresh = {}
	for _, opener in pairs(self.openers or {}) do
		if now - opener.at <= FRESH then
			fresh[#fresh + 1] = opener
		end
	end
	table.sort(fresh, function(a, b) return a.at > b.at end)
	if self.softObject then
		fresh[#fresh + 1] = self.softObject
	end
	self.openers = nil
	self.openedBy = fresh
end

--- The book frame closed: what opened it no longer names anything on screen.
function SpokenReadables:OnOpenerClosed()
	self.openedBy = nil
end

--- Listen for the three ways a book is opened. Each is guarded, because a client without the
--- API still reads books by checksum and title.
function SpokenReadables:SetupOpeners()
	if self.openersSetUp then
		return
	end
	self.openersSetUp = true

	-- Right-clicking an item in the bags.
	local container = _G.C_Container
	if container and container.UseContainerItem and container.GetContainerItemID then
		hooksecurefunc(container, "UseContainerItem", function(bag, slot)
			self:NoteOpener("item", container.GetContainerItemID(bag, slot))
		end)
	end

	-- Hovering an object in the world, which is where the mouse is when it is clicked.
	local processor = _G.TooltipDataProcessor
	local object = _G.Enum and Enum.TooltipDataType and Enum.TooltipDataType.Object
	if processor and processor.AddTooltipPostCall and object then
		processor.AddTooltipPostCall(object, function(_, data)
			self:NoteOpener("object", self:ObjectEntryOf(data and data.guid))
		end)
	end

	-- The interact key's target. pcall, because a client without soft targeting refuses an
	-- event it does not know.
	if self.eventFrame then
		pcall(self.eventFrame.RegisterEvent, self.eventFrame, "PLAYER_SOFT_INTERACT_CHANGED")
	end
end
