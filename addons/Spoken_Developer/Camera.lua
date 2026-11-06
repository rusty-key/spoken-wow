-- The camera editor: moves, turns and zooms a boss's 3D model in its frame, to set where its camera
-- sits. Spoken frames a boss from its loaded model and moves that camera by
-- a nudge kept in Spoken_Bosses/Data/CameraNudges.lua; this is how a nudge is made.
--
-- Spoken's TextView asks SpokenTextView.cameraEdits(place, group) for the nudge of a model and calls
-- SpokenTextView.onCreate(view) for each view it builds, so the editor is only here, and a player,
-- who does not have this module, has no edits and no editor. An edit is kept per model file (`group`:
-- bosses on the same file move together) and per place (`place`: the Compendium page and the boss's
-- story on the map each have their own) in SpokenDeveloperDB.cameraEdits[place][group] =
-- { right, up, zoom, turn }, the shape the pipeline reads back from this module's saved variables.
--
-- Chat and the on-screen hint stay English, as in the rest of this module: they are read by whoever
-- sets the cameras.

local _, Developer = ...

local Camera = {}
Developer.Camera = Camera

-- The guide's frame, as far in from the model frame's edge as the boss is framed to stand.
local GUIDE_INSET = 0.07
-- A right-drag turns the boss this many radians for each frame height dragged.
local TURN_PER_FRAME_HEIGHT = 3
local WHEEL_STEP = 1.03
-- The zoom stays inside these: a zoom that rounds to 0 is not a camera, and TextView would ignore the row.
local ZOOM_MIN, ZOOM_MAX = 0.25, 8
local RED, BLUE = { 0.86, 0.12, 0.12 }, { 0.1, 0.45, 1 }

Camera.editing = false
-- Weak: a view the game drops is dropped here too.
local views = setmetatable({}, { __mode = "k" })
local active = setmetatable({}, { __mode = "k" })
local guides = setmetatable({}, { __mode = "k" })

local function Round(v)
	return math.floor(v * 10000 + 0.5) / 10000
end

--- A line one screen pixel thick as `frame` is drawn.
local function Pixel(frame)
	local layout = _G.SpokenLayout
	return layout and layout.Pixels and layout.Pixels(frame, 1, 1) or 1
end

--- What the editor saved for a model in a place, as TextView asks for it.
function Camera.Saved(place, group)
	local edits = Developer:DB().cameraEdits
	return edits and edits[place] and edits[place][group] or nil
end

--- The one way a change is written, as { right, up, zoom, turn }. Every view of a boss on the same model
--- in the same place shows it at once. Nothing is written for a model that is not framed yet.
function Camera:Set(view, right, up, zoom, turn)
	local group, place = view:CameraGroup(), view:CameraPlace()
	if not group or not view.modelCamera then return false end
	zoom = math.min(ZOOM_MAX, math.max(ZOOM_MIN, zoom))
	local db = Developer:DB()
	if type(db.cameraEdits) ~= "table" then db.cameraEdits = {} end
	db.cameraEdits[place] = db.cameraEdits[place] or {}
	db.cameraEdits[place][group] = { Round(right), Round(up), Round(zoom), Round(turn) }
	view:ApplyModelCamera()
	for other in pairs(views) do
		if other ~= view and other.modelDisplayID and other:CameraGroup() == group and other:CameraPlace() == place then
			other:ApplyModelCamera()
		end
	end
	return true
end

--- Moves the boss `right` and `up` by that many frame heights (as it is drawn now), zooms it by the factor
--- `zoom` and turns it `yaw` radians.
function Camera:Edit(view, right, up, zoom, yaw)
	local row = view:CameraNudge() or { 0, 0, 1, 0 }
	-- The pan is measured at the base distance: one frame height on screen now is 1/zoom of one at the base.
	return self:Set(view, row[1] + right / row[3], row[2] + up / row[3], row[3] * (zoom or 1), row[4] + (yaw or 0))
end

--- Back to the camera framed for the model, whatever Data/CameraNudges.lua holds for it.
function Camera:Reset(view)
	return self:Set(view, 0, 0, 1, 0)
end

local function BuildGuide(view)
	local guide = CreateFrame("Frame", nil, view.modelEdgeFrame)
	guide:SetAllPoints(view.model)
	local function line(color)
		local t = guide:CreateTexture(nil, "OVERLAY")
		t:SetColorTexture(color[1], color[2], color[3], 0.9)
		return t
	end
	local top, bottom, left, right, middle = line(RED), line(RED), line(RED), line(RED), line(BLUE)
	local function place()
		local inset, thick = guide:GetHeight() * GUIDE_INSET, Pixel(guide)
		top:ClearAllPoints()
		top:SetPoint("TOPLEFT", guide, "TOPLEFT", inset, -inset)
		top:SetPoint("TOPRIGHT", guide, "TOPRIGHT", -inset, -inset)
		top:SetHeight(thick)
		bottom:ClearAllPoints()
		bottom:SetPoint("BOTTOMLEFT", guide, "BOTTOMLEFT", inset, inset)
		bottom:SetPoint("BOTTOMRIGHT", guide, "BOTTOMRIGHT", -inset, inset)
		bottom:SetHeight(thick)
		left:ClearAllPoints()
		left:SetPoint("TOPLEFT", guide, "TOPLEFT", inset, -inset)
		left:SetPoint("BOTTOMLEFT", guide, "BOTTOMLEFT", inset, inset)
		left:SetWidth(thick)
		right:ClearAllPoints()
		right:SetPoint("TOPRIGHT", guide, "TOPRIGHT", -inset, -inset)
		right:SetPoint("BOTTOMRIGHT", guide, "BOTTOMRIGHT", -inset, inset)
		right:SetWidth(thick)
		middle:ClearAllPoints()
		middle:SetPoint("TOP", guide, "TOP", 0, 0)
		middle:SetPoint("BOTTOM", guide, "BOTTOM", 0, 0)
		middle:SetWidth(thick)
	end
	guide:SetScript("OnSizeChanged", place)
	place()
	guide.hint = guide:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
	guide.hint:SetPoint("BOTTOMLEFT", guide, "TOPLEFT", 0, 2)
	return guide
