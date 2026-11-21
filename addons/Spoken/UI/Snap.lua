setfenv(1, SpokenEnv)

-- Dragging a narrator window: its edges and its middle meet the screen's edges and middle, and its
-- home where it has one, with a guide line across the screen where one holds. Shift drags it free.
-- Every length here is in UI units, up from the screen's bottom left.
Snap = {}

-- How close, in screen pixels, a window comes before it is drawn to a line.
local REACH = 10
local GUIDE = { 1, 0.82, 0, 0.8 }

-- The pull of the nearest of `options`, { { where it is, where it would go } }, within `reach`: how
-- far to move, and the place it lands on. 0 and nil where nothing is near.
local function Pull(reach, options)
    local best, target
    for _, option in ipairs(options) do
        local delta = option[2] - option[1]
        if math.abs(delta) <= reach and (not best or math.abs(delta) < math.abs(best)) then
            best, target = delta, option[2]
        end
    end
    return best or 0, target
end

--- Where a window `width` by `height`, its top left at `left`, `top`, comes to rest: its left, middle
--- and right edges on the screen's, its top, middle and bottom on the screen's, and its top left on
--- `homeLeft` and `homeTop` where given. Also the vertical line and the horizontal line it holds
--- on, as places on the screen, nil where it holds on none.
function Snap.Fit(left, top, width, height, homeLeft, homeTop)
    local reach = REACH / UIParent:GetEffectiveScale()
    local screenWidth, screenHeight = UIParent:GetWidth(), UIParent:GetHeight()
    local across = { { left, 0 }, { left + width / 2, screenWidth / 2 }, { left + width, screenWidth } }
    if homeLeft then table.insert(across, { left, homeLeft }) end
    local up = { { top, screenHeight }, { top - height / 2, screenHeight / 2 }, { top - height, 0 } }
    if homeTop then table.insert(up, { top, homeTop }) end
    local dx, lineX = Pull(reach, across)
    local dy, lineY = Pull(reach, up)
    return left + dx, top + dy, lineX, lineY
end

local guides
local function ShowGuides(lineX, lineY)
    if not lineX and not lineY then
        if guides then guides:Hide() end
        return
    end
    if not guides then
        guides = CreateFrame("Frame", nil, UIParent)
        guides:SetAllPoints(UIParent)
        guides:SetFrameStrata("TOOLTIP")
        guides.across = guides:CreateTexture(nil, "OVERLAY")
        guides.up = guides:CreateTexture(nil, "OVERLAY")
        for _, line in ipairs({ guides.across, guides.up }) do
            if line.SetColorTexture then
                line:SetColorTexture(GUIDE[1], GUIDE[2], GUIDE[3], GUIDE[4])
            else
                line:SetTexture(GUIDE[1], GUIDE[2], GUIDE[3], GUIDE[4])
            end
        end
        local thin = SpokenLayout and SpokenLayout.Pixels and SpokenLayout.Pixels(guides, 1) or 1
        guides.across:SetWidth(thin)
        guides.up:SetHeight(thin)
    end
    guides.across:ClearAllPoints()
    guides.up:ClearAllPoints()
    if lineX then
        guides.across:SetPoint("TOPLEFT", guides, "TOPLEFT", lineX, 0)
        guides.across:SetPoint("BOTTOMLEFT", guides, "BOTTOMLEFT", lineX, 0)
    end
    if lineY then
        guides.up:SetPoint("BOTTOMLEFT", guides, "BOTTOMLEFT", 0, lineY)
        guides.up:SetPoint("BOTTOMRIGHT", guides, "BOTTOMRIGHT", 0, lineY)
    end
    if lineX then guides.across:Show() else guides.across:Hide() end
    if lineY then guides.up:Show() else guides.up:Hide() end
    guides:Show()
end

local driver = CreateFrame("Frame")
local state

function Snap.Move()
    local drag = state
    local frame = drag.frame
    local options = drag.options
    if not frame:IsShown() or (options.locked and options.locked()) then
        Snap.Stop()
        return
    end
    local ui = UIParent:GetEffectiveScale()
    local scale = frame:GetEffectiveScale() / ui
    local width, height = frame:GetWidth() * scale, frame:GetHeight() * scale
    local x, y = GetCursorPosition()
    local screenWidth, screenHeight = UIParent:GetWidth(), UIParent:GetHeight()
    -- Kept on the screen, as a window that is clamped to it is.
    local left = math.max(0, math.min(screenWidth - width, drag.left + (x - drag.x) / ui))
    local top = math.max(math.min(height, screenHeight), math.min(screenHeight, drag.top + (y - drag.y) / ui))
    local lineX, lineY
    if not (IsShiftKeyDown and IsShiftKeyDown()) then
        local homeLeft, homeTop
        if options.home then homeLeft, homeTop = options.home() end
        left, top, lineX, lineY = Snap.Fit(left, top, width, height, homeLeft, homeTop)
    end
    if options.place then
        options.place(left, top, width, height)
    else
        frame:ClearAllPoints()
        frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", left / scale, top / scale)
    end
    ShowGuides(lineX, lineY)
end

--- Start dragging `frame` after the pointer. `options`: home() the place its top left rests at by
--- default (left, top), locked() true to let go, place(left, top, width, height) to put it somewhere
--- other than by its top left.
function Snap.Start(frame, options)
    local left, top = frame:GetLeft(), frame:GetTop()
    if not left or not top then return end
    local scale = frame:GetEffectiveScale() / UIParent:GetEffectiveScale()
    local x, y = GetCursorPosition()
    state = { frame = frame, options = options or {}, x = x, y = y, left = left * scale, top = top * scale }
    driver:SetScript("OnUpdate", Snap.Move)
end

--- The window being dragged, or nil.
function Snap.Active()
    return state and state.frame or nil
end

--- Let go of the window, wherever it is.
function Snap.Stop()
    if not state then return end
    state = nil
    driver:SetScript("OnUpdate", nil)
    ShowGuides(nil, nil)
end
