local _, SpokenBooks = ...

-- French interface strings for Spoken Books.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "frFR" then
	return
end
L.OPT_NOTE = "Livres, lettres, notes et plaques, lus à voix haute quand vous les ouvrez."
L.OPT_SECTION_READING = "Quand lire"
L.OPT_AUTOPLAY = "Lire automatiquement"
L.OPT_AUTOPLAY_TIP = "Lit un livre ou une lettre dès son ouverture. Désactivé, rien ne démarre tout seul : appuyez sur Lecture sur la page, ou tapez /spb read."
L.OPT_WHOLE_BOOK = "Lire tout le livre"
L.OPT_WHOLE_BOOK_TIP = "Lit chaque page, pas seulement celle à l'écran. Ouvrir la première page met la suite en attente, pour que la voix continue pendant que vous tournez les pages."
L.OPT_READ_ONCE = "Ne lire qu'une fois"
L.OPT_READ_ONCE_TIP = "Ce que ce personnage a déjà entendu n'est pas relu quand vous l'ouvrez. Lecture fonctionne toujours."
L.OPT_SECTION_READ = "Historique de lecture"
L.OPT_FORGET = "Oublier ce qui a été lu"
L.OPT_FORGET_DONE_FMT = "livres oubliés : %1$d ; ils seront relus"
L.OPT_FORGET_TIP = "Efface la liste de ce que ce personnage a entendu, pour que tout soit relu. Ne compte que si Ne lire qu'une fois est activé."
L.PLAY = "Lecture"
L.STOP = "Arrêter"
L.PLAY_TIP = "Lire ce livre à voix haute"
L.STOP_TIP = "Arrêter de lire ce livre"
L.CONTRIBUTE = "Contribuer"
L.REPORT = "Signaler"
L.NO_LINE = "Aucune réplique pour cette page"
L.NO_LINE_TIP = "Envoyez le texte de votre propre client pour l'ajouter."
L.MENU_BOOK_SETTINGS = "Paramètres des Écrits"
L.OPT_SECTION_LANGUAGE = "Langue"
L.OPT_VOICE_LANGUAGE = "Langue de la voix"
L.OPT_VOICE_LANGUAGE_TIP = "La langue dans laquelle la voix lit. Auto utilise la langue de votre jeu. Une langue ne s'entend que si son pack de voix est installé."
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_FALLBACK_LANGUAGE = "Si une page manque"
L.OPT_FALLBACK_LANGUAGE_TIP = "Ce qu'il faut lire quand le pack de voix dans votre langue n'a pas d'enregistrement d'une page : la même page dans une autre langue, ou rien."
L.OPT_FALLBACK_NONE = "Rester silencieux"
L.OPT_NO_PACK_AUDIO = "Le pack de voix installé n'a pas encore de narration pour cette page."
L.OPT_NO_PACK_INSTALLED = "Aucun pack de voix Écrits n'est installé."
L.OPT_PAGE_COUNT_FMT = "Page %1$d sur %2$d"

-- Settings page
L.OPT_PAGE_TITLE = "Écrits"
L.OPT_PART_SWITCH = "Activer le module"
L.OPT_PART_SWITCH_TIP = "Active ou désactive la lecture des livres, lettres, notes et plaques. Désactivé, le module reste installé mais ne lit rien. Le même interrupteur se trouve sur la page Spoken."
L.REASON_PART_OFF = "Activez l'option Activer le module en haut de cette page pour utiliser ceci."
L.REASON_AUTOPLAY = "Activez l'option Lire automatiquement pour utiliser ceci."
L.OPT_STOP_ON_CLOSE = "Arrêter à la fermeture du livre"
L.OPT_STOP_ON_CLOSE_TIP = "Arrête la voix dès que vous fermez le livre, la lettre ou la plaque. Désactivé, la lecture continue après la fermeture."

-- Voice packs
L.OPT_SECTION_PACKS = "Packs de voix"
L.OPT_PACK_NAME_FMT = "Pack de voix (%1$s)"
L.OPT_PACK_OFFICIAL = "Écrits"
L.OPT_PACK_INSTALLED = "Installé"
L.OPT_DOWNLOAD = "Télécharger"
L.OPT_DOWNLOAD_TIP = "Affiche l'adresse à copier dans votre navigateur."
L.OPT_DOWNLOAD_ADDRESS = "Copiez cette adresse dans votre navigateur pour télécharger le pack de voix."

-- Fix a problem
L.OPT_SECTION_TROUBLE = "Résoudre un problème"
L.OPT_TEST_LINE = "Lire une réplique de test"
L.OPT_TEST_LINE_TIP = "Lit une page de votre pack de voix, comme une vraie, pour vérifier que vous l'entendez."
L.OPT_DIAGNOSTICS = "Afficher le diagnostic"
L.OPT_DIAGNOSTICS_TIP = "Affiche dans la fenêtre de discussion les packs de voix, les paramètres et les livres lus par ce personnage, pour un rapport de bug."
L.OPT_REPORT_PROBLEM = "Signaler un problème"
L.OPT_REPORT_PROBLEM_TIP = "Pour tout ce qui ne concerne pas une seule page ; chaque page a son propre bouton Signaler. Vous donne une adresse à copier dans votre navigateur."
L.OPT_REPORT_ADDRESS = "Copiez cette adresse dans votre navigateur pour nous signaler le problème."

-- Starting over
L.OPT_SECTION_START_OVER = "Réinitialisation"
L.OPT_RESET_PAGE = "Réinitialiser les paramètres du module Écrits"
L.OPT_RESET_PAGE_TIP = "Remet chaque paramètre de cette page à sa valeur par défaut. Ce que ce personnage a entendu est conservé."
L.OPT_RESET_PAGE_CONFIRM = "Remettre chaque paramètre du module Écrits à sa valeur par défaut ?"
L.OPT_RESET = "Réinitialiser"
L.OPT_CANCEL = "Annuler"
