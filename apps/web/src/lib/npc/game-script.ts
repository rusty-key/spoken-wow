/**
 * The chat commands that make a game client fetch a list of NPCs from its server.
 *
 * `DressUpModel:SetCreature(id)` asks the server about a creature the client has not cached,
 * and the answer lands in creaturecache.wdb with the appearance ids /contributions/game-data
 * reads -- the same call the addon's portraits rely on (Spoken/UI/Portrait.lua). The last
 * command walks the list one NPC at a time, retrying each until its model loads or five
 * seconds pass, and prints `id modelFileId` so progress is visible.
 *
 * A chat line takes 255 characters, so the ids are split across as many lines as it takes,
 * each appending to one global list.
 *
 * Free of imports on purpose: the game-data page is a client component and reads it.
 */
export const CHAT_LINE_LIMIT = 255;

const RUNNER =
  '/run local m,k,w=CreateFrame("DressUpModel",nil,UIParent),1,0 m:SetSize(9,9)' +
  'm:SetScript("OnUpdate",function(s,e)local n=SPK[k]if not n then return s:Hide()end ' +
  "s:SetCreature(n)local f=s:GetModelFileID()w=w+e if f or w>5 then print(n,f)k=k+1 w=0 end end)";

export function gameScript(npcIds: number[]): string[] {
  const lines: string[] = [];
  let batch: number[] = [];
  const line = (ids: number[]) =>
    lines.length === 0
      ? `/run SPK={${ids.join(",")}}`
      : `/run for _,v in ipairs({${ids.join(",")}})do SPK[#SPK+1]=v end`;

  for (const id of npcIds) {
    if (line([...batch, id]).length > CHAT_LINE_LIMIT) {
      lines.push(line(batch));
      batch = [];
    }
    batch.push(id);
  }
  if (batch.length || lines.length === 0) lines.push(line(batch));
  return [...lines, RUNNER];
}
