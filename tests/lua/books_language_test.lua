-- The language axis of the books addon: which pack reads a page, which index finds it, and
-- where a report goes. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local BOOKS = here .. "/../../addons/Spoken_Books/"
local Expect, Failures = H.Expecter(print)

local PAGE, ONLY_ENGLISH = 15, 16

--- Load the addon on a client in `locale`, with the given packs installed.
local function Install(packs, locale)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.SetLocale(locale or "enUS")
    _G.SpokenBooksSettings = nil
    _G.SpokenBooksAudioPacks = {}
    for _, pack in ipairs(packs) do
        _G.SpokenBooksAudioPacks[pack.addon] = { version = 1, addon = pack.addon,
            language = pack.language, pages = pack.pages, index = pack.index, loose = pack.loose }
    end
    _G.SpokenBooksData = {
        version = 1,
        index = { ["Registry"] = { [1] = {} } },
        loose = {},
        pages = { [PAGE] = { book = 1, number = 1, text = "English first page." },
            [ONLY_ENGLISH] = { book = 1, number = 2, text = "English second page." } },
        books = { [1] = { title = "Registry", pages = { PAGE, ONLY_ENGLISH } } },
    }
    local B = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio" }) do
        assert(loadfile(BOOKS .. file .. ".lua"))("Spoken_Books", B)
    end
    B:InitDB()
    return B
end

local ENGLISH = { addon = "SpokenBooksAudio", pages = {
    [PAGE] = { file = "15", len = 2 }, [ONLY_ENGLISH] = { file = "16", len = 2 } } }
local GERMAN = { addon = "SpokenBooksAudio_deDE", language = "deDE", pages = {
    [PAGE] = { file = "15", len = 2 } } }

---------------------------------------------------------------- A. the install that exists today
local B = Install({ ENGLISH })
local clip = B:ClipFor(PAGE)
Expect("A. an English pack declaring nothing reads on an English client",
    clip and clip.path, [[Interface\AddOns\SpokenBooksAudio\Sounds\15.mp3]])
Expect("A. ...as English", clip and clip.language, "enUS")
B = Install({ ENGLISH }, "deDE")
Expect("A. a German client with only English packs still hears English",
    B:ClipFor(PAGE) and B:ClipFor(PAGE).language, "enUS")

---------------------------------------------------------------- B. the voice language, then the fallback
B = Install({ ENGLISH, GERMAN }, "deDE")
Expect("B. a German client hears the German pack", B:ClipFor(PAGE).path,
    [[Interface\AddOns\SpokenBooksAudio_deDE\Sounds\15.mp3]])
Expect("B. a page the German pack lacks falls back to English", B:ClipFor(ONLY_ENGLISH).language, "enUS")
SpokenBooksSettings.fallbackLanguage = "none"
Expect("B. ...and is silent with no fallback", B:ClipFor(ONLY_ENGLISH), nil)

B = Install({ ENGLISH, GERMAN }, "enUS")
Expect("B. an English client hears English", B:ClipFor(PAGE).language, "enUS")
SpokenBooksSettings.voiceLanguage = "deDE"
Expect("B. ...unless it chose German", B:ClipFor(PAGE).language, "deDE")

---------------------------------------------------------------- C. the language the packs speak
B = Install({ ENGLISH }, "deDE")
Expect("C. a German client with only English packs hears English", B:GetPackLanguage(), "enUS")
B = Install({ ENGLISH, GERMAN }, "deDE")
Expect("C. ...and German once a German pack is installed", B:GetPackLanguage(), "deDE")

---------------------------------------------------------------- D. the page on screen, in the client's words
local GERMAN_TEXT = "Das Register der Stadt Hillsbrad."
local GERMAN_INDEX = { ["Stadtregister"] = { [1] = { [B:ChecksumOf(GERMAN_TEXT)] = PAGE } } }
local INDEXED = { addon = "SpokenBooksAudio_deDE", language = "deDE", pages = GERMAN.pages,
    index = GERMAN_INDEX, loose = {} }
B = Install({ ENGLISH }, "deDE")
stub.ShowPage({ title = "Stadtregister", number = 1, text = GERMAN_TEXT })
Expect("D. without a German pack a German page is not recognised", B:PageOnScreen(), nil)
B = Install({ ENGLISH, INDEXED }, "deDE")
Expect("D. before it is opened, a German page is titled as the corpus is", B:ClipFor(PAGE).present.header, "Registry")
stub.ShowPage({ title = "Stadtregister", number = 1, text = GERMAN_TEXT })
Expect("D. with one, it is found by the German title and words", B:PageOnScreen(), PAGE)
Expect("D. ...and then titled as the client shows it", B:ClipFor(PAGE).present.header, "Stadtregister")
Expect("D. ...while its English fallback page keeps the English title",
    B:ClipFor(ONLY_ENGLISH).present.header, "Registry")
Expect("D. older translated packs can caption the page opened in the client",
    B:ClipFor(PAGE).present.transcript, GERMAN_TEXT)
Expect("D. a fallback page uses English captions rather than the open German page",
    B:ClipFor(ONLY_ENGLISH).present.transcript, "English second page.")
