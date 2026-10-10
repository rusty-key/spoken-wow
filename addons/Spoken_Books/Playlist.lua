-- A book read straight through, and kept in step with the page on screen.
--
-- Opening a book queues it from the page being read to its last, so a twenty-page journal
-- narrates on while the reader turns pages. Turning a page does not restart anything: if
-- the page turned to is already queued, the clip for it is coming and nothing happens. If
-- it is not -- the reader jumped, or opened a different book -- the queue is dropped and
-- rebuilt from there.
--
-- Queuing the WHOLE book rather than the page on screen is the difference between reading
-- along and pressing play twenty times. It is also why this source is registered with NO
-- queue limit, which Core.lua sets out: a cap of one keeps a four-page book's first page and
-- its last and silently discards the middle.

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

--- Queue this page and the rest of its book. Returns how many clips were admitted.
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

	local queued = 0
	for _, id in ipairs(self:PagesFrom(pageId)) do
		if SpokenBooksSettings and SpokenBooksSettings.readWholeBook == false and id ~= pageId then
			break
		end
		local clip = self:ClipFor(id)
		if clip and source:Enqueue(clip) then
			queued = queued + 1
		end
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

	-- Already coming: the reader turned to a page this book had queued for them, which is
	-- the normal case and the one that must not restart narration.
	if self:IsQueued(pageId) then
		return 0
	end

	-- Somewhere else entirely. Drop what this source holds -- never the whole queue, which
	-- may be carrying a quest line -- and rebuild from here.
	if self.source then
		self.source:StopAll()
	end
	return self:PlayFrom(pageId, browsing)
end

--- Stop this source, and only this source: the queue may be carrying a quest line that has
--- nothing to do with a book.
---
--- Reached by `/spb stop` and by SyncTo rebuilding, not by closing the frame -- a book
--- carries on being read after it is shut.
function SpokenBooks:StopReading()
	if self.source then
		self.source:StopAll()
	end
end
