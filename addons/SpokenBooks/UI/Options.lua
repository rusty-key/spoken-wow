-- SpokenBooks -- options panel in the interface settings.
--
-- Registered with Settings.RegisterCanvasLayoutCategory, and laid out by the UI/Layout.lua
-- every Spoken addon carries a copy of, so this panel and the other three read alike.
-- UI/Options.lua on the zones side is the same file one size larger; the reasoning for both
-- choices is written down there.
--
-- Every switch here also has a slash command, and always will: the settings panel is the
-- Settings API's, and a client that does not offer one must still leave the addon
-- configurable. /spb is what the Print below points at when that happens.

local ADDON_NAME, SpokenBooks = ...

local L = SpokenBooks.L

local INDENT = 20

local panel, category

--------------------------------------------------------------------------------
-- Panel
--------------------------------------------------------------------------------

function SpokenBooks:SetupOptions()
	if panel then
		return
	end

	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then
		self:Print("|cffffcc00Settings API missing; options panel unavailable (use /spb)|r")
		return
	end

	if not SpokenLayout then
		-- Carried, not shared, so this can only be a broken install -- and saying so beats a
		-- panel that half-draws.
		self:Print("|cffffcc00UI/Layout.lua did not load; options panel unavailable|r")
		return
	end

	-- Parentless, with `.name` set, is the shape the Settings API expects here.
	panel = CreateFrame("Frame")
	panel.name = "Spoken Books"

	-- Laid out in the scroller's content frame rather than on the panel itself: the settings
	-- canvas is a fixed size and neither scrolls nor clips, so rows that overflow it draw
	-- over the game world. Three rows fit today; the next one added should not have to
	-- discover this.
	local scroller = SpokenLayout.Scroll(panel)
	local content = scroller.child
	panel.content = content

	local heading = content:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
	heading:SetPoint("TOPLEFT", INDENT, -16)
	heading:SetJustifyH("LEFT")
	heading:SetText("Spoken Books")

	local layout = SpokenLayout.New(content, INDENT, -42)
	layout:Note(L.OPT_NOTE)

	local function Get(key)
		return function() return SpokenBooksDB and SpokenBooksDB[key] end
	end
	local function Set(key)
		return function(value) if SpokenBooksDB then SpokenBooksDB[key] = value end end
	end

	layout:Section(L.OPT_SECTION_READING)
	layout:Checkbox(L.OPT_AUTOPLAY,
		L.OPT_AUTOPLAY_TIP,
		Get("autoplay"), Set("autoplay"))
	layout:Checkbox(L.OPT_WHOLE_BOOK,
		L.OPT_WHOLE_BOOK_TIP,
		Get("readWholeBook"), Set("readWholeBook"))
	layout:Checkbox(L.OPT_READ_ONCE,
		L.OPT_READ_ONCE_TIP,
		Get("readOnce"), Set("readOnce"))

	layout:Section(L.OPT_SECTION_LANGUAGE)
	local voices = { SpokenBooks.AUTO_LANGUAGE }
	local fallbacks = { "none" }
	for _, locale in ipairs(SpokenBooks.LOCALES) do
		table.insert(voices, locale.code)
		table.insert(fallbacks, locale.code)
	end
	layout:Dropdown(L.OPT_VOICE_LANGUAGE, L.OPT_VOICE_LANGUAGE_TIP,
		voices, Get("voiceLanguage"), Set("voiceLanguage"), nil, function(code)
			if code == SpokenBooks.AUTO_LANGUAGE then
				return L.OPT_LANG_AUTO_FMT:format(
					SpokenBooks:GetLanguageName(SpokenBooks:GetClientLanguage()))
			end
			return SpokenBooks:GetLanguageName(code)
		end)
	layout:Dropdown(L.OPT_FALLBACK_LANGUAGE, L.OPT_FALLBACK_LANGUAGE_TIP,
		fallbacks, Get("fallbackLanguage"), Set("fallbackLanguage"), nil, function(code)
			return code == "none" and L.OPT_FALLBACK_NONE or SpokenBooks:GetLanguageName(code)
		end)

	layout:Section(L.OPT_SECTION_READ)
	layout:Button(L.OPT_FORGET, 200, function()
		local count = SpokenBooks:ForgetRead()
		SpokenBooks:Print(L.OPT_FORGET_DONE_FMT:format(count, count == 1 and "" or "s"))
	end, L.OPT_FORGET_TIP)

	-- Derived rather than written as a number: a hardcoded height is a number nobody updates
	-- when a row is added, and what that produces is a section you cannot scroll to.
	scroller:SetContentHeight(layout:Height() + 40)

	category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken Books")
	Settings.RegisterAddOnCategory(category)

	SpokenBooks.optionsPanel = panel
	SpokenBooks.optionsCategory = category
end

--- Open the panel, or say why there is none. Reached by `/spb settings`, the player's
--- minimap menu and the settings link on the player's own panel.
function SpokenBooks:OpenOptions()
	if not category or not (Settings and Settings.OpenToCategory) then
		self:Print("open Game Menu -> Options -> AddOns -> Spoken Books")
		return
	end

	-- OpenToCategory takes an ID in some builds and the category object in others, so try
	-- the ID first and fall back rather than erroring. Same as the zones panel.
	local id = category.GetID and category:GetID() or nil
	local ok = id and pcall(Settings.OpenToCategory, id)
	if not ok then
		ok = pcall(Settings.OpenToCategory, category)
	end
	if not ok then
		self:Print("open Game Menu -> Options -> AddOns -> Spoken Books")
	end
end