SpokenBooksSettings.voiceLanguage = "enUS"
Expect("D. choosing an English voice uses the saved English words",
    B:ClipFor(PAGE).present.transcript, "English first page.")
B = Install({ ENGLISH, INDEXED }, "enUS")
stub.ShowPage({ title = "Stadtregister", number = 1, text = GERMAN_TEXT })
Expect("D. ...and only on a German client", B:PageOnScreen(), nil)
B = Install({ ENGLISH, { addon = "SpokenBooksAudio_deDE", language = "deDE", pages = GERMAN.pages,
    index = {}, loose = { [B:ChecksumOf(GERMAN_TEXT)] = PAGE } } }, "deDE")
stub.ShowPage({ title = "Ein anderer Titel", number = 1, text = GERMAN_TEXT })
Expect("D. a German checksum no other page shares is found under any title", B:PageOnScreen(), PAGE)
B = Install({ ENGLISH, { addon = "SpokenBooksAudio_frFR", language = "frFR", pages = GERMAN.pages,
    index = GERMAN_INDEX, loose = {} } }, "deDE")
stub.ShowPage({ title = "Stadtregister", number = 1, text = GERMAN_TEXT })
Expect("D. a pack in another language is not asked", B:PageOnScreen(), nil)

---------------------------------------------------------------- E. reports
B = Install({ ENGLISH, GERMAN }, "deDE")
Expect("E. a translated page with no text never shows English under German audio",
    B:ClipFor(PAGE).present.transcript, nil)
SpokenBooksAudioPacks.SpokenBooksAudio_deDE.pages = { [PAGE] = {
    file = "15", len = 2, text = "Gespeicherte deutsche Seite." } }
Expect("E. new packs provide captions before a page is opened",
    B:ClipFor(PAGE).present.transcript, "Gespeicherte deutsche Seite.")
B = Install({ ENGLISH })
Expect("E. an English report keeps its address", B:ReportURL(PAGE, "enUS"),
    "https://spoken.rusty.one/books/r/15")
Expect("E. ...as does one with no language", B:ReportURL(PAGE), "https://spoken.rusty.one/books/r/15")
Expect("E. a German report goes to the German page", B:ReportURL(PAGE, "deDE"),
    "https://spoken.rusty.one/deDE/books/r/15")

---------------------------------------------------------------- F. a language no client runs in
-- Italian has no index of its own: the page is found by the English client's and read from
-- the Italian pack, captions included.
local ITALIAN = { addon = "SpokenBooksAudio_itIT", language = "itIT", pages = {
    [PAGE] = { file = "15", len = 2, text = "Prima pagina italiana." } } }
B = Install({ ENGLISH, ITALIAN }, "enUS")
Expect("F. on Auto an English client hears English", B:GetVoiceLanguage(), "enUS")
SpokenBooksSettings.voiceLanguage = "itIT"
SpokenBooksData.index["Registry"][1][B:ChecksumOf("English first page.")] = PAGE
stub.ShowPage({ title = "Registry", number = 1, text = "English first page." })
Expect("F. the English index finds the page", B:PageOnScreen(), PAGE)
Expect("F. ...and the Italian pack reads it", B:ClipFor(PAGE).present.transcript, "Prima pagina italiana.")
B = Install({ ENGLISH, ITALIAN }, "itIT")
Expect("F. a client claiming Italian is not taken at its word", B:GetClientLanguage(), "enUS")
Expect("F. Italian is not a client language", B:IsClientLanguage("itIT"), false)

---------------------------------------------------------------- in step with SpokenZones
local booksCodes = {}
for _, locale in ipairs(B.LOCALES) do table.insert(booksCodes, locale.code) end
Expect("the language list matches SpokenZones'", table.concat(booksCodes, " "), H.ZonesLocaleCodes(here))

---------------------------------------------------------------- what the page is on
-- Read in the reading frame, a page shows what it is on: a book from the bags its own icon, a
-- stone tablet a tablet. Queued with no frame open, it shows the book.
do
    stub.SetLocale("enUS")
    local Bk = Install({ ENGLISH })
    Expect("a page queued with no frame open shows the book", Bk:ClipFor(PAGE).present.portrait.texture,
        [[Interface\AddOns\Spoken\Textures\Book]])
    -- Open as the item text events say, not as the game's frame shows: DialogueUI hides that frame
    -- and draws its own.
    Bk.lastPage = PAGE
    _G.ItemTextGetItem = function() return "Worn Tablet" end
    _G.ItemTextGetMaterial = function() return "Stone" end
    Expect("...one on stone shows a stone tablet", Bk:ClipFor(PAGE).present.portrait.texture, Bk.MATERIALS.Stone)
    -- The bags are Spoken's to search (Spoken:BagItemIcon); this test loads Books alone.
    local spoken = _G.Spoken
    _G.Spoken = { BagItemIcon = function(_, name) return name == "Worn Tablet" and 133741 or nil, { 0, 1, 0, 1 } end }
    Expect("...and a book from the bags its own icon", Bk:ClipFor(PAGE).present.portrait.texture, 133741)
    _G.Spoken = spoken
    Bk.lastPage = nil
    _G.ItemTextGetItem, _G.ItemTextGetMaterial = nil, nil
end

stub.SetLocale("enUS")
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll books language tests passed")