end

--- The guide over a view's model, built once; nil, said once in chat, if it cannot be built. Editing
--- works without it.
local function Guide(view)
	if guides[view] == nil then
		local ok, guide = pcall(BuildGuide, view)
		if ok then
			guides[view] = guide
		else
			guides[view] = false
			Developer:Print("the camera guide could not be built: %s", tostring(guide))
		end
	end
	return guides[view] or nil
end

--- Puts a view's model into or out of editing: on while editing is on and the model has been framed, off
--- otherwise. Called when editing is switched and whenever the view shows another model.
function Camera:Refresh(view)
	local model = view.model
	if not model then return end
	local on = self.editing and view.modelDisplayID and view.modelCamera and true or false
	if not on and not active[view] then return end
	active[view] = on or nil
	if on then
		local guide = Guide(view)
		local drag
		model:EnableMouse(true)
		model:EnableMouseWheel(true)
		model:SetScript("OnMouseDown", function(_, button)
			if button == "LeftButton" or button == "RightButton" then
				local x, y = GetCursorPosition()
				drag = { x = x, y = y, button = button }
			end
		end)
		model:SetScript("OnMouseUp", function() drag = nil end)
		model:SetScript("OnHide", function() drag = nil end)
		model:SetScript("OnUpdate", function()
			if not drag then return end
			local x, y = GetCursorPosition()
			local high = model:GetHeight() * model:GetEffectiveScale()
			if high > 0 then
				if drag.button == "RightButton" then
					self:Edit(view, 0, 0, 1, (x - drag.x) / high * TURN_PER_FRAME_HEIGHT)
				else
					self:Edit(view, (x - drag.x) / high, (y - drag.y) / high, 1, 0)
				end
			end
			drag.x, drag.y = x, y
		end)
		model:SetScript("OnMouseWheel", function(_, delta) self:Edit(view, 0, 0, WHEEL_STEP ^ delta, 0) end)
		if guide then
			guide.hint:SetText(view:CameraPlace() .. " " .. view.modelDisplayID
				.. ": drag to move, right-drag to turn, wheel to zoom (/spokenbosscam off)")
			guide:Show()
		end
	else
		model:EnableMouse(false)
		model:EnableMouseWheel(false)
		for _, script in ipairs({ "OnMouseDown", "OnMouseUp", "OnHide", "OnUpdate", "OnMouseWheel" }) do
			model:SetScript(script, nil)
		end
		if guides[view] then guides[view]:Hide() end
	end
end

--- Takes part in a view TextView has just built.
function Camera:Attach(view)
	views[view] = true
	view.onModel = function() self:Refresh(view) end
end

function Camera:SetEditing(on)
	self.editing = on and true or false
	for view in pairs(views) do
		local ok, err = pcall(self.Refresh, self, view)
		if not ok then Developer:Print("camera editing failed: %s", tostring(err)) end
	end
end

--- How many models have an edit, in all places.
function Camera:Count()
	local n = 0
	for _, groups in pairs(Developer:DB().cameraEdits or {}) do
		for _ in pairs(groups) do n = n + 1 end
	end
	return n
end

--- Resets every shown boss that has a camera; how many.
function Camera:ResetShown()
	local n = 0
	for view in pairs(views) do
		if view.modelCamera and view.model and view.model:IsVisible() and self:Reset(view) then n = n + 1 end
	end
	return n
end

local USAGE = "/spokenbosscam [on | off | reset | count]"

--- `/spokenbosscam`: nothing switches editing on or off.
function Camera:Command(msg)
	msg = strlower(strtrim(msg or ""))
	if not _G.SpokenTextView or not _G.SpokenTextView.onCreate then
		Developer:Print("Spoken is missing or too old: there is no camera to edit.")
	elseif msg == "reset" then
		local n = self:ResetShown()
		Developer:Print(n > 0 and "reset the boss in view, and every boss on its model" or "no boss with a camera is in view")
	elseif msg == "count" then
		Developer:Print("models changed by hand: %d", self:Count())
	elseif msg == "on" or msg == "off" or msg == "" then
		self:SetEditing(msg == "on" or (msg == "" and not self.editing))
		Developer:Print(self.editing
			and "camera editing on: drag a boss to move it, right-drag to turn it, mouse wheel to zoom; /spokenbosscam again to stop"
			or "camera editing off")
	else
		Developer:Print(USAGE)
	end
end

--- Hands TextView the editor's two hooks. False without a TextView that offers them.
function Camera:Install()
	local TextView = _G.SpokenTextView
	if not TextView then return false end
	TextView.cameraEdits = Camera.Saved
	TextView.onCreate = function(view) Camera:Attach(view) end
	return true
end
