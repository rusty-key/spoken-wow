local _, SpokenBooks = ...

-- French interface strings for Spoken Books.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "frFR" then
	return
end
L.OPT_NOTE = "Livres, lettres et notes lus à voix haute via le lecteur Spoken. La narration nécessite le pack Spoken Books Audio."
L.OPT_SECTION_READING = "Lecture"
L.OPT_AUTOPLAY = "Lire un livre à son ouverture"
L.OPT_AUTOPLAY_TIP = "Désactivé, rien ne démarre tout seul et un livre n'est lu qu'en appuyant sur Lecture ou en tapant /spb read."
L.OPT_WHOLE_BOOK = "Lire tout le livre, pas seulement la page visible"
L.OPT_WHOLE_BOOK_TIP = "Ouvrir la première page met la suite en file, ainsi un journal continue pendant qu'on tourne ses pages."
L.OPT_READ_ONCE = "Ne lire chaque livre qu'une fois"
L.OPT_READ_ONCE_TIP = "Un livre déjà entendu avec ce personnage n'est pas relu à son ouverture. Lecture fonctionne toujours, et ce qui a été lu est mémorisé par personnage."
L.OPT_SECTION_READ = "Ce que ce personnage a lu"
L.OPT_FORGET = "Oublier ce qui a été lu"
L.OPT_FORGET_DONE_FMT = "%1$d livre%2$s oublié%2$s ; ils seront relus"
L.OPT_FORGET_TIP = "Efface le registre de ce personnage, pour que chaque livre soit nouveau. N'importe que si « Ne lire chaque livre qu'une fois » est activé."
L.PLAY = "Lecture"
L.STOP = "Arrêter"
L.PLAY_TIP = "Lire ce livre à voix haute"
L.STOP_TIP = "Arrêter de lire ce livre"
L.CONTRIBUTE = "Contribuer"
L.REPORT = "Signaler"
L.NO_LINE = "Aucune réplique pour cette page"
L.NO_LINE_TIP = "Envoyez le texte de votre propre client pour l'ajouter."
L.MENU_READ_BOOK = "Lire ce livre"
L.MENU_BOOK_SETTINGS = "Paramètres de Spoken Books"
L.OPT_SECTION_LANGUAGE = "Langue"
L.OPT_VOICE_LANGUAGE = "Langue de la voix"
L.OPT_VOICE_LANGUAGE_TIP = "De quelle langue est le pack sonore qui vous lit. Auto utilise la langue de votre jeu. Une langue ne s'entend que si un pack enregistré dedans est installé."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "Langue de repli"
L.OPT_FALLBACK_LANGUAGE_TIP = "Quoi lire quand aucun pack dans votre langue n'a la page. Aucune la laisse silencieuse plutôt que de la lire dans une langue non demandée."
L.OPT_FALLBACK_NONE = "Aucune (silence)"
L.OPT_NO_PACK_AUDIO = "Le pack sonore installé n'a pas encore de narration pour cette page."
L.OPT_NO_PACK_INSTALLED = "Aucun pack sonore Spoken Books n'est installé."
L.OPT_PAGE_COUNT_FMT = "Page %1$d sur %2$d"
