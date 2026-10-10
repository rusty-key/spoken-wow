-- A book read straight through, and kept in step with the page on screen.
--
-- Opening a book reads it from the page being read to its last, so a twenty-page journal
-- narrates on while the reader turns pages. Turning a page does not restart anything: if
-- the page turned to is speaking or still to come, nothing happens. If it is a page of the
-- book being read that is not coming (the reader turned back), that book starts again from
-- there, in the queue's order like anything else. Opening another readable while one is read
-- queues it after: a gravestone read on the way waits for the book.
--
-- A book is one line in the queue: its first page is queued and each page, as it finishes,
-- puts the next at the head (source:Continue), so the queue counts the book once and Skip
-- skips the rest of it. A page with more to follow `continues`: only the book's own gap after
-- it, not the pause and cue between lines.

local ADDON_NAME, SpokenBooks = ...

--- The pages of a book from `pageId` onwards, in reading order.
function SpokenBooks:PagesFrom(pageId)
	local book = self:BookOf(pageId)
	if not book then
		return {}
	end

	local rest, found = {}, false
	for _, id in ipairs(book.pages) do
		if id == pageId then
			found = true
		end
		if found then
			table.insert(rest, id)
		end
	end
	return rest
end

--- Whether a page is already queued or speaking.
function SpokenBooks:IsQueued(pageId)
	if not self.source or not _G.Spoken or not Spoken.GetQueue then
		return false
	end

	local key = "b:" .. pageId
	-- GetQueue is a shallow copy of the whole queue, both sources included; the key
	-- namespace is this addon's, so a match can only be one of ours.
	for _, clip in ipairs(Spoken:GetQueue()) do
		if clip.key == key then
			return true
		end
	end
	return false
end

--- Each book being read, by book: { clip, the page of it in the queue; pages, those still to
--- come }, each page put at the head as the one before it finishes (PageEnded). A book's entry
--- goes once it is done, skipped or stopped.
SpokenBooks.following = {}

function SpokenBooks:IsComing(pageId)
	local book = self:PlaceOf(pageId)
	local entry = book and self.following[book]
	for _, id in ipairs(entry and entry.pages or {}) do
		if id == pageId then
			return true
		end
	end
	return false
end

local Follow

--- A page left the queue: finished, the next page with a clip goes to the head; skipped or
--- stopped, the rest of the book goes with it.
local function PageEnded(clip, finished)
	local book = SpokenBooks:PlaceOf(clip.pageId)
	local entry = book and SpokenBooks.following[book]
	-- Only the book's page in the queue: an old page dropped as the book starts again over it
	-- leaves the new reading alone.
	if not (entry and entry.clip == clip) then
		return
	end
	if not finished then
		SpokenBooks.following[book] = nil
		return
	end
	while table.getn(entry.pages) > 0 do
		local id = table.remove(entry.pages, 1)
		local nextClip = SpokenBooks:ClipFor(id)
		if nextClip then
			Follow(nextClip)
			nextClip.continues = table.getn(entry.pages) > 0
			if SpokenBooks.source and SpokenBooks.source:Continue(nextClip) then
				entry.clip = nextClip
				return
			end
		end
	end
	SpokenBooks.following[book] = nil
end

--- `clip` puts the next page at the head as it ends (PageEnded), before whatever else its own
--- stopCallback does: the next page is coming by the time that asks.
function Follow(clip)
	local after = clip.stopCallback
	clip.stopCallback = function(ended, finished)
		PageEnded(ended, finished)
		if after then after(ended, finished) end
	end
end

--- Whether any page of `book` is still queued or speaking.
---
--- Asked by the read-once rule, which must not refuse the book it is in the middle of
--- reading: a reader who jumps past the queued pages is still inside the book that was
--- already counted as read, and a refusal there would strand the narration on the page they
--- turned away from. Walks the book rather than trusting a remembered "currently reading",
--- which nothing clears when a queue drains on its own.
function SpokenBooks:IsNarrating(book)
	local data = self:Data()
	local entry = book and data and data.books[book]
	if not entry then
		return false
	end

	for _, id in ipairs(entry.pages) do
		if self:IsQueued(id) then
			return true
		end
	end
	return false
end

--- Read this page and the rest of its book: this page queued, the rest to follow it (PageEnded).
--- Returns how many pages will be read.
---
--- A page the installed pack has no clip for is skipped rather than queued silent: the
--- player would otherwise hold a clip with no sound for its whole length, which reads as
--- the addon having stopped working.
---
--- `browsing`: played from the Compendium, which is not meeting the book in the world, so Read
--- Only Once still lets it read itself the first time it is opened there.
function SpokenBooks:PlayFrom(pageId, browsing)
	local source = self.source
	if not source then
		return 0
	end

	local book = self:PlaceOf(pageId)
	local queued, rest, first = 0, {}, nil
	for _, id in ipairs(self:PagesFrom(pageId)) do
		if SpokenBooksSettings and SpokenBooksSettings.readWholeBook == false and id ~= pageId then
			break
		end
		if queued == 0 then
			local clip = self:ClipFor(id)
			if clip then
				Follow(clip)
				if source:Enqueue(clip) then
					queued, first = 1, clip
				end
			end
		elseif self:HasAudio(id) then
			table.insert(rest, id)
			queued = queued + 1
		end
	end
	if book and first then
		self.following[book] = { clip = first, pages = rest }
		first.continues = #rest > 0
	end

	-- Read, as far as this character is concerned, the moment a page of it is admitted --
	-- whether autoplay queued it or the reader pressed play. Recorded even with readOnce
	-- off, so turning the setting on remembers what was heard before rather than starting
	-- from a blank slate.
	if queued > 0 and not browsing then
		self:MarkBookRead(self:PlaceOf(pageId))
	end

	return queued
end

--- The page on screen changed. Keep the queue pointed at it. `browsing` as PlayFrom's.
function SpokenBooks:SyncTo(pageId, browsing)
	if not pageId then
		return 0
	end

	-- Already coming: the reader turned to a page this book is reading or has still to read,
	-- which is the normal case and the one that must not restart narration.
	if self:IsQueued(pageId) or self:IsComing(pageId) then
		return 0
	end

	-- A page of a book being read that is not coming: the reader turned back. Its old pages go
	-- and it starts again from there, after whatever else waits.
	local book = self:PlaceOf(pageId)
	if book and self:IsNarrating(book) then
		self:StopReading(book)
	end

	-- Another readable waits behind what is being read, a quest line or another book.
	return self:PlayFrom(pageId, browsing)
end

--- Stop `book`, or every readable with none, and nothing else: a quest line may be queued too.
--- Not on closing the frame: a book reads on after it is shut.
function SpokenBooks:StopReading(book)
	if not book then
		if self.source then
			self.source:StopAll()
		end
		self.following = {}
		return
	end
	self.following[book] = nil
	if self.source then
		for _, clip in ipairs(Spoken:GetQueue()) do
			if clip.pageId and self:PlaceOf(clip.pageId) == book then
				self.source:Remove(clip)
			end
		end
	end
end
