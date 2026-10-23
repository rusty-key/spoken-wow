-- A scrolling block of wrapped text, with a scrollbar: Spoken Places' stories, beside the map and in
-- Azeroth's Compendium, and Spoken Readables' readables and Spoken Quests' quests there, so all of them
-- scroll and wrap alike. The global SpokenTextView: Create, AddScrollBar and Unsnap. The words are
-- the Compendium's Text Size (Spoken:CompendiumFontSize).
--
-- Not under setfenv(1, SpokenEnv): the client's mixins are looked up in the calling function's
-- environment.
--
-- The scrollbar is built by hand from the game's minimal scroll bar art (MinimalScrollBar's
-- track and small thumb, as the quest log and the settings draw them) rather than inherited:
-- the template's ScrollBox plumbing cannot be checked without launching the game, and a track
-- and a thumb are fully deterministic. A plain bar where the client has not got the art.
--
-- Where the text runs past the view it fades out at the cut edge rather than stopping on a
-- clean line: a strip of the page's own background (TextView:SetFadeSource), drawn over the
-- text, clear on the inside and solid at the edge.

SpokenTextView = {}

local SCROLL_STEP = 28
-- Between the words (and a part's buttons) and the scroll bar, while the bar shows.
local BAR_GAP = 14
local BAR_WIDTH = 6
local MIN_THUMB = 20
-- The fade at each edge of the text, from the text outward: three strips easing from clear to
-- solid, so it starts too faintly to show a line where it begins. A single straight fade did.
local FADE_STEPS = { { 10, 0, .15 }, { 10, .15, .55 }, { 10, .55, 1 } } -- { height, inner, outer }
local FADE = 30               -- their heights together
local SOLID = 3               -- solid page between the fade and the edge
local EDGE_OUT = 2            -- ...reaching past the edge, over the clip line: the view clips on whole pixels
                              -- and the band, unsnapped, need not end on one, so a band ending at the
                              -- edge left its last row half covered and text showed through it. 2 is
                              -- the gap to the divider above, so the top band stops short of it.
-- The top fade at half the height: it only shows once the text is scrolled, and at full
-- height it left a wide gap between the divider and the first line.
local TOP_SCALE = .5
-- The text's room above and below, so at rest it is clear of both fades.
local PAD_TOP, PAD_BOTTOM = FADE * TOP_SCALE + SOLID, FADE + SOLID
-- Pictures are 2:1 and capped at PICTURE_MOST, so the wide lore window shows them only a little
-- bigger, and drawn at PICTURE_ALPHA so the page's grain shows through. PICTURE_LIFT raises one
-- into the text's top padding: its frayed edge is clear page, which left a wider gap above it.
local PICTURE_MOST, PICTURE_GAP, PICTURE_ALPHA, PICTURE_LIFT = 400, 10, 0.95, 10
-- A clean picture (TextView:SetCleanPictures) loses this share of each side: past it no pixel of
-- any shipped picture is thinned toward the parchment by more than 1%, measured from the shipped
-- masks (the worst, Mask14, needs 0.172: 44 of 256 rows). The same share off every side keeps it 2:1.
local PICTURE_CROP = 0.175
-- More room above and below a clean picture, in its box on a dark page, than the frayed one's.
local CLEAN_ROOM = 9
-- A part's heading (SetParts): the title's face, larger than the words and darker, on a line as
-- tall as its round buttons; the words HEAD_GAP under it, PART_GAP between one part and the next.
-- In near-black, as the quest frame's own headings on parchment are, set apart by room alone.
local HEAD_SIZE, HEAD_LINE, HEAD_GAP, PART_GAP, BUTTON_GAP = 7, 26, 10, 34, 4
-- No larger than HEAD_MOST, so a heading stays under the page's title (26) at any size of words.
local HEAD_MOST = 20
-- The first heading's line starts HEAD_LIFT into the text's top padding: its line is taller than
-- its letters, which started lower than a page's first line of words does.
local HEAD_LIFT = 4
local HEAD_INK = { 0.06, 0.04, 0.02 }
-- A part with a face (a speaker's portrait): the face at the left of the heading's line, which is
-- as tall as it, and the heading FACE_GAP right of it under a caption (the speaker's name) in the
-- words' face, CAPTION_LESS smaller than the words and no smaller than CAPTION_LEAST or larger
-- than CAPTION_MOST, CAPTION_GAP above it.
local FACE_GAP, CAPTION_GAP, CAPTION_LESS, CAPTION_LEAST, CAPTION_MOST = 8, 2, 1, 10, 14
-- A part's cards (SetParts): frames of the caller's in a grid under the heading, CARD_GAP apart.
local CARD_GAP, CARD_COLUMNS = 6, 3

local TextView = {}
TextView.__index = TextView

local function Clamp(value, low, high)
	if value < low then
		return low
	elseif value > high then
		return high
	end
	return value
end

local function HasAtlas(name)
	return C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(name) ~= nil or false
end

local function FontSize()
	return Spoken:CompendiumFontSize()
end

-- The file `fontObject`'s words are written in: where the view's owner reads a language other than
-- the client's (only Places does, SpokenPlaces:FontFor), one that draws its script.
local function FontFile(view, fontObject)
	fontObject = view.faceObject or fontObject
	local owner = view.owner
	return owner and owner.FontFor and owner:FontFor(fontObject)
		or (fontObject and fontObject.GetFont and fontObject:GetFont())
end

--------------------------------------------------------------------------------
-- Scrollbar
--------------------------------------------------------------------------------

function TextView:UpdateScrollBar()
	local viewHeight = self.frame:GetHeight() or 0
	local contentHeight = self.child:GetHeight() or 0
	local range = contentHeight - viewHeight
	local scrollable = range > 1 and viewHeight > 0

	-- Back inside the range where it has shrunk under the offset: closing a branch of the lore
	-- window's tree left the list scrolled past its end, blank below the last row. Only when it
	-- moves, as setting it calls back in here through OnVerticalScroll.
	local limit = scrollable and range or 0
	if (self.frame:GetVerticalScroll() or 0) > limit then
		self.frame:SetVerticalScroll(limit)
	end

	-- A caller's scroll child (AddScrollBar) as wide as the frame, less the bar's room only while
	-- there is something to scroll: rows reach the edge when the bar is not there.
	if self.fitsChild then
		local width = (self.frame:GetWidth() or 0) - (scrollable and (self.barWidth + 6) or 0)
		if width > 0 and math.abs((self.child:GetWidth() or 0) - width) > 0.5 then self.child:SetWidth(width) end
	end

	-- Nothing to scroll: keep the bar out of the way entirely.
	if not scrollable then
		self.range = 0
		self.bar:Hide()
		self:UpdateFade()
		return
	end

	self.range = range
	self.bar:Show()

	local barHeight = self.bar:GetHeight() or 0
	local thumbHeight = Clamp((viewHeight / contentHeight) * barHeight, MIN_THUMB, barHeight)
	self.thumb:SetHeight(thumbHeight)

	local travel = barHeight - thumbHeight
	local fraction = range > 0 and (self.frame:GetVerticalScroll() / range) or 0
	self.thumb:ClearAllPoints()
	self.thumb:SetPoint("TOP", self.bar, "TOP", 0, -Clamp(fraction * travel, 0, travel))
	self:UpdateFade()
end

--- What the text leaves free on its right for the scroll bar: the words, and a part's buttons,
--- end this far inside the view's right edge. None while they fit and the bar is not there; the
--- bar's width and BAR_GAP while they run past the view.
function TextView:BarRoom()
	return self.room or 0
end

-- After laying the words out: room for the bar where they run past the view, none where they fit,
-- and laid out once more (`again`) where that changed. `onRoom(room)` tells the page, whose
-- header buttons stand over the words' right edge.
function TextView:Settle(again)
	local high = self.frame:GetHeight() or 0
	local runsPast = high > 0 and (self.child:GetHeight() or 0) - high > 1
	local need = runsPast and (self.barWidth + BAR_GAP) or 0
	if need == (self.room or 0) or self.settling then return end
	self.room = need
	self.settling = true
	again()
	self.settling = false
	if self.onRoom then self.onRoom(need) end
end

function TextView:ScrollTo(value)
	local target = Clamp(value, 0, self.range or 0)
	self.frame:SetVerticalScroll(target)
end

-- A texture in `atlas`, or nil where the client has not got it.
local function AtlasTexture(frame, layer, atlas, useSize)
	if not HasAtlas(atlas) then return nil end
	local texture = frame:CreateTexture(nil, layer)
	texture:SetAtlas(atlas, useSize)
	return texture
end

-- The game's minimal scroll bar pieces: a cap at each end and a middle stretched between.
local function ThreePiece(frame, layer, top, middle, bottom)
	local first = AtlasTexture(frame, layer, top, true)
	local last = AtlasTexture(frame, layer, bottom, true)
	local mid = AtlasTexture(frame, layer, middle, false)
	if not (first and last and mid) then return nil end
	first:SetPoint("TOP", frame, "TOP", 0, 0)
	last:SetPoint("BOTTOM", frame, "BOTTOM", 0, 0)
	mid:SetPoint("TOPLEFT", first, "BOTTOMLEFT", 0, 0)
	mid:SetPoint("BOTTOMRIGHT", last, "TOPRIGHT", 0, 0)
	return { first, mid, last }
end

local function BuildScrollBar(view, parent)
	local minimal = HasAtlas("minimal-scrollbar-track-top")
	local width = minimal and 8 or BAR_WIDTH
	view.barWidth = width

	local bar = CreateFrame("Frame", nil, parent)
	bar:SetWidth(width)
	bar:SetPoint("TOPRIGHT", view.frame, "TOPRIGHT", 0, 0)
	bar:SetPoint("BOTTOMRIGHT", view.frame, "BOTTOMRIGHT", 0, 0)
	bar:SetFrameLevel(view.frame:GetFrameLevel() + 8)
	bar:EnableMouse(true)

	view.minimal = (minimal and ThreePiece(bar, "BACKGROUND", "minimal-scrollbar-track-top",
		"!minimal-scrollbar-track-middle", "minimal-scrollbar-track-bottom")) and true or false
	if not view.minimal then
		local track = bar:CreateTexture(nil, "BACKGROUND")
		track:SetAllPoints()
		track:SetColorTexture(1, 1, 1, 0.06)
	end

	local thumb = CreateFrame("Button", nil, bar)
	thumb:SetWidth(width)
	thumb:SetHeight(MIN_THUMB)
	thumb:SetPoint("TOP", bar, "TOP", 0, 0)

	local pieces = view.minimal and ThreePiece(thumb, "ARTWORK", "minimal-scrollbar-small-thumb-top",
		"minimal-scrollbar-small-thumb-middle", "minimal-scrollbar-small-thumb-bottom")
	local thumbTex
	if not pieces then
		thumbTex = thumb:CreateTexture(nil, "ARTWORK")
		thumbTex:SetAllPoints()
	end
	local over = false
	-- Brighter under the pointer and while held, as the game's thumb is. The plain bar is gold on
	-- a dark page and the page's own ink on parchment (TextView:SetThumbColor).
	function view:PaintThumb()
		local strong = self.dragging or over
		if self.flatThumb then
			self.flatThumb:SetColorTexture(1, 1, 1, strong and 0.5 or 0.3)
			return
		end
		if pieces then
			for _, piece in ipairs(pieces) do piece:SetAlpha(strong and 1 or 0.8) end
		else
			local c = self.thumbColor or { 1, 0.82, 0 }
			thumbTex:SetColorTexture(c[1], c[2], c[3], strong and 0.75 or 0.45)
		end
	end
	view:PaintThumb()

	thumb:SetScript("OnEnter", function() over = true; view:PaintThumb() end)
	thumb:SetScript("OnLeave", function() over = false; view:PaintThumb() end)

	-- The cursor's height in the bar's own units: the map has a scale of its own.
	local function CursorY()
		local _, y = GetCursorPosition()
		local scale = (bar.GetEffectiveScale and bar:GetEffectiveScale())
			or (UIParent and UIParent:GetEffectiveScale()) or 1
		return y / scale
	end
	-- Following the pointer every frame only while the thumb is held: the bar is shown whenever
	-- the text overflows, and an OnUpdate left on it would run for nothing all that time.
	local function Release()
		view.dragging = false
		bar:SetScript("OnUpdate", nil)
		view:PaintThumb()
	end
	local function Follow()
		-- Let go off the thumb, where its OnMouseUp never hears of it.
		if IsMouseButtonDown and not IsMouseButtonDown("LeftButton") then
			Release()
			return
		end
		local barHeight = bar:GetHeight() or 0
		local thumbHeight = thumb:GetHeight() or 0
		local travel = barHeight - thumbHeight
		if travel <= 0 then
			return
		end
		local offset = (bar:GetTop() or 0) - CursorY() - (view.grab or thumbHeight / 2)
		view:ScrollTo((Clamp(offset, 0, travel) / travel) * (view.range or 0))
	end
	-- Held from the press and where it was taken, so the thumb moves with the pointer rather than
	-- jumping to centre on it.
	thumb:SetScript("OnMouseDown", function(_, button)
		if button and button ~= "LeftButton" then return end
		view.grab = (thumb:GetTop() or 0) - CursorY()
		view.dragging = true
		bar:SetScript("OnUpdate", Follow)
		view:PaintThumb()
	end)
	thumb:SetScript("OnMouseUp", Release)
	-- A click on the track pages toward it, as the game's bar does.
	bar:SetScript("OnMouseDown", function()
		local page = (view.frame:GetHeight() or 0) - SCROLL_STEP
		local step = CursorY() > (thumb:GetTop() or 0) and -page or page
		view:ScrollTo(view.frame:GetVerticalScroll() + step)
	end)

	view.bar = bar
	view.thumb = thumb
	if SpokenLayout.dressScrollBar then
		SpokenLayout.dressScrollBar(bar, thumb, function(strip) view.flatThumb = strip; view:PaintThumb() end)
	end
end

--------------------------------------------------------------------------------
-- The fade at a cut edge
--------------------------------------------------------------------------------

-- Opacity running from `bottom` to `top` up the texture, with whichever call the client has.
local function Gradient(texture, bottom, top)
	if texture.SetGradient and CreateColor then
		texture:SetGradient("VERTICAL", CreateColor(1, 1, 1, bottom), CreateColor(1, 1, 1, top))
	elseif texture.SetGradientAlpha then
		texture:SetGradientAlpha("VERTICAL", 1, 1, 1, bottom, 1, 1, 1, top)
	end
end

--- Drawn where it lies, not nudged onto the screen's pixel grid: the fade and the page under it
--- are two textures of one picture, and snapped separately they part by a pixel along the
--- fade's solid edge.
function SpokenTextView.Unsnap(texture)
	if texture.SetSnapToPixelGrid then texture:SetSnapToPixelGrid(false) end
	if texture.SetTexelSnappingBias then texture:SetTexelSnappingBias(0) end
end

-- At each edge of the view, always there: a few rows of solid page at the edge itself (and
-- EDGE_OUT past it), then the fade above or below them. Solid, because a gradient never quite
-- reaches full opacity in its last row of pixels, and text passing under that row showed
-- through as a faint line. The text is padded by both (PAD_TOP, PAD_BOTTOM), so at rest it starts
-- below the top fade and ends above the bottom one, and only text scrolled under an edge fades.
local function BuildFade(view, parent)
	local over = CreateFrame("Frame", nil, parent)
	over:SetAllPoints(view.frame)
	over:SetFrameLevel(view.frame:GetFrameLevel() + 6)
	local right = -(view.barWidth + 4)
	view.strips, view.ramps = {}, {}
	local function Strip()
		local strip = over:CreateTexture(nil, "OVERLAY")
		SpokenTextView.Unsnap(strip)
		strip:Hide()
		table.insert(view.strips, strip)
		return strip
	end
	local function Edge(edge, outward)
		local solid = Strip()
		solid.fadeEdge = edge
		solid:SetHeight(SOLID + EDGE_OUT)
		solid:SetPoint(edge .. "LEFT", view.frame, edge .. "LEFT", 0, outward * EDGE_OUT)
		solid:SetPoint(edge .. "RIGHT", view.frame, edge .. "RIGHT", right, outward * EDGE_OUT)
		-- From the solid band inward, the most solid step first, each under the last.
		local far = edge == "TOP" and "BOTTOM" or "TOP"
		local previous = solid
		for i = #FADE_STEPS, 1, -1 do
			local step = FADE_STEPS[i]
			local ramp = Strip()
			ramp.fadeEdge = edge
			ramp:SetHeight(edge == "TOP" and step[1] * TOP_SCALE or step[1])
			ramp:SetPoint(edge .. "LEFT", previous, far .. "LEFT", 0, 0)
			ramp:SetPoint(edge .. "RIGHT", previous, far .. "RIGHT", 0, 0)
			-- Opacity bottom to top: solid toward the edge, clear toward the text.
			if edge == "TOP" then
				table.insert(view.ramps, { ramp, step[2], step[3] })
			else
				table.insert(view.ramps, { ramp, step[3], step[2] })
			end
			previous = ramp
		end
		return solid
	end
	-- Outward is up from the top edge and down from the bottom one.
	view.fadeTop = Edge("TOP", 1)
	view.fadeBottom = Edge("BOTTOM", -1)
	over:SetScript("OnSizeChanged", function() view:PaintFade() end)
end

--- What the fade is cut from: `file` with `coords` = { left, right, top, bottom } drawn over
--- `under`, the frame that background fills. Each strip shows the part of it lying under the
--- strip, so the text dissolves into the page. With no file there are no strips: the page is
--- then see-through, and a strip of any one colour drew as a bar over whatever lay behind it.
function TextView:SetFadeSource(under, file, coords)
	self.fadeSource = file and { under = under, file = file, coords = coords } or nil
	self:PaintFade()
end

--- The fade in a colour for each edge, { r, g, b }: the backdrop's there, on a page with no
--- picture of its own under the words (EllesmereUI's look).
function TextView:SetFadeColors(top, bottom)
	self.fadeSource = { colors = { TOP = top, BOTTOM = bottom } }
	self:PaintFade()
end

local function PaintStrip(strip, source)
	if source.colors then
		local c = source.colors[strip.fadeEdge or "TOP"]
		strip:SetColorTexture(c[1], c[2], c[3], 1)
		return true
	end
	local under = source.under
	local left, top = under:GetLeft(), under:GetTop()
	local width, height = under:GetWidth(), under:GetHeight()
	local x0, x1, y0, y1 = strip:GetLeft(), strip:GetRight(), strip:GetTop(), strip:GetBottom()
	-- Not laid out yet: painted when it is, from the strips' OnSizeChanged.
	if not (left and top and x0 and x1 and y0 and y1 and width and width > 0 and height and height > 0) then
		return false
	end
	local c = source.coords
	local function U(x) return c[1] + (c[2] - c[1]) * (x - left) / width end
	local function V(y) return c[3] + (c[4] - c[3]) * (top - y) / height end
	strip:SetTexture(source.file)
	strip:SetTexCoord(U(x0), U(x1), V(y0), V(y1))
	return true
end

function TextView:PaintFade()
	local source = self.fadeSource
	if not (source and self.fadeTop) then
		self:UpdateFade()
		return
	end
	local painted = true
	for _, strip in ipairs(self.strips) do
		painted = PaintStrip(strip, source) and painted
	end
	self.fadePainted = painted
	for _, ramp in ipairs(self.ramps) do Gradient(ramp[1], ramp[2], ramp[3]) end
	self:UpdateFade()
end

-- Shown whenever the view is and the strips have been cut from the page under them, unless held
-- off (TextView:SetFadeShown).
function TextView:UpdateFade()
	if not self.fadeTop then return end
	local on = (self.fadeSource and self.fadePainted and self.frame:IsShown() and not self.fadeHeld)
		and true or false
	for _, strip in ipairs(self.strips) do
		if on then strip:Show() else strip:Hide() end
	end
end

--- Off while the view is faded as a whole: each strip fades on its own over the page under it,
--- and the two showed through each other as darker bands.
function TextView:SetFadeShown(shown)
	local held = not shown
	if self.fadeHeld == held then return end
	self.fadeHeld = held
	self:UpdateFade()
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

-- Anchor the returned view's `frame` yourself. Width is read at SetText time, so
-- it copes with the frame being resized after creation. `owner` is the module whose words it shows,
-- for the font its language is written in (FontFile).
function SpokenTextView.Create(parent, owner)
	local view = setmetatable({ owner = owner }, TextView)
	view.range = 0

	local scroll = CreateFrame("ScrollFrame", nil, parent)
	if scroll.SetClipsChildren then
		scroll:SetClipsChildren(true)
	end
	scroll:EnableMouseWheel(true)
	scroll:SetScript("OnMouseWheel", function(_, delta)
		view:ScrollTo(scroll:GetVerticalScroll() - (delta * SCROLL_STEP))
	end)
	scroll:SetScript("OnVerticalScroll", function()
		view:UpdateScrollBar()
	end)

	local child = CreateFrame("Frame", nil, scroll)
	child:SetSize(1, 1)
	scroll:SetScrollChild(child)

	local text = child:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	text:SetPoint("TOPLEFT", child, "TOPLEFT", 0, -PAD_TOP)
	text:SetJustifyH("LEFT")
	text:SetJustifyV("TOP")
	text:SetWordWrap(true)
	text:SetSpacing(2)

	view.frame = scroll
	view.child = child
	view.text = text

	BuildScrollBar(view, parent)
	BuildFade(view, parent)

	-- Masked only where the client has mask textures.
	local picture = child:CreateTexture(nil, "ARTWORK")
	picture:SetAlpha(PICTURE_ALPHA)
	picture:Hide()
	view.picture = picture
	if child.CreateMaskTexture and picture.AddMaskTexture then
		view.pictureMask = child:CreateMaskTexture()
		view.pictureMask:SetAllPoints(picture)
		picture:AddMaskTexture(view.pictureMask)
	end

	-- An anchored frame has no resolved width until it has been laid out, so the
	-- first SetText can arrive with width 0 and fail to wrap. Re-wrap whenever the
	-- width actually changes. Setting the child/FontString width does not resize
	-- the ScrollFrame, so this cannot recurse.
	scroll:SetScript("OnSizeChanged", function(self)
		local width = self:GetWidth() or 0
		-- Taller or shorter too: the words may run past the view now, or fit.
		if width > 0 and (width ~= view.wrappedAt or (self:GetHeight() or 0) ~= view.wrappedHigh) then
			if view.lastParts then
				view:SetParts(view.lastParts)
			elseif view.lastText then
				view:SetText(view.lastText)
			end
		end
	end)

	return view
end

--------------------------------------------------------------------------------
-- Content
--------------------------------------------------------------------------------

function TextView:SetText(str)
	self.lastText = str or ""
	self.lastParts = nil
	self:HideParts()
	self.text:Show()

	-- The scroll child does not inherit the ScrollFrame's width, so both it and
	-- the FontString have to be told, or the text will not wrap. Room for the
	-- scrollbar only where the words run past the view (Settle).
	local width = (self.frame:GetWidth() or 0) - self:BarRoom()
	if width > 0 then
		self.child:SetWidth(width)
		self.text:SetWidth(width)
		self.wrappedAt, self.wrappedHigh = self.frame:GetWidth(), self.frame:GetHeight()
	end

	self.text:SetText(self.lastText)

	local pictureRoom = 0
	self.text:ClearAllPoints()
	if self.pictureFile and width > 0 then
		local w = math.min(width, PICTURE_MOST)
		-- A clean picture shows only its middle: drawn smaller by as much, so each of its pixels
		-- is as large on screen as on the parchment, not blurred by stretching.
		if self.cleanPictures then w = math.floor(w * (1 - 2 * PICTURE_CROP)) end
		local h = math.floor(w / 2)
		self.picture:SetSize(w, h)
		self.picture:ClearAllPoints()
		local room = self.cleanPictures and CLEAN_ROOM or 0
		self.picture:SetPoint("TOP", self.child, "TOP", 0, -(PAD_TOP - PICTURE_LIFT + room))
		self.picture:Show()
		pictureRoom = h + PICTURE_GAP - PICTURE_LIFT + 2 * room
	else
		self.picture:Hide()
	end
	if self.pictureEdge then self.pictureEdge:SetShown(self.picture:IsShown()) end
	self.text:SetPoint("TOPLEFT", self.child, "TOPLEFT", 0, -(PAD_TOP + pictureRoom))

	-- Painted here, not once after SetText: a re-wrap (OnSizeChanged) comes back through this, and
	-- would otherwise put full ink on words the page had faded, such as the line saying a place has
	-- no story yet.
	self:Paint(self.text)

	self.child:SetHeight((self.text:GetStringHeight() or 0) + pictureRoom + PAD_TOP + PAD_BOTTOM)
	self:Settle(function() self:SetText(self.lastText) end)
	self.frame:SetVerticalScroll(0)
	self:UpdateScrollBar()
	self:UpdateFade()
end

--- The same scroll bar on a scroll frame of the caller's own (the lore window's list of places):
--- `child` its scroll child, `parent` what the bar is drawn in. Leaves the bar's width plus a
--- gap free on the right of `child`, so nothing in it runs under the bar.
function SpokenTextView.AddScrollBar(scroll, child, parent)
	local view = setmetatable({ frame = scroll, child = child, range = 0 }, TextView)
	BuildScrollBar(view, parent)
	-- The child as wide as the frame, but for the bar's room while the bar shows (UpdateScrollBar).
	view.fitsChild = true
	local function Fit()
		view:UpdateScrollBar()
	end
	scroll:HookScript("OnSizeChanged", Fit)
	child:HookScript("OnSizeChanged", function() view:UpdateScrollBar() end)
	if scroll:GetScript("OnVerticalScroll") then
		scroll:HookScript("OnVerticalScroll", function() view:UpdateScrollBar() end)
	else
		scroll:SetScript("OnVerticalScroll", function() view:UpdateScrollBar() end)
	end
	Fit()
	return view
end

--- The words' face and size on `fontString`: the quest text's face on a parchment page, as a
--- quest's own words are written there, in the caller's colour over the page's ink.
function TextView:Paint(fontString)
	local fontObject = self.ink and _G.QuestFont or GameFontHighlight
	local fontPath = FontFile(self, fontObject)
	if fontPath then fontString:SetFont(fontPath, FontSize() + (self.ink and 1 or 0), "") end
	local colour = self.color or self.ink
	if colour then fontString:SetTextColor(colour[1], colour[2], colour[3]) end
	if self.ink then fontString:SetShadowColor(0, 0, 0, 0) end
end

--- A part's caption: the words' face, smaller, in the page's ink.
function TextView:PaintCaption(fontString)
	local fontObject = self.ink and _G.QuestFont or GameFontHighlight
	local fontPath = FontFile(self, fontObject)
	local size = Clamp(FontSize() - CAPTION_LESS, CAPTION_LEAST, CAPTION_MOST)
	if fontPath then fontString:SetFont(fontPath, size, "") end
	if self.ink then
		fontString:SetTextColor(self.ink[1], self.ink[2], self.ink[3])
		fontString:SetShadowColor(0, 0, 0, 0)
	end
end

-- The parts' headings, captions and words hidden, and their buttons and faces but those in `keep`.
function TextView:HideParts(keep)
	for _, part in ipairs(self.parts or {}) do
		part.heading:Hide()
		part.caption:Hide()
		part.words:Hide()
	end
	for _, button in ipairs(self.partButtons or {}) do
		if not (keep and keep[button]) then button:Hide() end
	end
	self.partButtons = nil
end

--- Words in parts instead of one block: a quest's offer and hand-in. Each part is a heading, its
--- `buttons` (round buttons the caller made on view.child, rightmost first) on the heading's line
--- at the right, and its words under it. A part may have a `face`, a frame the caller made on
--- view.child (Spoken:CreateSpeakerFace): it stands at the left of the heading's line, which is
--- then as tall as it, with the heading right of it under its `caption`. A part with no heading,
--- face or buttons is its words alone (a writing's words under where it is found).
--- A part may also have `cards`, frames the caller made on view.child, each as tall as it wants
--- to be: they fill the width in `columns` (3) under the heading, the words under them.
--- `parts` = { { heading, text, buttons, face, caption, cards, columns } }. Kept for re-wraps, as SetText's
--- text is; SetText goes back to one block.
function TextView:SetParts(parts)
	local keep = {}
	for _, part in ipairs(parts) do
		for _, button in ipairs(part.buttons or {}) do keep[button] = true end
		if part.face then keep[part.face] = true end
		for _, card in ipairs(part.cards or {}) do keep[card] = true end
	end
	self:HideParts(keep)
	self.lastParts = parts
	self.lastText = nil
	self.text:SetText("")
	self.text:Hide()
	self.picture:Hide()
	if self.pictureEdge then self.pictureEdge:Hide() end
	self.parts = self.parts or {}

	local width = (self.frame:GetWidth() or 0) - self:BarRoom()
	if width > 0 then
		self.child:SetWidth(width)
		self.wrappedAt, self.wrappedHigh = self.frame:GetWidth(), self.frame:GetHeight()
	end
	local titleFace = _G.QuestTitleFont and _G.QuestTitleFont.GetFont and _G.QuestTitleFont:GetFont()
	local shown = {}
	local y = PAD_TOP
	for i, part in ipairs(parts) do
		local slot = self.parts[i]
		if not slot then
			slot = { heading = self.child:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge"),
				caption = self.child:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall"),
				words = self.child:CreateFontString(nil, "ARTWORK", "GameFontHighlight") }
			for _, line in ipairs({ slot.heading, slot.caption }) do
				line:SetJustifyH("LEFT")
				if line.SetWordWrap then line:SetWordWrap(false) end
			end
			slot.words:SetJustifyH("LEFT")
			slot.words:SetJustifyV("TOP")
			slot.words:SetWordWrap(true)
			slot.words:SetSpacing(2)
			self.parts[i] = slot
		end
		local face = part.face
		-- A part with no heading, face or buttons is its words alone, set apart by room.
		local headless = part.heading == nil and not face and not (part.buttons and part.buttons[1])
		if i > 1 then
			y = y + PART_GAP
		elseif not face and not headless then
			y = y - HEAD_LIFT
		end
		if headless then
			slot.heading:Hide()
			slot.caption:Hide()
		else
			-- The buttons from the right, BUTTON_GAP apart, centred `middle` down; the leftmost shown.
			local function PlaceButtons(middle)
				local previous
				for _, button in ipairs(part.buttons or {}) do
					if button:IsShown() then
						button:ClearAllPoints()
						if previous then
							button:SetPoint("RIGHT", previous, "LEFT", -BUTTON_GAP, 0)
						else
							button:SetPoint("RIGHT", self.child, "TOPLEFT", math.max(width, 1), -middle)
						end
						previous = button
						table.insert(shown, button)
					end
				end
				return previous
			end
			local font = _G.QuestTitleFont and FontFile(self, _G.QuestTitleFont) or titleFace
			if font then slot.heading:SetFont(font, math.min(FontSize() + HEAD_SIZE, HEAD_MOST), "") end
			local head = self.headInk or HEAD_INK
			slot.heading:SetTextColor(head[1], head[2], head[3])
			slot.heading:SetShadowColor(0, 0, 0, 0)
			slot.heading:SetText(part.heading or "")
			local caption = part.caption ~= "" and part.caption or nil
			local block = slot.heading:GetStringHeight() or 0
			if caption then
				self:PaintCaption(slot.caption)
				slot.caption:SetText(caption)
				block = block + CAPTION_GAP + (slot.caption:GetStringHeight() or 0)
			end
			-- The heading's line: as tall as the face, or the caption and the heading where they are taller.
			local line = math.max(HEAD_LINE, face and (face:GetHeight() or 0) or 0, caption and block or 0)
			local middle = y + line / 2
			local previous = PlaceButtons(middle)
			local left = 0
			if face then
				face:ClearAllPoints()
				face:SetPoint("LEFT", self.child, "TOPLEFT", 0, -middle)
				face:Show()
				table.insert(shown, face)
				left = (face:GetWidth() or 0) + FACE_GAP
			end
			-- A line of text from `left` to the buttons, centred `at` down from the top.
			local function Across(text, at)
				text:ClearAllPoints()
				text:SetPoint("LEFT", self.child, "TOPLEFT", left, -at)
				if previous then
					text:SetPoint("RIGHT", previous, "LEFT", -8, middle - at)
				else
					text:SetPoint("RIGHT", self.child, "TOPLEFT", math.max(width, 1), -at)
				end
				text:Show()
			end
			if caption then
				-- The caption over the heading, the two centred on the line together.
				local top = middle - block / 2
				local captionHigh = slot.caption:GetStringHeight() or 0
				Across(slot.caption, top + captionHigh / 2)
				Across(slot.heading, top + captionHigh + CAPTION_GAP + (slot.heading:GetStringHeight() or 0) / 2)
			else
				slot.caption:Hide()
				Across(slot.heading, middle)
			end
			y = y + line + HEAD_GAP
		end

		local cards = part.cards
		if cards and cards[1] then
			local columns = math.max(1, part.columns or CARD_COLUMNS)
			local across = math.max(1, (width - CARD_GAP * (columns - 1)) / columns)
			local high = cards[1]:GetHeight() or 0
			for index, card in ipairs(cards) do
				local column, row = (index - 1) % columns, math.floor((index - 1) / columns)
				card:ClearAllPoints()
				card:SetWidth(across)
				card:SetPoint("TOPLEFT", self.child, "TOPLEFT", column * (across + CARD_GAP), -(y + row * (high + CARD_GAP)))
				card:Show()
				table.insert(shown, card)
			end
			y = y + math.ceil(#cards / columns) * (high + CARD_GAP) - CARD_GAP
		end

		self:Paint(slot.words)
		slot.words:ClearAllPoints()
		slot.words:SetPoint("TOPLEFT", self.child, "TOPLEFT", 0, -y)
		if width > 0 then slot.words:SetWidth(width) end
		slot.words:SetText(part.text or "")
		slot.words:Show()
		y = y + (slot.words:GetStringHeight() or 0)
	end
	for i = #parts + 1, #self.parts do
		self.parts[i].heading:Hide()
		self.parts[i].caption:Hide()
		self.parts[i].words:Hide()
	end
	self.partButtons = shown

	-- The caller's own control under the last part (`extraBelow` high), told where that is.
	if self.onPartsEnd then self.onPartsEnd(y) end
	self.child:SetHeight(y + PAD_BOTTOM + (self.extraBelow or 0))
	self:Settle(function() self:SetParts(parts) end)
	self.frame:SetVerticalScroll(0)
	self:UpdateScrollBar()
	self:UpdateFade()
end

--- A picture above the text from the next SetText on: `file` a texture, `mask` the one fraying its
--- edge. nil for none.
function TextView:SetPicture(file, mask)
	self.pictureFile, self.pictureMaskFile = file, mask
	if not file then return end
	self.picture:SetTexture(file)
	local crop = self.cleanPictures and PICTURE_CROP or 0
	self.picture:SetTexCoord(crop, 1 - crop, crop, 1 - crop)
	local maskTexture = self.pictureMask
	if maskTexture then
		-- A clean picture has no mask at all: a white 8 by 8 mask stretched over it and clamped to
		-- black would shade its outer half-texel, some 16 px in from each side, dark.
		local masked = not self.cleanPictures
		if masked ~= (self.pictureMasked ~= false) and self.picture.RemoveMaskTexture then
			if masked then self.picture:AddMaskTexture(maskTexture) else self.picture:RemoveMaskTexture(maskTexture) end
			self.pictureMasked = masked
		end
		maskTexture:SetTexture(mask or [[Interface\Buttons\WHITE8X8]], "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE")
	end
end

--- Pictures with straight edges, from now on: no frayed mask, the painted edge cut off, and a
--- 1 px edge in EllesmereUI's grey round them with `edged`, which needs its look on.
function TextView:SetCleanPictures(on, edged)
	self.cleanPictures = on and true or nil
	if on and edged and not self.pictureEdge then
		local frame = CreateFrame("Frame", nil, self.child)
		frame:SetAllPoints(self.picture)
		SpokenEnv.Ellesmere:Edges(frame, frame, SpokenLayout.Pixels(frame, 1, 1), 0)
		frame:SetShown(self.picture:IsShown())
		self.pictureEdge = frame
	end
	if self.pictureFile then self:SetPicture(self.pictureFile, self.pictureMaskFile) end
end

--- Dark words for a parchment page, without the shadow that smudges them there.
function TextView:SetInk(r, g, b)
	self.ink = r and { r, g, b } or nil
end

--- The parts' headings' colour in place of their near-black; nil goes back to it.
function TextView:SetHeadInk(r, g, b)
	self.headInk = r and { r, g, b } or nil
end

--- `fontObject`'s font in place of the quest text's and the game's for the words, the captions and
--- the headings; nil goes back to those.
function TextView:SetFace(fontObject)
	self.faceObject = fontObject
end

--- The words' colour, kept across re-wraps; nil goes back to the ink, or the font's own.
function TextView:SetColor(r, g, b)
	self.color = r and { r, g, b } or nil
	if self.color then self.text:SetTextColor(r, g, b) end
end

function TextView:SetThumbColor(r, g, b)
	self.thumbColor = { r, g, b }
	if self.PaintThumb then self:PaintThumb() end
end

function TextView:Show()
	self.frame:Show()
	self:UpdateScrollBar()
	self:PaintFade()
end

function TextView:Hide()
	self.frame:Hide()
	self.bar:Hide()
	self:UpdateFade()
end
