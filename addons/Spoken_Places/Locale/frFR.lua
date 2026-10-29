-- frFR. French interface strings for Spoken Places.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, SpokenPlaces = ...

if GetLocale() ~= "frFR" then
	return
end

local L = {}

L.OPT_SECTION_MAP = "Récits"
L.OPT_MAP_PANEL = "Récit à côté de la carte"
L.OPT_PICTURES = "Afficher les images"
L.OPT_MAP_HIGHLIGHT = "Surbrillance des zones"
L.OPT_PANEL_WIDTH = "Largeur du récit"
L.OPT_PLAY_BUTTON = "Lire les récits à voix haute"
L.OPT_AUTOPLAY = "Lire automatiquement"
L.OPT_AUTOPLAY_SUB = "Inclure les sous-zones"
L.OPT_AUTOPLAY_EXPLORED = "Inclure les lieux déjà découverts"
L.OPT_LANG_RELOAD = "Tapez /reload pour passer à cette langue."
L.OPT_LANGUAGE = "Langue du texte"
L.OPT_LANG_AUTO_FMT = "Auto (%1$s)"
L.OPT_LANG_SET_FMT = "Les récits seront en %1$s après le rechargement de l'interface."
L.OPT_LANG_PROFILE_FMT = "Ce profil lit les récits en %1$s. Tapez /reload pour changer."
L.OPT_REPORT_PROBLEM = "Signaler un problème"
L.MENU_LORE_WINDOW = "Ouvrir le Compendium d'Azeroth"
L.MENU_ZONE_SETTINGS = "Paramètres des Lieux"

L.OPT_REPORT_LINE_ADDRESS = "Copiez cette adresse et ouvrez-la dans votre navigateur pour signaler un problème avec cette entrée."

L.REPORT_BUTTON = "Signaler"
L.IN_ZONE_FMT = "Emplacement : %1$s"
L.DISCOVERED_FMT = "%1$d sur %2$d découvertes"
L.ZONE_COUNT_FMT = "%1$d zones"
L.ZONE_COUNT_ONE = "1 zone"
L.CONTINENT_COUNT_FMT = "%1$d continents"
L.CONTINENT_COUNT_ONE = "1 continent"

L.QUEUE_HELD_COMBAT = "En attente de la fin du combat."
L.QUEUE_HELD_CINEMATIC = "En attente de la fin de la cinématique."
L.QUEUE_HELD_OFF = "La narration est désactivée."
L.NOT_DISCOVERED = "Vous n'avez pas encore découvert ce lieu. Rendez-vous sur place pour lire son récit."
L.MAP_LORE_FOR_FMT = "récit de %1$s"
L.CMD_HEADING = "commandes (/spokenplaces, ou /spp) :"
L.CMD_STATUS = "  /spp            -- état de la zone et de la sous-zone actuelles"
L.CMD_DIAGNOSTICS = "  /spp diagnostics -- Afficher le diagnostic"
L.CMD_OPTIONS = "  /spp settings   -- la page Lieux des paramètres"
L.CMD_WINDOW = "  /spp window     -- ouvre le Compendium d'Azeroth"
L.CMD_PANEL = "  /spp panel      -- Récit à côté de la carte, activé ou non"
L.CMD_PLAY = "  /spp play       -- lit le récit du lieu où vous êtes"
L.CMD_STOP = "  /spp stop       -- arrête la lecture"
L.CMD_VOICE = "  /spp voice      -- Lire les récits à voix haute, activé ou non"
L.CMD_AUTOPLAY = "  /spp autoplay   -- Lire automatiquement, activé ou non"
L.CMD_AUDIO = "  /spp audio      -- les packs de voix installés"
L.CMD_LANG = "  /spp lang       -- Langue du texte : liste, ou change avec /spp lang <code> ou auto"
L.CMD_FORGET = "  /spp forget     -- Oublier les lieux entendus"


-- Settings page
L.OPT_PAGE_TITLE = "Lieux"
L.OPT_DEV_DEBUG = "Débogage des Lieux"
L.OPT_DEV_PREVIEW = "Traductions inachevées"
L.REASON_VOICE = "Activez l'option Lire les récits à voix haute pour utiliser ceci."
L.REASON_DISCOVERY = "Activez l'option Lire automatiquement pour utiliser ceci."
L.REASON_MAP_PANEL = "Activez l'option Récit à côté de la carte pour utiliser ceci."

-- Voice packs
L.OPT_DOWNLOAD_ADDRESS = "Copiez cette adresse dans votre navigateur pour télécharger le pack de voix."

-- Reading history
L.OPT_FORGET_PLACES = "Oublier les lieux entendus"
L.OPT_FORGET_PLACES_DONE = "La liste des lieux entendus par ce personnage est effacée."

-- Fix a problem

-- Starting over
L.OPT_RESET_PAGE_CONFIRM = "Remettre chaque paramètre du module Lieux à sa valeur par défaut ?"
L.OPT_RELOAD_NOW = "Recharger maintenant"
L.OPT_LATER = "Plus tard"

-- Lore of Azeroth and Zone Lore
L.COMPENDIUM_PLACES = "Lieux"
L.LORE_PANEL_TITLE = "Récit du lieu"
L.MAP_PANEL_EXPAND = "Afficher le récit du lieu"
L.PANEL_SHOWN = "Récit à côté de la carte : activé"
L.PANEL_HIDDEN = "Récit à côté de la carte : désactivé"
L.LORE_SEARCH = "Rechercher un lieu"
L.LORE_DISCOVERED_ONLY = "Découvertes seulement"
L.LORE_VOICED_ONLY = "Avec voix seulement"
L.LORE_SEARCH_NONE = "Aucun résultat."
L.OTHER_LANDS = "Autres terres"
L.BATTLEGROUNDS = "Champs de bataille"
L.DUNGEONS = "Donjons et raids"

L.OPEN_IN_COMPENDIUM = "Ouvrir dans le Compendium d'Azeroth"

SpokenPlaces:RegisterStrings("frFR", L)
