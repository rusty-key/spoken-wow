-- SpokenZones -- options panel in the interface settings.
--
-- Registered with Settings.RegisterCanvasLayoutCategory, which exists on 11509
-- (Leatrix_Maps, Leatrix_Plus, Leatrix_Sounds, Syndicator and Baganator all use
-- it). InterfaceOptions_AddCategory is the legacy-only path and is not used.
--
-- Widget templates are picked from what addons already running on this client
-- use: UICheckButtonTemplate (Syndicator/Options) and UISliderTemplate
-- (Syndicator/Options, Leatrix_Maps, Leatrix_Plus).

local ADDON_NAME, SpokenZones = ...

local L = SpokenZones.L

local INDENT = 20

local panel, category

--------------------------------------------------------------------------------
-- Widgets
--------------------------------------------------------------------------------

local function MakeHeading(parent, text, x, y, template)
	local fs = parent:CreateFontString(nil, "ARTWORK", template or "GameFontNormalLarge")
	fs:SetPoint("TOPLEFT", x, y)
	fs:SetJustifyH("LEFT")
	fs:SetText(text)
	return fs
end

--------------------------------------------------------------------------------
-- Apply helpers
--------------------------------------------------------------------------------

local function RedrawPanel()
	if SpokenZones.ApplyPanelOptions then
		SpokenZones:ApplyPanelOptions()
	end
end

local function RedrawEverything()
	RedrawPanel()
	if SpokenZones.RefreshLoreWindow then
		SpokenZones:RefreshLoreWindow()
	end
end

--------------------------------------------------------------------------------
-- Panel
--------------------------------------------------------------------------------

