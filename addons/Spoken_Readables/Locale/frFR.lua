local _, SpokenBooks = ...

-- French interface strings for Spoken Readables.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "frFR" then
	return
end
L.OPT_AUTOPLAY = "Lire automatiquement"
L.OPT_WHOLE_BOOK = "Lire tout le livre"
L.OPT_ONE_LINE = "Lire le livre en une réplique"
L.OPT_READ_ONCE = "Ne lire qu'une fois"
L.OPT_FORGET = "Oublier les lectures entendues"
L.OPT_FORGET_DONE_FMT = "lectures oubliées : %1$d ; elles seront relues"
L.PLAY = "Lecture"
L.STOP = "Arrêter"
L.PLAY_TIP = "Lire ceci à voix haute"
L.STOP_TIP = "Arrêter de lire ceci"
-- DialogueUI's book view: Play's tooltip (UI/DialogueUIBook.lua).
L.DUI_ON = "Activé"
L.DUI_OFF = "Désactivé"
L.DUI_PLAY_RIGHT_CLICK = "Clic droit pour activer ou désactiver « Lire automatiquement »."
L.CONTRIBUTE = "Contribuer"
L.REPORT = "Signaler"
L.REPORT_PROBLEM = "Signaler un problème"
L.REPORT_LINE_TIP = "Obtenez un lien pour signaler une lecture erronée, un nom mal prononcé ou une narration qui ne correspond pas à la page."
L.REPORT_LINE_ADDRESS = "Copiez cette adresse et ouvrez-la dans votre navigateur pour signaler un problème avec cette page."
L.NO_LINE = "Aucune réplique pour cette page"
L.NO_LINE_TIP = "Envoyez le texte de votre propre client pour l'ajouter."
L.MENU_BOOK_SETTINGS = "Paramètres des Lectures"
L.OPT_NO_PACK_AUDIO = "Le pack de voix installé n'a pas encore de narration pour cette page."
L.OPT_NO_PACK_INSTALLED = "Aucun pack de voix pour les Lectures n'est installé."
L.OPT_PAGE_COUNT_FMT = "Page %1$d sur %2$d"

-- Settings page
L.OPT_PAGE_TITLE = "Lectures"
L.OPT_DEV_DEBUG = "Débogage des Lectures"
L.REASON_AUTOPLAY = "Activez l'option Lire automatiquement pour utiliser ceci."
L.REASON_READ_ONCE = "Activez l'option Ne lire qu'une fois pour utiliser ceci."
L.REASON_WHOLE_BOOK = "Activez l'option Lire tout le livre pour utiliser ceci."
L.OPT_STOP_ON_CLOSE = "Arrêter à la fermeture du livre"
L.OPT_CLOSE_WHEN_READ = "Fermer le livre après lecture"

-- Voice packs
L.OPT_DOWNLOAD_ADDRESS = "Copiez cette adresse dans votre navigateur pour télécharger le pack de voix."

-- Fix a problem

-- Starting over
L.OPT_RESET_PAGE_CONFIRM = "Remettre chaque paramètre du module Lectures à sa valeur par défaut ?"

-- Azeroth's Compendium: the readables' tab (UI/Readables.lua) and its settings.
L.COMPENDIUM_READABLES = "Lectures"
L.READABLES_SEARCH = "Rechercher une lecture"
L.READABLES_NONE = "Aucun résultat."
L.READABLES_FOUND_ONLY = "Trouvées seulement"
L.READABLES_VOICED_ONLY = "Avec voix seulement"
L.TYPE_BOOK = "Livres"
L.TYPE_JOURNAL = "Journaux"
L.TYPE_LETTER = "Lettres"
L.TYPE_NOTE = "Notes"
L.TYPE_SCROLL = "Parchemins"
L.TYPE_TABLET = "Tablettes et runes"
L.TYPE_PLAQUE = "Plaques et panneaux"
L.TYPE_GRAVE = "Pierres tombales"
L.TYPE_EXHIBIT = "Pièces de musée"
L.TYPE_PICTURE = "Images et cartes"
L.TYPE_OTHER = "Autres"
-- One readable of each kind, over its name in the windows and the subtitle.
L.READABLE_BOOK = "Livre"
L.READABLE_JOURNAL = "Journal"
L.READABLE_LETTER = "Lettre"
L.READABLE_NOTE = "Note"
L.READABLE_SCROLL = "Parchemin"
L.READABLE_TABLET = "Tablette"
L.READABLE_PLAQUE = "Plaque"
L.READABLE_GRAVE = "Pierre tombale"
L.READABLE_EXHIBIT = "Pièce de musée"
L.READABLE_PICTURE = "Image"
L.READABLE_OTHER = "Autre"
L.READABLES_BY_ZONE = "Par zone"
L.READABLES_BY_TYPE = "Par type"
L.GROUP_EVENTS = "Fêtes et événements"
L.EVENT_WINTER_VEIL = "Voile d'hiver"
L.EVENT_HARVEST_FESTIVAL = "Fête des moissons"
L.EVENT_FISHING_EXTRAVAGANZA = "Concours de pêche de Strangleronce"
L.EVENT_SCOURGE_INVASION = "Invasion du Fléau"
L.GROUP_WIDE = "Partout en Azeroth"
L.GROUP_UNKNOWN = "Lieu inconnu"
L.GROUP_LANDS = "Autres terres"
L.GROUP_BATTLEGROUNDS = "Champs de bataille"
L.GROUP_DUNGEONS = "Donjons et raids"
L.READABLES_PICK = "Choisissez à gauche un livre, une lettre, une note ou une plaque pour le lire. Maj-clic sur un texte le met dans la file, après ce qui est en cours de lecture."
L.READABLE_NOT_FOUND = "Vous ne l'avez pas encore trouvé. Ouvrez-le dans le monde pour le lire ici."
L.OPEN_IN_COMPENDIUM = "Ouvrir dans le Compendium d'Azeroth"
L.OPEN_READABLE_IN_COMPENDIUM_TIP = "Ce texte dans le Compendium d'Azeroth, avec toutes les autres lectures."
L.FOUND_FMT = "%1$d sur %2$d trouvées"
L.READABLES_IN_FMT = "Emplacement : %1$s"
L.READABLES_MORE_FMT = " et %1$d autres"
L.BOOKS_TITLE_NTH_FMT = "%1$s (%2$d)"
