setfenv(1, SpokenEnv)

-- Find a setting on any Spoken page. The game's own settings search does not look inside an
-- addon's canvas, so Home carries this box. Every row a page's SpokenLayout builds indexes
-- itself (Layout:Index): its label, its tooltip, its section and its page. Picking a result
-- opens that page, scrolls to the row and lights it up (Options:ShowRow).
Search = {}

local MAX_RESULTS = 8
local ROW_HEIGHT = 20
local WIDTH = 460

-- Lower case, colour codes gone, split on anything that is not a letter or a digit. Bytes
-- from 128 up are kept whole, so a translated label still matches word for word.
local function Words(text)
    text = string.lower(text or "")
    text = text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
    local words = {}
    for word in text:gmatch("[%w\128-\255]+") do words[#words + 1] = word end
    return words
end
local function Plain(text) return " " .. table.concat(Words(text), " ") end

-- How well one search term fits an entry: best in its label, at the start of a word, then
-- anywhere in the label, its section, its tooltip, the page's name. Nil when it is nowhere.
local function Fit(term, label, section, tooltip, page)
    if label:find(" " .. term, 1, true) then return 4 end
    if label:find(term, 1, true) then return 3 end
    if section:find(term, 1, true) then return 2 end
    if tooltip:find(term, 1, true) or page:find(term, 1, true) then return 1 end
    return nil
end

--- Every entry on every page that holds all of the query's words, best first.
function Search:Find(query)
    local terms, found = Words(query), {}
    if #terms == 0 then return found end
    for _, page in ipairs(Options:Pages()) do
        local pageName = Plain(page.name)
        -- Laid out afresh first, so whether each row is shown is what the settings say now: a
        -- row hidden by ShowWhen -- the window's size with subtitles chosen -- has no place on
        -- its page to scroll to, and is not offered.
        page.layout:Refresh()
        for _, entry in ipairs(page.layout.entries or {}) do
            local row = entry.frame and entry.frame.layoutRow
            if not (row and row.shown == false) then
                local label, section, tooltip = Plain(entry.label), Plain(entry.section), Plain(entry.tooltip)
                local score = 0
                for _, term in ipairs(terms) do
                    local fit = Fit(term, label, section, tooltip, pageName)
                    if not fit then score = nil; break end
                    score = score + fit
                end
                if score then table.insert(found, { page = page, entry = entry, score = score }) end
            end
        end
    end
    table.sort(found, function(a, b)
        if a.score ~= b.score then return a.score > b.score end
        return tostring(a.entry.label) < tostring(b.entry.label)
    end)
    return found
end

function Search:Go(result)
    self.results:Hide()
    self.box:ClearFocus()
    Options:ShowRow(result.page, result.entry.frame)
end

function Search:ResultRow(index)
    local row = self.rows[index]
    if row then return row end
    row = CreateFrame("Button", nil, self.results)
    row:SetHeight(ROW_HEIGHT)
    row:SetPoint("TOPLEFT", 8, -6 - (index - 1) * ROW_HEIGHT)
    row:SetPoint("TOPRIGHT", -8, -6 - (index - 1) * ROW_HEIGHT)
    row:SetHighlightTexture([[Interface\QuestFrame\UI-QuestTitleHighlight]], "ADD")
    row.text = row:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    row.text:SetPoint("LEFT", 4, 0)
    row.text:SetPoint("RIGHT", -4, 0)
    row.text:SetJustifyH("LEFT")
    row.text:SetWordWrap(false)
    row:SetScript("OnClick", function(button) if button.result then Search:Go(button.result) end end)
    self.rows[index] = row
    return row
end

function Search:ShowResults(query)
    local found = self:Find(query)
    self.found = found
    if Words(query)[1] == nil then
        self.results:Hide()
        return
    end
    local shown = math.min(MAX_RESULTS, #found)
    for index = 1, math.max(shown, 1) do
        local row = self:ResultRow(index)
        local result = found[index]
        row.result = result
        if result then
            local where = result.entry.section and format(L.SEARCH_WHERE, result.page.name, result.entry.section)
                or result.page.name
            row.text:SetText(format("%s  |cff9d9d9d%s|r", result.entry.label, where))
        else
            row.text:SetText("|cff9d9d9d" .. L.SEARCH_NONE .. "|r")
        end
        row:Show()
    end
    for index = math.max(shown, 1) + 1, #self.rows do self.rows[index]:Hide() end
    self.results:SetHeight(12 + math.max(shown, 1) * ROW_HEIGHT)
    self.results:Show()
end

--- Size the row, the box and the list under it to `width`: the page's, from Layout:Custom.
function Search:Fit(width)
    if not self.row then return end
    self.row:SetWidth(width)
    self.box:SetWidth(math.min(300, width - 12))
    self.results:SetWidth(width)
end

--- The box and its results list, as one row for the Home page's layout.
function Search:Build(parent)
    self.height = 26
    local row = CreateFrame("Frame", nil, parent)
    row:SetSize(WIDTH, self.height)
    -- The game's own search box where it has one -- the magnifier, the grey prompt and the
    -- clear button of the settings window's search -- the plain input box elsewhere.
    local modern = SearchBoxTemplate_OnTextChanged ~= nil
    local box = CreateFrame("EditBox", "SpokenSettingsSearchBox", row, modern and "SearchBoxTemplate" or "InputBoxTemplate")
    box:SetSize(300, 20)
    box:SetPoint("LEFT", 6, 0)
    box:SetAutoFocus(false)
    local hint
    if modern and box.Instructions then
        box.Instructions:SetText(L.SEARCH_HINT)
    else
        hint = box:CreateFontString(nil, "ARTWORK", "GameFontDisable")
        hint:SetPoint("LEFT", 2, 0)
        hint:SetText(L.SEARCH_HINT)
    end
    -- Over the rows below it, as a dropdown's list would be, and drawn as the settings'
    -- dropdown lists are.
    local results = CreateFrame("Frame", nil, row, BackdropTemplateMixin and "BackdropTemplate" or nil)
    results:SetPoint("TOPLEFT", box, "BOTTOMLEFT", -6, -6)
    results:SetWidth(WIDTH)
    results:SetFrameLevel(row:GetFrameLevel() + 50)
    if results.SetBackdrop then
        results:SetBackdrop({ bgFile = [[Interface\Tooltips\UI-Tooltip-Background]],
            edgeFile = [[Interface\Tooltips\UI-Tooltip-Border]], tile = true, tileSize = 16, edgeSize = 12,
            insets = { left = 3, right = 3, top = 3, bottom = 3 } })
        results:SetBackdropColor(0.05, 0.05, 0.05, 0.95)
    end
    results:Hide()

    self.box, self.results, self.rows, self.row = box, results, {}, row
    box:SetScript("OnTextChanged", function(edit)
        local text = edit:GetText() or ""
        -- The template's own handler shows its prompt and clear button; ours is the plain box's.
        if modern then
            SearchBoxTemplate_OnTextChanged(edit)
        elseif text == "" then
            hint:Show()
        else
            hint:Hide()
        end
        Search:ShowResults(text)
    end)
    box:SetScript("OnEnterPressed", function()
        if Search.found and Search.found[1] then Search:Go(Search.found[1]) end
    end)
    box:SetScript("OnEscapePressed", function(edit)
        edit:SetText("")
        edit:ClearFocus()
    end)
    return row
end
