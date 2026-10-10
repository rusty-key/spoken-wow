if not SpokenGossipEnv then return end
setfenv(1, SpokenGossipEnv)

-- What the DialogueUI bridge (the quests module's UI/DialogueUIBridge.lua) asks of this addon
-- for a gossip or greeting page on DialogueUI's window: its line, the words it expects, reading it
-- at once for the bridge's Play button, and stopping it. The bridge finds this table by name.
-- Gossip has no Read Automatically switch to offer (`autoplay`): NPC Greetings is on its page.
DialogueUIReader = {
    GetVisibleLine = function(event)
        if not Addon:IsPartOn() then
            return nil
        end
        return Addon:GetVisibleLine(event)
    end,
    ExpectedLine = function(event, textIsCurrent)
        if not Addon:IsPartOn() then
            return nil
        end
        return Addon:ExpectedLine(event, textIsCurrent)
    end,
    ReadNow = function(event, source)
        Player.playNow = true
        local ok, err = pcall(Addon.InvokeHandler, Addon, event, source, true)
        Player.playNow = nil
        return ok, err
    end,
    QueuedClipFor = function(line) return Player:QueuedClipFor(line) end,
    Remove = function(clip) Player:Remove(clip) end,
    source = function() return Player.source end,
}
