local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

local function Boot(client)
    stub.SetClient(client or "11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
    _G.UISpecialFrames = _G.UISpecialFrames or {}
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon.db.profile.Frame.Style = "queue"
    env.Addon:Enable()
    local source = env.Sources:Register("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
    return env, source
end
local function Line(title)
    return H.Clip({ length = 30, present = { label = title, header = "Grull",
        transcript = "These words must never appear in this style.", portrait = { kind = "none" } } })
end
local env, source = Boot()
local Q, T = env.QueuePlayer, env.Transcript
local function CheckPortraitEvents(state, expectedRefreshes)
    local refreshes, refreshedClip = 0, nil
    local configure = env.Portrait.Configure
    env.Portrait.Configure = function(self, portrait, clip)
        if portrait == Q.portrait then
            refreshes = refreshes + 1
            refreshedClip = clip
        end
        return configure(self, portrait, clip)
    end
    local current = env.SoundQueue:GetCurrentSound()
    local watcher = env.StaticPortrait.watcher
    for _, event in ipairs({ "PLAYER_TARGET_CHANGED", "UPDATE_MOUSEOVER_UNIT", "GOSSIP_SHOW",
        "QUEST_DETAIL", "UNIT_PORTRAIT_UPDATE", "UNIT_MODEL_CHANGED" }) do
        local ok = pcall(watcher.scripts.OnEvent, watcher, event, "target")
        Expect(state .. ": " .. event .. " does not error", ok, true)
    end
    env.Portrait.Configure = configure
    Expect(state .. ": portrait refresh count", refreshes, expectedRefreshes)
    if expectedRefreshes > 0 then
        Expect(state .. ": redraws the current clip", refreshedClip, current)
    end
    Expect(state .. ": events preserve the queue head", env.SoundQueue:GetCurrentSound(), current)
end
CheckPortraitEvents("empty queue", 0)
Expect("queue style is selected on Classic Era", env.Addon:PlayerStyle(), "queue")
Expect("style is named Classic", env.Options.STYLE_LABELS.queue, "Classic")
Expect("Classic is first in style selection", env.Options:Styles()[1], "queue")
source:Enqueue(Line("First"))
source:Enqueue(Line("Second"))
CheckPortraitEvents("playing narration", 6)
Expect("portrait queue is the active window", env.PlayerFrame:Skin(), Q)
Expect("queue window is wanted", Q.wanted, true)
Expect("speaker name", Q.name:GetText(), "Grull")
Expect("current title", Q.rows[1].label:GetText(), "(Quest) First")
Expect("next title", Q.rows[2].label:GetText(), "(Quest) Second")
Expect("Classic progress defaults off", Q.progress.track:IsShown(), false)
local compactHeight = Q.content:GetHeight()
env.Options:UpdateRows()
local progressOption
for _, entry in ipairs(_G.SpokenOptionsPanel.layout.entries) do
    if entry.label == env.L.OPT_SUBTITLE_PROGRESS then progressOption = entry.frame end
end
Expect("Classic offers Show Progress", progressOption ~= nil and progressOption:IsShown(), true)
progressOption:SetChecked(true)
progressOption.scripts.OnClick(progressOption)
Expect("Show Progress enables Classic's own setting", env.Addon.db.profile.Frame.QueueProgress, true)
Expect("progress is visible when enabled", Q.progress.track:IsShown(), true)
Expect("enabled progress gets layout room", Q.content:GetHeight() > compactHeight, true)
progressOption:SetChecked(false)
progressOption.scripts.OnClick(progressOption)
Expect("Show Progress can be turned off", Q.progress.track:IsShown(), false)
Expect("other styles keep their progress setting", env.Addon.db.profile.Transcript.SubtitleProgress, true)
Expect("playing icon on current narration", Q.rows[1].marker:IsShown(), true)
Expect("waiting narration has no marker", Q.rows[2].marker:IsShown(), false)
Expect("captions stay hidden with Show Words enabled", T.frame:IsShown(), false)
Expect("caption height is zero", T:HeightForClip(env.SoundQueue:GetCurrentSound()), 0)
Q.play.scripts.OnClick(Q.play)
Expect("pause uses shared queue", env.SoundQueue:IsPaused(), true)
Expect("paused control shows Play", Q.play.state, "play")
Expect("pause bars hidden", Q.pauseBars[1]:IsShown(), false)
Expect("play triangle visible", Q.play.glyph:IsShown(), true)
Expect("paused narration has no playing icon", Q.rows[1].marker:IsShown(), false)
Q.play.scripts.OnClick(Q.play)
Expect("play resumes queue", env.SoundQueue:IsPaused(), false)
Expect("playing control shows Pause", Q.play.state, "pause")
Expect("pause bars visible", Q.pauseBars[1]:IsShown(), true)
Expect("play triangle hidden", Q.play.glyph:IsShown(), false)
Expect("no Skip button", Q.skip, nil)
Expect("no Stop All button", Q.clear, nil)
Expect("no range counter", Q.footer, nil)
Expect("row has a dismiss button at the right", Q.rows[1].remove.anchor.point, "RIGHT")
Expect("no paging buttons on a short queue", Q.down:IsShown(), false)
Expect("short queue has no overflow cue", Q.more:IsShown(), false)
source:Enqueue(Line("Title 3"))
Expect("three rows need no overflow cue", Q.more:IsShown(), false)
local fullHeight, fullContent = Q.frame:GetHeight(), Q.content:GetHeight()
local rowInset = Q.rows[1].anchor.x
source:Enqueue(Line("Title 4"))
Expect("arrows appear once scrolling is needed", Q.down:IsShown(), true)
Expect("long queue shows overflow dots", Q.more:IsShown(), true)
Expect("scrolling adds no window height", Q.frame:GetHeight(), fullHeight)
Expect("scrolling adds no content height", Q.content:GetHeight(), fullContent)
Expect("row space stays reserved", Q.rows[1].anchor.x, rowInset)
Expect("arrows share a vertical column", Q.up.anchor.x, Q.down.anchor.x)
Expect("arrows align with first two rows", Q.up.anchor.y - Q.down.anchor.y, 24)
for i = 5, 9 do source:Enqueue(Line("Title " .. i)) end
Q:Scroll(100)
Expect("scroll clamps to last three", Q.offset, 6)
Expect("last row is reachable", Q.rows[3].label:GetText(), "(Quest) Title 9")
for _, row in ipairs(Q.rows) do
    Expect("scrolled waiting row has no marker", row.marker:IsShown(), false)
end
local head = env.SoundQueue:GetCurrentSound()
Q.rows[3].remove.scripts.OnClick(Q.rows[3].remove)
Expect("remove waiting title preserves head", env.SoundQueue:GetCurrentSound(), head)
Expect("removal updates the list", env.SoundQueue:GetQueueSize(), 8)
Expect("offset clamps after removal", Q.offset, 5)
Q:Scroll(-100)
Q.rows[1].remove.scripts.OnClick(Q.rows[1].remove)
Expect("removing current advances", env.SoundQueue:GetCurrentSound() ~= head, true)
Expect("new head displayed immediately", Q.rows[1].label:GetText(), "(Quest) Second")
env.SoundQueue:Skip()
Expect("Skip advances", Q.rows[1].label:GetText(), "(Quest) Title 3")
env.Addon.db.profile.Frame.HidePortrait = true
env.PlayerFrame:RefreshConfig()
Expect("Hide Portrait applies", Q.portrait:IsShown(), false)
CheckPortraitEvents("hidden portrait", 0)
env.Addon:SetPlayerStyle("minimal")
env.PlayerFrame:RefreshConfig(); T:RefreshConfig()
Expect("switching away hides queue immediately", Q.frame:IsShown(), false)
Expect("Show Words preserved", env.Addon.db.profile.Transcript.Enabled, true)
Expect("other style has caption height", T:HeightForClip(env.SoundQueue:GetCurrentSound()) > 0, true)
env.Addon:SetPlayerStyle("queue")
env.PlayerFrame:RefreshConfig(); T:RefreshConfig()
Expect("captions hidden when switching back", T.frame:IsShown(), false)
env.SoundQueue:RemoveAllSoundsFromQueue()
Expect("Stop All empties the queue", env.SoundQueue:IsEmpty(), true)
Expect("empty queue hides the window", Q.wanted, false)
CheckPortraitEvents("drained queue", 0)
source:Enqueue(H.Clip({ length = 30, present = { label = "Greetings", header = "Grull",
    bullet = "gossip", portrait = { kind = "none" } } }))
Expect("NPC gossip shows the NPC name without a category prefix", Q.rows[1].label:GetText(), "Grull")
env.SoundQueue:RemoveAllSoundsFromQueue()
local books = env.Sources:Register("books", { title = "Spoken Books" })
local zones = env.Sources:Register("zones", { title = "Spoken Zones" })
books:Enqueue(Line("A letter"))
zones:Enqueue(Line("Elwynn Forest"))
Expect("book category prefixed", Q.rows[1].label:GetText(), "(Book) A letter")
Expect("zone category prefixed", Q.rows[2].label:GetText(), "(Zone) Elwynn Forest")
Expect("cue disappears when queue fits again", Q.more:IsShown(), false)
env.SoundQueue:RemoveAllSoundsFromQueue()
env.Options:Preview("queue")
Expect("preview draws sample title", Q.rows[1].label:GetText(), env.L.SAMPLE_LINE)
Expect("preview leaves real queue empty", env.SoundQueue:IsEmpty(), true)
Expect("sample playback is disabled", Q.play:IsEnabled(), false)
Expect("sample has no dismiss button", Q.rows[1].remove:IsShown(), false)
env.Options:Preview(nil)
Expect("ending preview hides window", Q.wanted, false)
Expect("callbacks have no swallowed errors", #env.Callbacks.errors, 0)
local legacy = Boot("1.12")
Expect("legacy client keeps supported fallback", legacy.Addon:PlayerStyle(), "classic")
os.exit(Failures() == 0 and 0 or 1)
