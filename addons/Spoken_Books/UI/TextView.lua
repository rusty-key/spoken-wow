-- A scrolling block of wrapped text, with a scrollbar: Spoken Zones' stories, beside the map and in
-- Azeroth's Compendium, and Spoken Books' readables there, so all of them scroll and wrap alike.
--
-- Carried byte for byte by both addons, as UI/Layout.lua is: what it makes goes on the addon that
-- loads it (`...`), which also answers the words' size (Addon:Get("fontSize")).
--
-- The scrollbar is built by hand from the game's minimal scroll bar art (MinimalScrollBar's
-- track and small thumb, as the quest log and the settings draw them) rather than inherited:
-- the template's ScrollBox plumbing cannot be checked without launching the game, and a track
-- and a thumb are fully deterministic. A plain bar where the client has not got the art.
--
-- Where the text runs past the view it fades out at the cut edge rather than stopping on a
-- clean line: a strip of the page's own background (TextView:SetFadeSource), drawn over the
-- text, clear on the inside and solid at the edge.

local ADDON_NAME, Addon = ...

local SCROLL_STEP = 28
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
function Addon:Unsnap(texture)
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
		Addon:Unsnap(strip)
		strip:Hide()
		table.insert(view.strips, strip)
		return strip
	end
	local function Edge(edge, outward)
		local solid = Strip()
		solid:SetHeight(SOLID + EDGE_OUT)
		solid:SetPoint(edge .. "LEFT", view.frame, edge .. "LEFT", 0, outward * EDGE_OUT)
		solid:SetPoint(edge .. "RIGHT", view.frame, edge .. "RIGHT", right, outward * EDGE_OUT)
		-- From the solid band inward, the most solid step first, each under the last.
		local far = edge == "TOP" and "BOTTOM" or "TOP"
		local previous = solid
		for i = #FADE_STEPS, 1, -1 do
			local step = FADE_STEPS[i]
			local ramp = Strip()
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

local function PaintStrip(strip, source)
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
-- it copes with the frame being resized after creation.
function Addon:CreateTextView(parent)
	local view = setmetatable({}, TextView)
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
		if width > 0 and width ~= view.wrappedAt and view.lastText then
			view:SetText(view.lastText)
		end
	end)

	return view
end

--------------------------------------------------------------------------------
-- Content
--------------------------------------------------------------------------------

function TextView:SetText(str)
	self.lastText = str or ""

	-- The scroll child does not inherit the ScrollFrame's width, so both it and
	-- the FontString have to be told, or the text will not wrap. Leave room for
	-- the scrollbar so it never sits on top of the last few characters.
	local width = (self.frame:GetWidth() or 0) - (self.barWidth + 6)
	if width > 0 then
		self.child:SetWidth(width)
		self.text:SetWidth(width)
		self.wrappedAt = self.frame:GetWidth()
	end

	self.text:SetText(self.lastText)

	local pictureRoom = 0
	self.text:ClearAllPoints()
	if self.pictureFile and width > 0 then
		local w = math.min(width, PICTURE_MOST)
		local h = math.floor(w / 2)
		self.picture:SetSize(w, h)
		self.picture:ClearAllPoints()
		self.picture:SetPoint("TOP", self.child, "TOP", 0, -(PAD_TOP - PICTURE_LIFT))
		self.picture:Show()
		pictureRoom = h + PICTURE_GAP - PICTURE_LIFT
	else
		self.picture:Hide()
	end
	self.text:SetPoint("TOPLEFT", self.child, "TOPLEFT", 0, -(PAD_TOP + pictureRoom))

	-- The quest text's face on a parchment page, as a quest's own words are written there.
	local fontObject = self.ink and _G.QuestFont or GameFontHighlight
	-- Where the addon reads a language other than the client's (only Zones does), in a file that
	-- draws its script.
	local fontPath = Addon.FontFor and Addon:FontFor(fontObject)
		or (fontObject and fontObject.GetFont and fontObject:GetFont())
	if fontPath then
		self.text:SetFont(fontPath, Addon:Get("fontSize") + (self.ink and 1 or 0), "")
	end
	if self.ink then
		self.text:SetTextColor(self.ink[1], self.ink[2], self.ink[3])
		self.text:SetShadowColor(0, 0, 0, 0)
	end
	-- The caller's colour over the ink, here rather than once after SetText: a re-wrap
	-- (OnSizeChanged) comes back through this, and would otherwise put full ink on words the
	-- page had faded, such as the line saying a place has no story yet.
	if self.color then
		self.text:SetTextColor(self.color[1], self.color[2], self.color[3])
	end

	self.child:SetHeight((self.text:GetStringHeight() or 0) + pictureRoom + PAD_TOP + PAD_BOTTOM)
	self.frame:SetVerticalScroll(0)
	self:UpdateScrollBar()
	self:UpdateFade()
end

--- The same scroll bar on a scroll frame of the caller's own (the lore window's list of places):
--- `child` its scroll child, `parent` what the bar is drawn in. Leaves the bar's width plus a
--- gap free on the right of `child`, so nothing in it runs under the bar.
function Addon:AddScrollBar(scroll, child, parent)
	local view = setmetatable({ frame = scroll, child = child, range = 0 }, TextView)
	BuildScrollBar(view, parent)
	local function Fit()
		local width = scroll:GetWidth() or 0
		if width > 0 then child:SetWidth(width - view.barWidth - 6) end
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

--- A picture above the text from the next SetText on: `file` a texture, `mask` the one fraying its
--- edge. nil for none.
function TextView:SetPicture(file, mask)
	self.pictureFile = file
	if not file then return end
	self.picture:SetTexture(file)
	if self.pictureMask then
		self.pictureMask:SetTexture(mask or [[Interface\Buttons\WHITE8X8]], "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE")
	end
end

--- Dark words for a parchment page, without the shadow that smudges them there.
function TextView:SetInk(r, g, b)
	self.ink = r and { r, g, b } or nil
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