function SpokenZones:SetupOptions()
	if panel then
		return
	end

	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then
		SpokenZones:Print("|cffffcc00Settings API missing; options panel unavailable (use /spz help)|r")
		return
	end

	-- Parentless, with `.name` set, is the shape the Settings API expects here.
	panel = CreateFrame("Frame")
	panel.name = "Spoken Zones"

	-- Everything below is laid out in `content`, not in `panel`. The settings canvas
	-- is a fixed size and neither scrolls nor clips what overflows it, so a panel
	-- with more rows than fit draws them over the game world. See UI/Scroller.lua.
	local scroller = SpokenLayout.Scroll(panel)
	local content = scroller.child
	panel.content = content

	MakeHeading(content, "Spoken Zones", INDENT, -16)
	local layout = SpokenLayout.New(content, INDENT, -42)
	layout:Note(L.OPT_NOTE)

	-- Every row's position, and the spacing between them, comes from UI/Layout.lua -- the
	-- file every Spoken addon carries a copy of, so the three panels read alike.
	local function Get(key) return function() return SpokenZones:Get(key) end end
	local function Set(key) return function(value) SpokenZones:Set(key, value) end end

	layout:Section(L.OPT_SECTION_MAP)
	layout:Checkbox(L.OPT_MAP_PANEL,
		L.OPT_MAP_PANEL_TIP,
		Get("showMapPanel"), Set("showMapPanel"), RedrawPanel)
	layout:Checkbox(L.OPT_HOVER,
		L.OPT_HOVER_TIP,
		Get("showHoverPreview"), Set("showHoverPreview"))
	-- Stored as a string ("LEFT"/"RIGHT") rather than a boolean, so it reads and writes
	-- its own way rather than through Get/Set above.
	layout:Checkbox(L.OPT_PANEL_LEFT, nil,
		function() return SpokenZones:Get("panelSide") == "LEFT" end,
		function(value) SpokenZones:Set("panelSide", value and "LEFT" or "RIGHT") end,
		RedrawPanel)
	layout:Slider(L.OPT_PANEL_WIDTH, 220, 520, 10,
		Get("panelWidth"), Set("panelWidth"), RedrawPanel, SpokenLayout.Number)
	layout:Slider(L.OPT_FONT_SIZE, 9, 20, 1,
		Get("fontSize"), Set("fontSize"), RedrawEverything, SpokenLayout.Number)

	layout:Section(L.OPT_SECTION_MINIMAP)
	layout:Checkbox(L.OPT_MINIMAP_BUTTON,
		L.OPT_MINIMAP_BUTTON_TIP,
		Get("showMinimapButton"), Set("showMinimapButton"), function()
			-- The checkbox has already written the option, so sync rather than
			-- toggle; ApplyMinimapButton also keeps `hide` in step for LibDBIcon.
			if SpokenZones.ApplyMinimapButton then
				SpokenZones:ApplyMinimapButton()
			end
		end)

	layout:Section(L.OPT_SECTION_NARRATION)
	layout:Checkbox(L.OPT_PLAY_BUTTON,
		L.OPT_PLAY_BUTTON_TIP,
		Get("voiceEnabled"), Set("voiceEnabled"), function()
			SpokenZones:StopLore()
			SpokenZones:NotifyAudioChanged()
		end)
	layout:Checkbox(L.OPT_AUTOPLAY,
		L.OPT_AUTOPLAY_TIP,
		Get("autoplay"), Set("autoplay"), function()
			if not SpokenZones:Get("autoplay") then
				SpokenZones:StopLore()
			end
		end)
	layout:Indent()
	layout:Checkbox(L.OPT_AUTOPLAY_SUB,
		L.OPT_AUTOPLAY_SUB_TIP,
		Get("autoplaySubzones"), Set("autoplaySubzones"))
	layout:Checkbox(L.OPT_AUTOPLAY_EXPLORED,
		L.OPT_AUTOPLAY_EXPLORED_TIP,
		Get("autoplayExplored"), Set("autoplayExplored"))
	layout:Outdent()
	-- The list is read when the menu opens rather than captured here: packs cannot be
	-- installed mid-session, but a player who disables one in the AddOns list and reloads
	-- should not find this offering it.
	local packNote
	local function PackLabel(pack)
		return pack and SpokenZones:GetAudioPackLabel(pack) or L.OPT_PACK_NONE_INSTALLED
	end
	local function DescribePacks()
		local packs = SpokenZones:GetAudioPacks()
		local active = SpokenZones:GetActiveAudioPack()
		if #packs == 0 then
			packNote:SetText(L.OPT_PACK_NONE)
		elseif #packs > 1 then
			packNote:SetText(string.format(L.OPT_PACK_MULTI_FMT, active.addon, #packs))
		else
			packNote:SetText(active.addon)
		end
	end
	layout:Dropdown(L.OPT_SOUND_PACK, L.OPT_SOUND_PACK_TIP,
		function() return SpokenZones:GetAudioPacks() end,
		function() return SpokenZones:GetActiveAudioPack() end,
		function(pack) SpokenZones:SetActiveAudioPack(pack.addon) end,
		function() DescribePacks() end,
		PackLabel)
	packNote = layout:Note("", 460, 32)
	DescribePacks()

	layout:Section(L.OPT_SECTION_LANGUAGE)
	-- Only finished languages are offered. A player choosing from a list has no way to
	-- know that half a translation is missing, and would report the English that shows
	-- through as a bug; /spz lang <code> force is how an unfinished one gets looked at.
	local langNote
	-- Auto stores no language at all, so it keeps following the client: switch the
	-- game to French and it reads French. Every other entry pins its language.
	local AUTO = {}
	local function DescribeLanguage()
		local available = SpokenZones:GetSelectableLanguages()
		-- The chosen language, which is not always the one on screen: a switch only takes
		-- effect on the next load.
		local chosen = SpokenZones:GetLanguagePreference() or SpokenZones:GetAutoLanguage()
		if #available < 2 then
			langNote:SetText(L.OPT_LANG_ONLY_ENGLISH)
		elseif chosen ~= SpokenZones:GetLanguage() then
			langNote:SetText(L.OPT_LANG_RELOAD)
		else
			langNote:SetText(string.format(L.OPT_LANG_COUNT_FMT, #available))
		end
	end
	layout:Dropdown(L.OPT_LANGUAGE, L.OPT_LANGUAGE_TIP,
		function()
			local values = { AUTO }
			for _, locale in ipairs(SpokenZones:GetSelectableLanguages()) do
				table.insert(values, locale)
			end
			return values
		end,
		function()
			local chosen = SpokenZones:GetLanguagePreference()
			for _, locale in ipairs(SpokenZones:GetSelectableLanguages()) do
				if locale.code == chosen then
					return locale
				end
			end
			return AUTO
		end,
		function(locale)
			local code = locale ~= AUTO and locale.code or nil
			if SpokenZones:SetLanguage(code) then
				-- Said before the reload rather than after: the failure to avoid is a
				-- player switching, seeing English, and concluding it did not work.
				SpokenZones:Print(string.format(L.OPT_LANG_SET_FMT,
					SpokenZones:GetLanguageName(code or SpokenZones:GetAutoLanguage())))
			end
		end,
		function() DescribeLanguage() end,
		function(locale)
			-- Named with what it reads now, since that changes with the client.
			if locale == AUTO then
				return string.format(L.OPT_LANG_AUTO_FMT, SpokenZones:GetLanguageName(SpokenZones:GetAutoLanguage()))
			end
			return locale and SpokenZones:GetLanguageName(locale.code) or SpokenZones:GetLanguageName(nil)
		end)
	langNote = layout:Note("", 460, 32)
	DescribeLanguage()

	layout:Section(L.OPT_SECTION_TROUBLE)
	layout:Checkbox(L.OPT_DEBUG_MAP_CLICK,
		L.OPT_DEBUG_MAP_CLICK_TIP,
		Get("debug"), Set("debug"))

	-- Its own section rather than part of Troubleshooting, and not only because the
	-- checkbox above already uses the word "report": the per-line Report buttons
	-- cover a bad line, and this covers everything that belongs to no line at all --
	-- the addon erroring, the voice being wrong throughout, the site itself.
	layout:Section(L.OPT_SECTION_FEEDBACK)
	layout:Button(L.OPT_REPORT_PROBLEM, 220, function()
		SpokenZones:ShowCopyLink(SpokenZones.SITE_URL,
			L.OPT_REPORT_ADDRESS)
	end)
	layout:Note(L.OPT_REPORT_NOTE, 460, 40)

	-- Derived rather than written as a number: a hardcoded height is a number nobody
	-- updates when a row is added, and the failure it produces is the one this scroller
	-- exists to fix -- a section you cannot reach.
	scroller:SetContentHeight(layout:Height() + 40)

	category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken Zones")
	Settings.RegisterAddOnCategory(category)

	SpokenZones.optionsPanel = panel
	SpokenZones.optionsCategory = category
end

function SpokenZones:OpenOptions()
	if not category or not (Settings and Settings.OpenToCategory) then
		SpokenZones:Print("open Game Menu -> Options -> AddOns -> Spoken Zones")
		return
	end

	-- OpenToCategory takes an ID in some builds and the category object in others,
	-- so try the ID first and fall back rather than erroring.
	local id = category.GetID and category:GetID() or nil
	local ok = id and pcall(Settings.OpenToCategory, id)
	if not ok then
		ok = pcall(Settings.OpenToCategory, category)
	end
	if not ok then
		SpokenZones:Print("open Game Menu -> Options -> AddOns -> Spoken Zones")
	end
end
