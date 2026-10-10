-- The player is an optional dependency, so this addon loads without it. Everything else it does
-- runs in the dialogue core that Spoken carries (Environment.lua), so without the player this
-- file is all that runs: it says what is missing, and nothing is read aloud.
--
-- One case deserves more than a line in chat -- the player installed and disabled -- because it
-- is one click to fix and an addon manager that fetched the dependency cannot see that the player
-- then turned it off.
--
-- Plain globals, no environment: this has to work when the addon that would provide one is the
-- one missing. Every addon that needs the player carries a copy of this. They coordinate through
-- two globals: one collects the names to say, the other makes sure only one dialog is raised
-- however many addons are waiting on it. Lua 5.0 safe, as this file loads on 1.12.
local TITLE = "Spoken Gossip"
local PLAYER_FOLDER = "Spoken"
local PLAYER_DIALOG = "SPOKEN_PLAYER_REQUIRED"

-- The Forever client's gamepad UI takes over every popup as it opens, inside the code that
-- opened it. Opened by an addon, that taints the gamepad's bindings: the next close is blocked,
-- and the "blocked from an action" dialog it raises hangs the client (#165). What this addon
-- would pop up unasked goes to chat there instead. pcall, because 1.12 raises on a CVar it has
-- never heard of.
local function IsGamepadUI()
    local ok, style = pcall(GetCVar, "InputDeviceInterfaceStyle")
    return ok and style == "1"
end

local function Say(text)
    DEFAULT_CHAT_FRAME:AddMessage("|cff66bbff" .. TITLE .. ":|r " .. text)
end

--- Say that this addon needs the player. Called whether or not the player is there, since
--- the addon that raises the dialog may not be the one that noticed first.
local function RequirePlayer(title)
    local names = rawget(_G, "SpokenPlayerRequiredBy")
    if not names then
        names = {}
        _G.SpokenPlayerRequiredBy = names
    end
    for _, name in ipairs(names) do
        if name == title then
            return
        end
    end
    table.insert(names, title)
end

--- "A", "A and B", "A, B and C".
local function ListNames(names)
    local count = 0
    for _ in ipairs(names) do
        count = count + 1
    end
    local text = ""
    for index, name in ipairs(names) do
        if index == 1 then
            text = name
        elseif index == count then
            text = text .. " and " .. name
        else
            text = text .. ", " .. name
        end
    end
    return text
end

--- Raise the dialog, if the player is installed and disabled and nobody has raised it yet.
--- Returns whether this call was the one that raised it.
local function PromptForPlayer()
    if rawget(_G, "Spoken") or rawget(_G, "SpokenPlayerPrompted") then
        return false
    end
    local names = rawget(_G, "SpokenPlayerRequiredBy")
    if not names or not names[1] then
        return false
    end
    local getInfo = (C_AddOns and C_AddOns.GetAddOnInfo) or GetAddOnInfo
    local enableAddOn = (C_AddOns and C_AddOns.EnableAddOn) or EnableAddOn
    if not (getInfo and enableAddOn and StaticPopupDialogs and StaticPopup_Show) then
        return false
    end
    -- Absent rather than disabled: there is nothing to enable, so there is nothing to click.
    local present, _, _, _, reason = getInfo(PLAYER_FOLDER)
    if not present or reason ~= "DISABLED" then
        return false
    end

    _G.SpokenPlayerPrompted = true
    if IsGamepadUI() then
        Say(format("|cffffd200Spoken|r is required to use %s. Enable it in the AddOns list and reload.", ListNames(names)))
        return true
    end
    StaticPopupDialogs[PLAYER_DIALOG] =
    {
        text = format("|cffffd200Spoken|r is required to use %s.", ListNames(names)),
        button1 = ENABLE or "Enable",
        button2 = CANCEL or "Cancel",
        timeout = 0,
        whileDead = 1,
        -- An addon is only loaded at login, so enabling it takes effect on the next one.
        OnAccept = function()
            enableAddOn(PLAYER_FOLDER)
            ReloadUI()
        end,
    }
    StaticPopup_Show(PLAYER_DIALOG)
    return true
end

--- A Spoken from before the dialogue core: loaded, so there is nothing to enable, but this
--- addon has nothing to run on. Returns whether it said so.
local function WarnOldPlayer()
    local core = rawget(_G, "VoiceOver")
    if not rawget(_G, "Spoken") or (core and rawget(core, "SpokenDialogue")) then
        return false
    end
    Say("needs a newer |cffffd200Spoken|r. Update Spoken and reload.")
    return true
end

RequirePlayer(TITLE)

-- Always deferred, never raised here: on a fresh login the other addon that wants the player
-- may not have loaded yet, and the dialog would name only this one.
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:SetScript("OnEvent", function()
    frame:UnregisterEvent("PLAYER_ENTERING_WORLD")
    if not WarnOldPlayer() then
        PromptForPlayer()
    end
end)

-- For the tests, which load this with dofile; the client ignores what a file returns.
return { PromptForPlayer = PromptForPlayer, WarnOldPlayer = WarnOldPlayer }
