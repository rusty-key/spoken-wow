if not SpokenGossipEnv then return end
setfenv(1, SpokenGossipEnv)

-- The AceConfig table behind every /spg command, and the options window on the clients without
-- a settings panel (1.12, 2.4.3, 3.3.5). On the others the settings are UI/SettingsPanel.lua's
-- page, and the window is still where profiles are.
Options = {}

local AceGUI = LibStub("AceGUI-3.0")
local AceConfigDialog = LibStub("AceConfigDialog-3.0")
local AceDBOptions = LibStub("AceDBOptions-3.0")

-- Ordered, because old AceGUI versions cannot sort a dropdown's items.
local FREQUENCIES = {
    [Enums.GossipFrequency.Always] = L.OPT_GREETING_LABEL_ALWAYS,
    [Enums.GossipFrequency.OncePerQuestNPC] = L.OPT_GREETING_LABEL_ONCE_QUEST,
    [Enums.GossipFrequency.OncePerNPC] = L.OPT_GREETING_LABEL_ONCE_NPC,
    [Enums.GossipFrequency.Never] = L.OPT_GREETING_LABEL_NEVER,
}

---@type AceConfigOptionsTable
local GeneralTab =
{
    name = L.OPT_GROUP_GENERAL,
    type = "group",
    order = 10,
    args = {
        Greetings = {
            type = "group",
            order = 1,
            inline = true,
            name = L.OPT_SECTION_DIALOGUE,
            args = {
                GossipFrequency = {
                    type = "select",
                    width = 1.1,
                    order = 1,
                    name = L.OPT_PANEL_GREETINGS,
                    desc = L.OPT_PANEL_GREETINGS_TIP,
                    values = FREQUENCIES,
                    get = function(info) return Addon.db.profile.Audio.GossipFrequency end,
                    set = function(info, value)
                        Addon.db.profile.Audio.GossipFrequency = value
                        Addon:RefreshConfig()
                    end,
                },
                LineBreak1 = { type = "description", name = "", order = 2 },
                StopOnClose = {
                    type = "toggle",
                    order = 3,
                    width = 2,
                    name = L.OPT_PANEL_STOP_ON_CLOSE,
                    desc = L.OPT_PANEL_STOP_ON_CLOSE_TIP,
                    get = function(info) return Addon.db.profile.Audio.StopAudioOnDisengage end,
                    set = function(info, value) Addon.db.profile.Audio.StopAudioOnDisengage = value end,
                },
                OGThrall = {
                    type = "toggle",
                    order = 4,
                    width = 2,
                    name = L.OPT_OG_THRALL,
                    desc = L.OPT_OG_THRALL_TIP,
                    get = function(info) return Addon.db.profile.Audio.OGThrall end,
                    set = function(info, value) Addon.db.profile.Audio.OGThrall = value end,
                },
                Forget = {
                    type = "execute",
                    order = 5,
                    name = L.OPT_FORGET_GREETINGS,
                    desc = L.OPT_FORGET_GREETINGS_TIP,
                    func = function() Addon:ForgetGreetings() end,
                },
            },
        },
    },
}

---@type AceConfigOptionsTable
local SlashCommands = {
    type = "group",
    name = L.OPT_CMD_GROUP,
    order = 110,
    inline = true,
    dialogHidden = true,
    args = {
        Read = {
            type = "execute",
            order = 1,
            name = L.OPT_CMD_READ,
            desc = L.OPT_CMD_READ_DESC,
            dropdownHidden = true,
            func = function(info)
                if not Addon:ReadVisible("/spg read") then
                    print("|cFFFF4040Spoken Gossip: no greeting or gossip window is open.|r")
                end
            end
        },
        Test = {
            type = "execute",
            order = 80,
            name = L.OPT_CMD_TEST,
            desc = L.OPT_CMD_TEST_DESC,
            dropdownHidden = true,
            func = function() Addon:RunSelfTest() end
        },
        Diagnostics = {
            type = "execute",
            order = 90,
            name = L.OPT_CMD_DIAG,
            desc = L.OPT_CMD_DIAG_DESC,
            dropdownHidden = true,
            func = function() Addon:PrintDiagnostics() end
        },
        Options = {
            type = "execute",
            order = 100,
            name = L.OPT_CMD_OPTIONS,
            desc = L.OPT_CMD_OPTIONS_DESC,
            func = function(info) Options:OpenConfigWindow() end
        },
    }
}

---@type AceConfigOptionsTable
Options.table = {
    name = "Spoken Gossip",
    type = "group",
    childGroups = "tab",
    args = {
        General = GeneralTab,
        Profiles = nil, -- Filled in Options:Initialize, order is implicitly 100
        SlashCommands = SlashCommands,
    }
}

function Options:Initialize()
    self.initializationErrors = {}
    local function RunOptionalStep(name, callback)
        local succeeded, result = pcall(callback)
        if succeeded then
            return result
        end
        table.insert(self.initializationErrors, name .. ": " .. tostring(result))
    end

    RunOptionalStep("profile options", function()
        self.table.args.Profiles = AceDBOptions:GetOptionsTable(Addon.db)
    end)

    local AceConfig = LibStub("AceConfig-3.0")
    if Addon.RegisterOptionsTable then
        -- Embedded version for 1.12
        AceConfig = Addon
    end
    RunOptionalStep("AceConfig slash registration", function()
        AceConfig:RegisterOptionsTable("SpokenGossip", self.table, { "spokengossip", "spg" })
    end)
    RunOptionalStep("settings panel", function()
        SettingsPanel:Setup()
    end)

    RunOptionalStep("AceGUI options frame", function()
        self.frame = AceGUI:Create("Frame")
        AceConfigDialog:Open("SpokenGossip", self.frame)
        self.frame:SetLayout("Fill")
        self.frame:Hide()

        -- Closed with the Escape key, as the game's own windows are.
        _G["SpokenGossipOptions"] = self.frame.frame
        tinsert(UISpecialFrames, "SpokenGossipOptions")
    end)
end

--- The settings a player is looking for: the page where there is one, and the window
--- everywhere else.
function Options:OpenSettings()
    if SettingsPanel and SettingsPanel.Open and SettingsPanel:Open() then
        return
    end
    self:OpenConfigWindow()
end

function Options:OpenConfigWindow()
    if not self.frame then
        print("|cFFFF4040Spoken Gossip: the options window is unavailable on this client. " ..
            "Gossip reading and slash commands remain active.|r")
        return
    end
    if self.frame:IsShown() then
        PlaySound(SOUNDKIT.IG_MAINMENU_CLOSE)
        self.frame:Hide()
    else
        PlaySound(SOUNDKIT.IG_MAINMENU_OPEN)
        self.frame:Show()
        AceConfigDialog:Open("SpokenGossip", self.frame)
    end
end
