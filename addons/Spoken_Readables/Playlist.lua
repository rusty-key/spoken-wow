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

local ADDON_NAME, SpokenReadables = ...

--- The pages of a book from `pageId` onwards, in reading order.
function SpokenReadables:PagesFrom(pageId)
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
function SpokenReadables:IsQueued(pageId)
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
SpokenReadables.following = {}

function SpokenReadables:IsComing(pageId)
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

--- Whether the queue took `clip` and kept it: a file the client cannot find is dropped as it
--- starts, after the queue has taken it, and its stopCallback has run by then (Follow).
local function Taken(taken, clip)
	return taken and not clip.ended or false
end

--- A page left the queue: finished, the next page with a clip goes to the head; skipped or
--- stopped, the rest of the book goes with it.
local function PageEnded(clip, finished)
	local book = SpokenReadables:PlaceOf(clip.pageId)
	local entry = book and SpokenReadables.following[book]
	-- Only the book's page in the queue: an old page dropped as the book starts again over it
	-- leaves the new reading alone.
	if not (entry and entry.clip == clip) then
		return
	end
	if not finished then
		SpokenReadables.following[book] = nil
		return
	end
	local span = clip.span
	local before = span and clip.length and span.before + clip.length
	while #entry.pages > 0 do
		local id = table.remove(entry.pages, 1)
		local nextClip = SpokenReadables:ClipFor(id)
		if nextClip then
			Follow(nextClip)
			nextClip.continues = #entry.pages > 0
			nextClip.asked = clip.asked
			nextClip.span = before and nextClip.length and { before = before, total = span.total } or nil
			if Taken(SpokenReadables.source and SpokenReadables.source:Continue(nextClip), nextClip) then
				entry.clip = nextClip
				return
			end
		end
		-- A page not read: the bar can no longer say how far through the book this is.
		before = nil
	end
	SpokenReadables.following[book] = nil
end

--- Where the first page of a reading sits in it, so the progress bar runs across the book
--- (clip.span): nothing before it, and every page's length in all. Nil where a page has none.
local function Span(first, rest)
	local total = tonumber(first.length)
	if not total then
		return nil
	end
	for _, id in ipairs(rest) do
		local length = SpokenReadables:PageLength(id)
		if not length then
			return nil
		end
		total = total + length
	end
	return { before = 0, total = total }
end

--- `clip` puts the next page at the head as it ends (PageEnded), before whatever else its own
--- stopCallback does: the next page is coming by the time that asks. Ended, it says so
--- (`ended`), so a page dropped as it starts is not taken for one being read (Taken).
function Follow(clip)
	local after = clip.stopCallback
	clip.stopCallback = function(ended, finished)
		ended.ended = true
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
function SpokenReadables:IsNarrating(book)
	local entry = book and self:BookById(book)
	if not entry then
		return false
	end

	if not self.source or not _G.Spoken or not Spoken.GetQueue then
		return false
	end
	-- One copy of the queue for the whole book: DialogueUI's book view asks several times a second.
	local queued = {}
	for _, clip in ipairs(Spoken:GetQueue()) do
		if clip.key then queued[clip.key] = true end
	end
	for _, id in ipairs(entry.pages) do
		if queued["b:" .. id] then
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
--- Only Once still lets it read itself the first time it is opened there. Its first page goes
--- in by the player's PlayNow, as any Play clicked by hand does: added behind a stopped queue it
--- would wait there silent while the button showed Stop.
---
--- `asked`: the reader asked for it (browsing is asking too), so it is read in a battleground.
--- With `behind`, its first page waits its turn behind what is playing, as a shift-click on its
--- row asks.
function SpokenReadables:PlayFrom(pageId, browsing, asked, behind)
	local source = self.source
	if not source then
		return 0
	end

	local book = self:PlaceOf(pageId)
	-- Read Book as One Line off: every page queued now, each a line of its own.
	local oneLine = self:OneLine()
	local queued, rest, first = 0, {}, nil
	for _, id in ipairs(self:PagesFrom(pageId)) do
		if SpokenReadablesSettings and SpokenReadablesSettings.readWholeBook == false and id ~= pageId then
			break
		end
		if queued == 0 or not oneLine then
			local clip = self:ClipFor(id)
			if clip then
				Follow(clip)
				local admitted
				if browsing and not first and not behind then
					-- PlayNow answers whether it plays at once; held behind a line speaking, it is
					-- still queued.
					admitted = source:PlayNow(clip) or self:IsQueued(id)
				else
					admitted = source:Enqueue(clip, asked or browsing)
				end
				if Taken(admitted, clip) then
					queued = queued + 1
					first = first or clip
				end
			end
		elseif self:HasAudio(id) then
			table.insert(rest, id)
			queued = queued + 1
		end
	end
	if oneLine and book and first then
		self.following[book] = { clip = first, pages = rest }
		first.continues = #rest > 0
		first.span = Span(first, rest)
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

--- The page on screen changed. Keep the queue pointed at it. `browsing`, `asked` and `behind` as
--- PlayFrom's.
function SpokenReadables:SyncTo(pageId, browsing, asked, behind)
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
	return self:PlayFrom(pageId, browsing, asked, behind)
end

--- Stop `book`, or every readable with none, and nothing else: a quest line may be queued too.
--- Not on closing the frame: a book reads on after it is shut.
function SpokenReadables:StopReading(book)
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
