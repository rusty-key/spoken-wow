-- The Developer page: Spoken > Developer in the game's settings, after the modules' pages. Tools for
-- trying Spoken out, which a player never needs: this module's debug log first, then what feature
-- addons handed Spoken with Spoken:AddDeveloperSettings (Spoken keeps them until this builds the
-- page, and announces a late one with DEVELOPER_SETTINGS_ADDED): every module's switches for
-- messages in chat under one title, then every module's testing tools, then any section of its own.
--
-- Nested under Spoken's own entry.

local _, Developer = ...

local L = Developer.L
local Log, Copy, Write = Developer.Log, Developer.Copy, Developer.Write

local INDENT, TOP = 25, 16
-- Where a row's label starts (Layout's LABEL_X), and the game's information icon.
local LABEL_X = 37
local INFO_ICON = [[Interface\Common\help-i]]
local INFO_SIZE = 26
-- The game's light blue for help, apart from the grey notes and the gold labels.
local HELP_TITLE = { 0.45, 0.75, 1 }
local HELP_TEXT = { 0.72, 0.85, 1 }
-- After the modules' pages (Quests 1, Gossip 2, Places 3, Readables 4, Bosses 5).
local ORDER = 6

local panel, layout, scroller
local resets = {}

local function Fit()
	if scroller then scroller:SetContentHeight(layout:Height() + 40) end
end

local function Run(build)
	local ok, reset = pcall(build, layout)
	if ok and type(reset) == "function" then
		resets[#resets + 1] = reset
	elseif not ok then
		Developer:Print("a Developer section failed: %s", tostring(reset))
	end
end

--- The page's Defaults: the log on, and each feature addon's own.
local function Reset()
	Log:SetOn(true)
	for _, reset in ipairs(resets) do pcall(reset) end
	layout:Refresh()
end

--- How to ask an AI agent to read the log: the information icon, a question in light blue, and
--- the steps under it. As tall as its words need at the page's width, which differ by language.
local function AgentHelp()
	local frame = CreateFrame("Frame", nil, layout.parent)
	local icon = frame:CreateTexture(nil, "ARTWORK")
	icon:SetTexture(INFO_ICON)
	icon:SetSize(INFO_SIZE, INFO_SIZE)
	icon:SetPoint("TOPLEFT", frame, "TOPLEFT", LABEL_X - 4, 4)
	local title = frame:CreateFontString(nil, "ARTWORK", "GameFontNormal")
	title:SetJustifyH("LEFT")
	title:SetTextColor(HELP_TITLE[1], HELP_TITLE[2], HELP_TITLE[3])
	title:SetText(L.OPT_LOG_AGENT_TITLE)
	title:SetPoint("TOPLEFT", frame, "TOPLEFT", LABEL_X + INFO_SIZE + 4, -2)
	local steps = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
	steps:SetJustifyH("LEFT")
	steps:SetJustifyV("TOP")
	steps:SetSpacing(3)
	steps:SetTextColor(HELP_TEXT[1], HELP_TEXT[2], HELP_TEXT[3])
	steps:SetText(L.OPT_LOG_AGENT_STEPS)
	steps:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -6)
	local height = 90
	local function Fit(width)
		local room = math.max(100, width - (LABEL_X + INFO_SIZE + 4))
		title:SetWidth(room)
		steps:SetWidth(room)
		local titleHeight = title.GetStringHeight and title:GetStringHeight() or 0
		local stepsHeight = steps.GetStringHeight and steps:GetStringHeight() or 0
		if titleHeight > 0 and stepsHeight > 0 then
			height = math.floor(2 + titleHeight + 6 + stepsHeight + 14)
		end
		frame:SetSize(width, height)
	end
	layout:Custom(frame, height, Fit)
	frame.layoutRow.measure = function()
		Fit(layout:Width())
		return height
	end
	return frame
end

local function LogRows()
	layout:Section(L.OPT_LOG_SECTION)
	layout:Checkbox(L.OPT_LOG_KEEP, nil,
		function() return Log:IsOn() end,
		function(value) Log:SetOn(value) end)
	-- How much of it is used and the room it takes, read again each time the page shows.
	layout:Badge(L.OPT_LOG_SIZE, function()
		return Log:IsOn() and "ok" or "off", Developer:SizeText()
	end, nil, true)
	layout:Button(L.OPT_LOG_SHOW, nil, function() Developer.Box:Show(table.concat(Log:Merged(), "\n"), L.LOG_BOX_TITLE) end)
	layout:Button(L.OPT_LOG_COPY, nil, function() Copy:Show() end)
	layout:Button(L.OPT_LOG_CLEAR, nil, function() Log:Clear() end)
	Write:Attach(layout:Button(L.OPT_LOG_WRITE, nil, function() Write:Now() end, L.OPT_LOG_WRITE_TIP))
	-- A command to a line, then the file on a line of its own: seven lines of the small font.
	layout:Note(L.OPT_LOG_COMMANDS, nil, 98)
	AgentHelp()
end

function Developer:SetupOptions()
	if panel then return end
	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then
		return
	end
	local Spoken = self:Spoken()

	panel = CreateFrame("Frame", "SpokenDeveloperOptionsPanel")
	panel.name = L.TITLE
	scroller = SpokenLayout.Scroll(panel)
	local content = scroller.child
	layout = SpokenLayout.New(content, INDENT, -TOP)
	panel.layout = layout
	layout:Intro(nil, L.OPT_DEVELOPER, L.OPT_DEVELOPER_INTRO)
	layout:Defaults(Reset, nil, Spoken:Words().OPT_RESET_ALL_TIP)

	LogRows()
	-- Each group's rows under its one title, in the modules' order; then the sections of their own.
	local GROUPS = { { key = "chat", title = L.OPT_CHAT_SECTION }, { key = "testing", title = L.OPT_TESTING_SECTION } }
	local builds = Spoken:GetDeveloperSettings()
	for _, group in ipairs(GROUPS) do
		local mine = {}
		for _, build in ipairs(builds) do
			local key, order = Spoken:GetDeveloperGroup(build)
			if key == group.key then table.insert(mine, { build = build, order = order or 100 }) end
		end
		table.sort(mine, function(a, b) return a.order < b.order end)
		if mine[1] then layout:Section(group.title) end
		for _, entry in ipairs(mine) do Run(entry.build) end
	end
	for _, build in ipairs(builds) do
		if not Spoken:GetDeveloperGroup(build) then Run(build) end
	end
	-- One handed in after the page is built goes at its end, under its group's title.
	Spoken:RegisterCallback("DEVELOPER_SETTINGS_ADDED", function(build)
		local key = Spoken:GetDeveloperGroup(build)
		for _, group in ipairs(GROUPS) do
			if group.key == key then layout:Section(group.title) end
		end
		Run(build)
		layout:Refresh()
		Fit()
	end)

	content:SetScript("OnShow", function() layout:Refresh() end)
	layout:Refresh()
	Fit()

	self.optionsPage = Spoken:AddSettingsPage(panel, L.OPT_DEVELOPER, ORDER, layout, scroller)
	self.optionsPanel = panel
end

--- Redraw: the log turned on or off from elsewhere (the menu, the welcome window, a command).
function Developer:RefreshOptions()
	if layout then layout:Refresh() end
end

function Developer:OpenOptions()
	if not (self.optionsPage and self.optionsPage.Open()) then
		self:Print("open Game Menu -> Options -> AddOns -> Spoken -> Developer")
	end
end
