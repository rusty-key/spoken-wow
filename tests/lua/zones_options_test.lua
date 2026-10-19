-- The zones module's settings page, nested under Spoken's and laid out by Spoken's
-- UI/Layout.lua, so the pages read alike. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local ZONES = here .. "/../../addons/Spoken_Places/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}
local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
local Z = H.NewZoneLore()
for _, file in ipairs({ "UI/Options" }) do
    assert(loadfile(ZONES .. file .. ".lua"))("Spoken_Places", Z)
end
Z:SetupOptions()

local registered
for _, category in ipairs(stub.settingsCategories) do
    if category.name == "Places" then registered = category end
end
Expect("the page is registered as a settings category", registered ~= nil, true)
Expect("...nested under Spoken's", registered and registered.parent and registered.parent.name, "Spoken")

-- The rows live in the scroller's content frame, not on the panel: the settings canvas
-- neither scrolls nor clips, so a panel with more rows than fit draws over the world.
local content = Z.optionsPanel.content
local rows, headings = {}, {}
-- Only what is laid out: a section with nothing to show is never placed.
local hidden = {}
for _, child in ipairs(content.children) do
    if child.layoutHeading and child.layoutY == nil then
        table.insert(hidden, child.text)
    elseif child.layoutHeading then
        table.insert(headings, { y = child.layoutY, height = child.layoutHeight, text = child.text })
    elseif child.layoutHeight and child.layoutY then
        table.insert(rows, { y = child.layoutY, height = child.layoutHeight, anchor = child.anchor and child.anchor.y })
    end
end

Expect("every section is there", table.getn(headings), 4)
-- No minimap section: the player's one button is the one a player sees.
local names = {}
for _, heading in ipairs(headings) do table.insert(names, heading.text) end
Expect("...in order", table.concat(names, "|"), "When to Read|Stories|Voice Packs|Reading History")
do
    local language
    for _, entry in ipairs(Z.optionsPanel.layout.entries) do
        if entry.label == Z.L.OPT_LANGUAGE then language = entry.frame end
    end
    Expect("Text Language waits while English is the only one: a menu of one chooses nothing",
        language ~= nil and language.layoutRow.shown, false)
end
Expect("and every setting", table.getn(rows) >= 9, true)

local function Distinct(values)
    local seen, count = {}, 0
    for _, value in ipairs(values) do
        local key = string.format("%.1f", value)
        if not seen[key] then seen[key] = true; count = count + 1 end
    end
    return count
end

-- The same two invariants the player's panel holds to. An indented row is a row, so its
-- own spacing is measured the same way; only its left edge moves.
local gaps = {}
for index = 2, table.getn(rows) do
    local previous = rows[index - 1]
    -- Two settings side by side share one line: there is no gap between them to measure.
    local crossesHeading = previous.y == rows[index].y
    for _, heading in ipairs(headings) do
        if heading.y < previous.y and heading.y > rows[index].y then crossesHeading = true end
    end
    if not crossesHeading then
        table.insert(gaps, previous.y - rows[index].y - previous.height)
    end
end
Expect("every row sits the same distance below the one above it", Distinct(gaps), 1)

local headingGaps = {}
for _, heading in ipairs(headings) do
    local above
    for _, row in ipairs(rows) do
        if row.y > heading.y and (not above or row.y < above.y) then above = row end
    end
    if above then table.insert(headingGaps, above.y - heading.y - above.height) end
end
Expect("every section heading the same distance below the section above", Distinct(headingGaps), 1)

local escaped = 0
for _, row in ipairs(rows) do
    if row.anchor and (row.anchor > row.y or row.anchor < row.y - row.height) then escaped = escaped + 1 end
end
Expect("no control escapes the row it was given", escaped, 0)

-- Derived from the layout rather than written down, so adding a row cannot leave a
-- section below the reach of the scrollbar.
Expect("the scroller is told how tall the content grew", content.height > 500, true)

-- Read Stories Aloud is the voice itself: off, the stories are text only, and what decides
-- when they are read greys out with it.
do
    local layout = Z.optionsPanel.layout
    local function Row(label)
        for _, entry in ipairs(layout.entries) do if entry.label == label then return entry.frame end end
    end
    local discovery = Row(Z.L.OPT_AUTOPLAY)
    local flights = Row(Z.L.OPT_FLIGHT_LORE)
    Expect("the voice switch says what it does", Z.L.OPT_PLAY_BUTTON, "Read Stories Aloud")
    Z:Set("voiceEnabled", false); layout:Refresh()
    Expect("...and off, Read Automatically greys out, saying why", discovery and discovery.layoutReason, Z.L.REASON_VOICE)
    Expect("...and Read Flight Destination with it", flights and flights.layoutReason, Z.L.REASON_VOICE)
    Z:Set("voiceEnabled", true); layout:Refresh()
    Expect("...and comes back with it", discovery and discovery.layoutReason, nil)
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones options tests passed")
