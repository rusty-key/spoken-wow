setfenv(1, VoiceOver)
Options = { }

local AceGUI = LibStub("AceGUI-3.0")
local AceConfigDialog = LibStub("AceConfigDialog-3.0")
local AceDBOptions = LibStub("AceDBOptions-3.0")

------------------------------------------------------------
-- Construction of the options table for AceConfigDialog --

local function SortAceConfigOptions(a, b)
    return (a.order or 100) < (b.order or 100)
end

-- Needed to preserve order (modern AceGUI has support for custom sorting of dropdown items, but old versions don't)
local FRAME_STRATAS =
{
    "BACKGROUND",
    "LOW",
    "MEDIUM",
    "HIGH",
    "DIALOG",
}

--- The language dropdowns' choices: every language, after one entry of the dropdown's own.
local function LanguageValues(firstKey, firstLabel)
    local values = { [firstKey] = firstLabel }
    for _, locale in ipairs(Language.LOCALES) do
        values[locale.code] = Language:GetNativeName(locale.code)
    end
    return values
end

-- General Tab
---@type AceConfigOptionsTable
local GeneralTab =
{
    name = L.OPT_GROUP_GENERAL,
    type = "group",
    order = 10,
    args = {
        Audio = {
            type = "group",
            order = 4,
            inline = true,
            name = L.OPT_GROUP_AUDIO,
            args = {
                ToggleAutoplay = {
                    type = "toggle",
                    order = 1,
                    width = 2,
                    name = L.OPT_AUTOPLAY,
                    desc = L.OPT_AUTOPLAY_TIP,
                    get = function(info) return Addon:IsAutoplayOn() end,
                    set = function(info, value) Addon:SetAutoplay(value) end,
                },
                LineBreak1 = { type = "description", name = "", order = 2 },
                GossipFrequency = {
                    type = "select",
                    width = 1.1,
                    order = 3,
                    -- It decides which greetings autoplay reads, so with autoplay off it has
                    -- nothing to decide.
                    disabled = function(info) return not Addon:IsAutoplayOn() end,
                    name = L.OPT_GREETING_FREQ,
                    desc = L.OPT_GREETING_FREQ_TIP,
                    values = {
                        [Enums.GossipFrequency.Always] = L.OPT_GREETING_ALWAYS,
                        [Enums.GossipFrequency.OncePerQuestNPC] = L.OPT_GREETING_ONCE_QUEST,
                        [Enums.GossipFrequency.OncePerNPC] = L.OPT_GREETING_ONCE_NPC,
                        [Enums.GossipFrequency.Never] = L.OPT_GREETING_NEVER,
                    },
                    get = function(info) return Addon.db.profile.Audio.GossipFrequency end,
                    set = function(info, value)
                        Addon.db.profile.Audio.GossipFrequency = value
                        Player:RefreshConfig()
                    end,
                },
                LineBreak2 = { type = "description", name = "", order = 5 },
                ToggleSyncToWindowState = {
                    type = "toggle",
                    order = 6,
                    width = 2,
                    name = L.OPT_SYNC_WINDOW,
                    desc = L.OPT_SYNC_WINDOW_TIP,
                    get = function(info) return Addon.db.profile.Audio.StopAudioOnDisengage end,
                    set = function(info, value)
                        Addon.db.profile.Audio.StopAudioOnDisengage = value
                    end,
                },
                LineBreak3 = { type = "description", name = "", order = 7 },
                -- Its own row: the two selects are one decision, and beside OGThrall they wrap
                -- unevenly on a narrow options frame.
                LineBreak4 = { type = "description", name = "", order = 8.5 },
                VoiceLanguage = {
                    type = "select",
                    width = 1.1,
                    order = 9,
                    name = L.OPT_VOICE_LANGUAGE,
                    desc = L.OPT_VOICE_LANGUAGE_TIP,
                    values = function()
                        return LanguageValues(Language.AUTO,
                            format(L.OPT_LANG_AUTO_FMT, Language:GetNativeName(Language:GetClientLanguage())))
                    end,
                    get = function(info) return Addon.db.profile.Audio.VoiceLanguage end,
                    set = function(info, value)
                        Addon.db.profile.Audio.VoiceLanguage = value
                    end,
                },
                FallbackLanguage = {
                    type = "select",
                    width = 1.1,
                    order = 10,
                    name = L.OPT_FALLBACK_LANGUAGE,
                    desc = L.OPT_FALLBACK_LANGUAGE_TIP,
                    values = function() return LanguageValues("none", L.OPT_FALLBACK_NONE) end,
                    get = function(info) return Addon.db.profile.Audio.FallbackLanguage end,
                    set = function(info, value)
                        Addon.db.profile.Audio.FallbackLanguage = value
                    end,
                },
                OGThrall = {
                    type = "toggle",
                    order = 8,
                    width = 2,
                    name = L.OPT_OG_THRALL,
                    desc = L.OPT_OG_THRALL_TIP,
                    get = function(info) return Addon.db.profile.Audio.OGThrall end,
                    set = function(info, value)
                        Addon.db.profile.Audio.OGThrall = value
                    end,
                },
            }
        },
        Debug = {
            type = "group",
            order = 5,
            inline = true,
            name = L.OPT_GROUP_DEBUG,
            args = {
                DebugEnabled = {
                    type = "toggle",
                    order = 1,
                    width = 1.25,
                    name = L.OPT_DEBUG,
                    desc = L.OPT_DEBUG_TIP,
                    get = function(info) return Addon.db.profile.DebugEnabled end,
                    set = function(info, value) Addon.db.profile.DebugEnabled = value end,
                },
            }
        }
    }
}

-- The 2.4.3/3.3.5 music-channel and HD-model settings are the Spoken player's now.
local LegacyWrathTab = nil

---@type AceConfigOptionsTable
local DataModulesTab =
{
    name = function() return format(L.OPT_TAB_DATA_MODULES .. "%s", next(Options.table.args.DataModules.args.Available.args) and "|cFF00CCFF (NEW)|r" or "") end,
    type = "group",
    childGroups = "tree",
    order = 20,
    args = {
        Available = {
            type = "group",
            name = L.OPT_AVAILABLE_GROUP,
            order = 100000,
            hidden = function(info) return not next(Options.table.args.DataModules.args.Available.args) end,
            args = {}
        }
    }
}

---@type AceConfigOptionsTable
local SlashCommands = {
    type = "group",
    name = L.OPT_CMD_GROUP,
    order = 110,
    inline = true,
    dialogHidden = true,
    args = {
        PlayPause = {
            type = "execute",
            order = 1,
            name = L.OPT_CMD_PLAYPAUSE,
            desc = L.OPT_CMD_PLAYPAUSE_DESC,
            hidden = true,
            func = function(info)
                if Spoken then Spoken:TogglePause() end
            end
        },
        Play = {
            type = "execute",
            order = 2,
            name = L.OPT_CMD_PLAY,
            desc = L.OPT_CMD_PLAY_DESC,
            func = function(info)
                if Spoken then Spoken:Resume() end
            end
        },
        Pause = {
            type = "execute",
            order = 3,
            name = L.OPT_CMD_PAUSE,
            desc = L.OPT_CMD_PAUSE_DESC,
            func = function(info)
                if Spoken then Spoken:Pause() end
            end
        },
        Skip = {
            type = "execute",
            order = 4,
            name = L.OPT_CMD_SKIP,
            desc = L.OPT_CMD_SKIP_DESC,
            func = function(info)
                if Spoken then Spoken:Skip() end
            end
        },
        Clear = {
            type = "execute",
            order = 5,
            name = L.OPT_CMD_CLEAR,
            desc = L.OPT_CMD_CLEAR_DESC,
            func = function(info)
                if Spoken then Spoken:StopAll() end
            end
        },
        Read = {
            type = "execute",
            order = 70,
            name = L.OPT_CMD_READ,
            desc = L.OPT_CMD_READ_DESC,
            dropdownHidden = true,
            func = function(info)
                if not Addon:ReadVisibleQuest("/spq read") then
                    print("|cFFFF4040Spoken Quests: no visible quest detail, progress, reward, greeting, or gossip panel was found.|r")
                end
            end
        },
        Test = {
            type = "execute",
            order = 80,
            name = L.OPT_CMD_TEST,
            desc = L.OPT_CMD_TEST_DESC,
            dropdownHidden = true,
            func = function() Options:RunSelfTest() end
        },
        Diagnostics = {
            type = "execute",
            order = 90,
            name = L.OPT_CMD_DIAG,
            desc = L.OPT_CMD_DIAG_DESC,
            dropdownHidden = true,
            func = function() Options:PrintDiagnostics() end
        },
        Options = {
            type = "execute",
            order = 100,
            name = L.OPT_CMD_OPTIONS,
            desc = L.OPT_CMD_OPTIONS_DESC,
            func = function(info)
                Options:OpenConfigWindow()
            end
        },
    }
}

---@type AceConfigOptionsTable
Options.table = {
    name = "Spoken Quests",
    type = "group",
    childGroups = "tab",
    args = {
        General = GeneralTab,
        LegacyWrath = LegacyWrathTab,
        DataModules = DataModulesTab,
        Profiles = nil, -- Filled in Options:OnInitialize, order is implicitly 100

        SlashCommands = SlashCommands,
    }
}
------------------------------------------------------------

---@param module DataModuleMetadata
---@param order number
function Options:AddDataModule(module, order)
    local descriptionOrder = 0
    local function GetNextOrder()
        descriptionOrder = descriptionOrder + 1
        return descriptionOrder
    end
    local function MakeDescription(header, text)
        return { type = "description", order = GetNextOrder(), name = function() return format("%s%s: |r%s", NORMAL_FONT_COLOR_CODE, header, type(text) == "function" and text() or text) end }
    end

    local name, title, notes, loadable, reason = DataModules:GetModuleAddOnInfo(module)
    if reason == "DEMAND_LOADED" or reason == "INTERFACE_VERSION" then
        reason = nil
    end
    DataModulesTab.args[module.AddonName] = {
        name = function()
            local isLoaded = DataModules:GetModule(module.AddonName)
            return format("%d. %s%s%s|r",
                order,
                reason and RED_FONT_COLOR_CODE or isLoaded and HIGHLIGHT_FONT_COLOR_CODE or GRAY_FONT_COLOR_CODE,
                string.gsub(module.Title, "VoiceOver Data %- ", ""),
                isLoaded and "" or L.OPT_NOT_LOADED_SUFFIX)
        end,
        type = "group",
        order = order,
        args = {
            AddonName = MakeDescription(L.OPT_ROW_ADDON_NAME, module.AddonName),
            Title = MakeDescription(L.OPT_ROW_TITLE, module.Title),
            ModuleVersion = MakeDescription(L.OPT_ROW_FORMAT_VERSION, module.ModuleVersion),
            ModulePriority = MakeDescription(L.OPT_ROW_PRIORITY, module.ModulePriority),
            Language = MakeDescription(L.OPT_ROW_LANGUAGE, function() return Language:GetName(module.Language) end),
            ContentVersion = MakeDescription(L.OPT_ROW_CONTENT_VERSION, module.ContentVersion),
            LoadOnDemand = MakeDescription(L.OPT_ROW_LOAD_ON_DEMAND, module.LoadOnDemand and YES or NO),
            Loaded = MakeDescription(L.OPT_ROW_LOADED, function() return DataModules:GetModule(module.AddonName) and YES or NO end),
            NotLoadableReason = {
                type = "description",
                order = GetNextOrder(),
                name = format(L.OPT_ROW_REASON_FMT, NORMAL_FONT_COLOR_CODE, RED_FONT_COLOR_CODE, reason and _G["ADDON_"..reason] or ""),
                hidden = not reason,
            },
            Load = {
                type = "execute",
                order = GetNextOrder(),
                name = L.OPT_LOAD_BUTTON,
                hidden = function() return reason or not module.LoadOnDemand or DataModules:GetModule(module.AddonName) end,
                func = function()
                    local loaded, reason = DataModules:LoadModule(module)
                    if not loaded then
                        StaticPopup_Show("VOICEOVER_ERROR", format([[Failed to load data module "%s". Reason: %s]], module.AddonName, reason and _G["ADDON_" .. reason] or "Unknown"))
                    end
                end,
            },
        }
    }
end

---@param module AvailableDataModule
---@param order number
---@param update boolean Data module has update
function Options:AddAvailableDataModule(module, order, update)
    local descriptionOrder = 0
    local function GetNextOrder()
        descriptionOrder = descriptionOrder + 1
        return descriptionOrder
    end
    local function MakeDescription(header, text)
        return { type = "description", order = GetNextOrder(), name = function() return format("%s%s: |r%s", NORMAL_FONT_COLOR_CODE, header, type(text) == "function" and text() or text) end }
    end

    DataModulesTab.args.Available.args[module.AddonName] = {
        name = Utils:ColorizeText(format(update and "%s" .. L.OPT_UPDATE_SUFFIX or "%s", DataModules:GetPackLabel(module)), "|cFF00CCFF"),
        type = "group",
        order = order,
        args = {
            AddonName = MakeDescription(L.OPT_ROW_ADDON_NAME, module.AddonName),
            Title = MakeDescription(L.OPT_ROW_TITLE, module.Title),
            ContentVersion = MakeDescription(L.OPT_ROW_CONTENT_VERSION, format(update and L.OPT_CONTENT_VERSION_UPDATE_FMT or L.OPT_CONTENT_VERSION_FMT, module.ContentVersion, update and DataModules:GetPresentModule(module.AddonName).ContentVersion)),
            URL = {
                type = "input",
                order = GetNextOrder(),
                width = "full",
                name = L.OPT_DOWNLOAD_URL,
                get = function(info) return module.URL end,
                set = function(info) end,
            },
        }
    }
end

---Initialization of opens panel
--- Play a known line the way a real one goes: through the player, on the configured
--- channel. Called by `/spq test` and by the button on the settings panel, so the two
--- cannot answer differently.
function Options:RunSelfTest()
            local soundData = {
                event = Enums.SoundEvent.QuestAccept,
                questID = 3441,
                name = "Spoken Quests self-test",
                title = "Spoken Quests self-test",
            }
            if not DataModules:PrepareSound(soundData) then
                Debug:Record("self-test-data-failed", "The Vanilla Data module did not provide the known 3441-accept test sound")
                print("|cFFFF4040Spoken Quests test failed: the known Vanilla test sound was not found in the loaded sound packs.|r")
                return
            end

            -- Through the player, the route every real line takes: on 2.4.3 and 3.3.5
            -- that means the music channel, and a self-test that went another way would
            -- answer a question nobody asked.
            local channel = Player.source and Player.source:GetChannel() or "unknown"
            if Player:Enqueue(soundData) then
                Debug:Record("self-test-playing", format("Self-test queued on %s: %s", channel, soundData.filePath))
                print(format("|cFF40FF40Spoken Quests test started on %s.|r You should hear a short voice line.", channel))
            else
                local stage, message = Debug:GetRuntimeStatus()
                print(format("|cFFFF4040Spoken Quests test failed: %s (%s).|r", message or "refused", stage or "unknown"))
            end
end

--- What to paste into a bug report: the client, the sound settings, and what loaded.
function Options:PrintDiagnostics()
            print(format("|cFF00CCFFSpoken Quests %s|r - client %s, interface %d",
                AddonVersion, Version.Client or "unknown", Version.Interface or 0))
            print("AddOn API: " .. (C_AddOns and "C_AddOns compatibility layer" or "legacy globals"))

            local channel = Player.source and Player.source:GetChannel() or "unknown"
            print(format("Playback: channel=%s, paused=%s, queue=%d, player=%s", channel,
                tostring(Spoken and Spoken:IsPaused()), Spoken and Spoken:GetQueueSize() or 0,
                Spoken and Spoken.ADDON_VERSION or "missing"))
            print("NPC greetings: " ..
                (Enums.GossipFrequency:GetName(Addon.db.profile.Audio.GossipFrequency) or "unknown"))
            print(format("Sound CVars: all=%s, master=%s, SFX=%s/%s, dialog=%s/%s",
                tostring(GetCVar("Sound_EnableAllSound")), tostring(GetCVar("Sound_MasterVolume")),
                tostring(GetCVar("Sound_EnableSFX")), tostring(GetCVar("Sound_SFXVolume")),
                tostring(GetCVar("Sound_EnableDialog")), tostring(GetCVar("Sound_DialogVolume"))))

            local presentCount, registeredCount = 0, 0
            for _, module in DataModules:GetPresentModules() do
                presentCount = presentCount + 1
                local registered = DataModules:GetModule(module.AddonName) ~= nil
                if registered then
                    registeredCount = registeredCount + 1
                end
                local status = registered and "loaded" or (DataModules:GetModuleLoadError(module.AddonName) or "not loaded")
                print(format("Data: %s (%s) - %s", module.AddonName,
                    module.ContentVersion or "unknown version", status))
            end
            if presentCount == 0 then
                print("Data: no sound packs were detected")
            else
                print(format("Data modules: %d detected, %d loaded", presentCount, registeredCount))
            end
            local stage, message = Debug:GetRuntimeStatus()
            print(format("Last runtime stage: %s - %s", stage or "none", message or "no details"))
            if Addon.eventBridgeErrors then
                for _, warning in ipairs(Addon.eventBridgeErrors) do
                    print("Bridge warning: " .. warning)
                end
            end
            if Addon.optionsInitializationError then
                print("Options startup warning: " .. Addon.optionsInitializationError)
            end
            if Addon.dataModulesPending then
                print("Data startup: loading is deferred until one second after entering the world")
            elseif Addon.dataModulesDeferredError then
                print("Data startup warning: " .. Addon.dataModulesDeferredError)
            end
            if Options.initializationErrors then
                for _, warning in ipairs(Options.initializationErrors) do
                    print("Options warning: " .. warning)
                end
            end
end

function Options:Initialize()
    self.initializationErrors = {}
    local function RunOptionalStep(name, callback)
        local succeeded, result = pcall(callback)
        if succeeded then
            return result
        end
        local message = name .. ": " .. tostring(result)
        table.insert(self.initializationErrors, message)
    end

    RunOptionalStep("profile options", function()
        self.table.args.Profiles = AceDBOptions:GetOptionsTable(Addon.db)
    end)

    -- Create options table
    Debug:Print("Registering options table...", "Options")
    local AceConfig = LibStub("AceConfig-3.0")
    if Addon.RegisterOptionsTable then
        -- Embedded version for 1.12
        AceConfig = Addon
    end
    RunOptionalStep("AceConfig slash registration", function()
        -- A table, not a string: AceConfig registers each as a slash command for the same
        -- options table. The pre-rename "vo" is not among them: the addon answers to one
        -- name, and a command that still worked would keep the retired one alive in macros
        -- and in what players tell each other.
        AceConfig:RegisterOptionsTable("SpokenQuests", self.table, { "spokenquests", "spq" })
    end)
    RunOptionalStep("settings panel", function()
        -- One canvas panel of sections rather than a Blizzard category per group. The
        -- table above still backs every /spq command and still fills the window below,
        -- which is where profiles and the pack manager live.
        SettingsPanel:Setup()
    end)
    Debug:Print("Done!", "Options")

    -- Create the option frame
    ---@type AceGUIFrame|AceGUIWidget
    RunOptionalStep("AceGUI options frame", function()
        self.frame = AceGUI:Create("Frame")
        --AceConfigDialog:SetDefaultSize("VoiceOver", 640, 780) -- Let it be auto-sized
        AceConfigDialog:Open("SpokenQuests", self.frame)
        self.frame:SetLayout("Fill")
        self.frame:Hide()

        -- Enable the frame to be closed with Escape key
        _G["VoiceOverOptions"] = self.frame.frame
        tinsert(UISpecialFrames, "VoiceOverOptions")
    end)
end

--- The settings a player is looking for: the panel where there is one, and the window
--- everywhere else. The window is still how profiles and the pack manager are reached.
function Options:OpenSettings()
    if SettingsPanel and SettingsPanel.Open and SettingsPanel:Open() then
        return
    end
    self:OpenConfigWindow()
end

function Options:OpenConfigWindow()
    if not self.frame then
        print("|cFFFF4040Spoken Quests: the legacy options window is unavailable on this client. " ..
            "Quest narration and slash commands remain active.|r")
        return
    end
    if self.frame:IsShown() then
        PlaySound(SOUNDKIT.IG_MAINMENU_CLOSE)
        self.frame:Hide()
    else
        PlaySound(SOUNDKIT.IG_MAINMENU_OPEN)
        self.frame:Show()
        AceConfigDialog:Open("SpokenQuests", self.frame)
    end
end
