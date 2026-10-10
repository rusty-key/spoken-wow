setfenv(1, SpokenEnv)

-- Captions are left out of the 1.12 client: UI\Transcript.lua is Lua 5.1 and this client
-- runs 5.0, so its .toc loads this instead of Transcript.xml. The players and the slash
-- command call into Transcript unconditionally; here every call means "no captions".
Transcript = { unavailable = true }

function Transcript:HeightForClip() return 0 end

-- The one piece the players need regardless: the frame's resize bounds.
function Transcript:ResizePlayer(frame, height, minWidth, maxWidth)
    if frame.SetMinResize then
        frame:SetMinResize(minWidth, height)
        frame:SetMaxResize(maxWidth, height)
    end
    if frame:GetHeight() ~= height then frame:SetHeight(height) end
end

function Transcript:Initialize() end
function Transcript:Sync() end
function Transcript:Hold() end
function Transcript:Release() end
function Transcript:Dock() end
function Transcript:SetEnabled() end
function Transcript:Reset() end
function Transcript:RefreshConfig() end
function Transcript:ScrollMode() return "off" end
function Transcript:SetStyle() end
function Transcript:GetScroll() return 1, 1 end
function Transcript:ScrollTo() end
function Transcript:Describe() return "transcript: not available on this client" end
