-- The language axis of the books addon: which pack reads a page, which index finds it, and
-- where a report goes. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local BOOKS = here .. "/../../addons/Spoken_Readables/"
local Expect, Failures = H.Expecter(print)

local PAGE, ONLY_ENGLISH = 15, 16

--- Load the addon on a client in `locale`, with the given packs installed.
local function Install(packs, locale)
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    stub.SetLocale(locale or "enUS")
    _G.SpokenBooksSettings = nil
    _G.SpokenBooksAudioPacks = {}
    for _, pack in ipairs(packs) do
        _G.SpokenBooksAudioPacks[pack.addon] = { version = 1, addon = pack.addon,
            language = pack.language, pages = pack.pages, index = pack.index, loose = pack.loose,
            extraIndex = pack.extraIndex, extraLoose = pack.extraLoose, places = pack.places,
            books = pack.books }
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
        assert(loadfile(BOOKS .. file .. ".lua"))("Spoken_Readables", B)
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
Expect("D. before it is opened, a German page is titled as the corpus is", B:ClipFor(PAGE).present.label, "Registry")
stub.ShowPage({ title = "Stadtregister", number = 1, text = GERMAN_TEXT })
Expect("D. with one, it is found by the German title and words", B:PageOnScreen(), PAGE)
Expect("D. ...and then titled as the client shows it", B:ClipFor(PAGE).present.label, "Stadtregister")
Expect("D. ...while its English fallback page keeps the English title",
    B:ClipFor(ONLY_ENGLISH).present.label, "Registry")
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
Expect("E. with no Spoken there is nothing to report to", B:ReportURL(PAGE), nil)
-- The address is Spoken's to build (Spoken:ReportURL); this suite loads Books alone.
stub.LoadSpoken(here .. "/../../addons/Spoken/")
Expect("E. an English report keeps its address", B:ReportURL(PAGE, "enUS"),
    "https://spoken.rusty.one/books/r/15")
Expect("E. ...as does one with no language", B:ReportURL(PAGE), "https://spoken.rusty.one/books/r/15")
Expect("E. a German report goes to the German page", B:ReportURL(PAGE, "deDE"),
    "https://spoken.rusty.one/deDE/books/r/15")
_G.Spoken, _G.SpokenEnv = nil, nil

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

---------------------------------------------------------------- G. pages only a pack has
do
    local MINTED = "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"
    local TEXT = "Trotamundos."
    local sum = Install({}, "esES"):ChecksumOf(TEXT)
    local function Pack(extra)
        local pack = { addon = "SpokenBooksAudio_esES", language = "esES",
            pages = { [MINTED] = { file = MINTED, len = 2, text = TEXT } },
            extraIndex = { ["Instrucciones"] = { [1] = { [sum] = MINTED } } },
            extraLoose = {},
            places = { [MINTED] = { book = "n1", number = 1 } },
            books = { ["n1"] = { pages = { MINTED } } } }
        for k, v in pairs(extra or {}) do pack[k] = v end
        return pack
    end

    B = Install({ Pack() }, "esES")
    stub.ShowPage({ title = "Instrucciones", number = 1, text = TEXT })
    Expect("G. a pack with only extra pages is still asked", B:PageOnScreen(), MINTED)
    Expect("G. ...and has its audio", B:HasAudio(MINTED), true)
    local minted = B:ClipFor(MINTED)
    Expect("G. ...read from the pack's own file", minted and minted.path,
        [[Interface\AddOns\SpokenBooksAudio_esES\Sounds\]] .. MINTED .. ".mp3")
    Expect("G. ...queued under its lineId", minted and minted.key, "b:" .. MINTED)
    Expect("G. ...titled as the client shows it", (B:ClipFor(MINTED) or {}).present.label, "Instrucciones")
    Expect("G. ...placed in the pack's book", B:PlaceOf(MINTED), "n1")
    Expect("G. ...which reads from its page", B:BookOf(MINTED).pages[1], MINTED)
    stub.LoadSpoken(here .. "/../../addons/Spoken/")
    Expect("G. ...reported by its key", B:ReportURL(MINTED, "esES"),
        "https://spoken.rusty.one/esES/books/r/" .. MINTED)
    Expect("G. an English report of a minted page", B:ReportURL(MINTED),
        "https://spoken.rusty.one/books/r/" .. MINTED)
    Expect("G. a string that is not a minted key has no report", B:ReportURL("../x", "esES"), nil)
    _G.Spoken, _G.SpokenEnv = nil, nil

    B = Install({ Pack({ extraIndex = {}, extraLoose = { [sum] = MINTED } }) }, "esES")
    stub.ShowPage({ title = "Otro", number = 1, text = TEXT })
    Expect("G. the pack's loose table finds it under any title", B:PageOnScreen(), MINTED)

    B = Install({ Pack({ extraIndex = false, extraLoose = false, places = false, books = false }) }, "esES")
    stub.ShowPage({ title = "Instrucciones", number = 1, text = TEXT })
    Expect("G. a pack without the extra tables finds nothing, as an older addon would", B:PageOnScreen(), nil)
    Expect("G. ...and does not place the page", B:PlaceOf(MINTED), nil)
    Expect("G. ...nor read it", B:ClipFor(MINTED), nil)

    -- A book Books.lua has, with one more page only the pack carries.
    local both = Pack({ places = { [MINTED] = { book = 1, number = 3 } },
        books = { [1] = { pages = { MINTED } } } })
    B = Install({ ENGLISH, both }, "esES")
    local pages = B:BookOf(PAGE).pages
    Expect("G. an extracted book merges its pack pages in number order",
        table.concat(pages, ","), PAGE .. "," .. ONLY_ENGLISH .. "," .. MINTED)
    Expect("G. ...whichever page it is asked from", table.concat(B:BookOf(MINTED).pages, ","),
        PAGE .. "," .. ONLY_ENGLISH .. "," .. MINTED)
    Expect("G. ...with the corpus's title", B:BookOf(MINTED).title, "Registry")
    Expect("G. ...and the corpus's list left alone", #SpokenBooksData.books[1].pages, 2)
    both.books[1].pages = { MINTED, ONLY_ENGLISH }
    Expect("G. a page both list is not repeated", #B:BookOf(PAGE).pages, 3)
end

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
    -- The next page of the open book is built while another is open (the one before it ends, or
    -- DialogueUI has left the game on the last): it keeps the book's picture.
    Expect("a later page of the open book keeps its icon", Bk:ClipFor(ONLY_ENGLISH).present.portrait.texture, 133741)
    Expect("...and its material", Bk:ClipFor(ONLY_ENGLISH).present.material, "Stone")
    _G.Spoken = spoken
    Bk.lastPage = nil
    _G.ItemTextGetItem, _G.ItemTextGetMaterial = nil, nil
end

---------------------------------------------------------------- the words a token page's clip says
B = Install({ ENGLISH })
SpokenBooksData.pages[PAGE].text = "Greetings, $gbrother:sister;. $N, you are ready."
Expect("an English caption's tokens are subtitled as the clip says them",
    B:ClipFor(PAGE).present.transcript, "Greetings, brother. Adventurer, you are ready.")

stub.SetLocale("enUS")
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll books language tests passed")
