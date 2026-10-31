local _, Bosses = ...

-- French interface strings for Spoken Bosses.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = Bosses.L

if GetLocale() ~= "frFR" then
	return
end
L.COMPENDIUM_BOSSES = "Boss"
L.BOSSES_SEARCH = "Rechercher un boss"
L.BOSSES_NONE = "Aucun résultat."
L.BOSSES_FOUND_ONLY = "Trouvés seulement"
L.BOSSES_FOUND_FMT = "%1$d sur %2$d trouvés"
L.BOSS_IN_FMT = "Emplacement : %1$s"
L.BOSS_NOT_FOUND = "Vous n'avez pas encore rencontré ce boss. Affrontez-le dans son donjon ou son raid pour lire son récit ici."
L.GROUP_LANDS = "Autres terres"
L.OPT_PAGE_TITLE = "Boss"
L.OPT_RESET_PAGE_CONFIRM = "Remettre chaque paramètre du module Boss à sa valeur par défaut ?"
L.OPT_FORGET_STORIES = "Oublier les récits affichés"
L.OPT_FORGET_STORIES_DONE_FMT = "récits oubliés : %1$d ; ils seront de nouveau affichés"
L.OPT_DOWNLOAD_ADDRESS = "Copiez cette adresse dans votre navigateur pour télécharger le pack de voix."
L.PART_ABOUT = "Le récit d'un boss, dans le narrateur, quand vous le tuez."
