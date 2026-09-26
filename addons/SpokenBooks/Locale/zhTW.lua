local _, SpokenBooks = ...

-- Traditional Chinese interface strings for Spoken Books.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "zhTW" then
	return
end
L.OPT_NOTE = "透過 Spoken 播放器大聲朗讀書籍、信件和筆記。旁白需要 Spoken Books Audio 包。"
L.OPT_SECTION_READING = "閱讀"
L.OPT_AUTOPLAY = "開啟書籍時朗讀"
L.OPT_AUTOPLAY_TIP = "關閉後不會自動開始，只有點擊播放或輸入 /spb read 才會朗讀書籍。"
L.OPT_WHOLE_BOOK = "朗讀整本書，而不僅是目前頁"
L.OPT_WHOLE_BOOK_TIP = "開啟第一頁會將其餘排入佇列，因此翻閱日誌時旁白不會中斷。"
L.OPT_READ_ONCE = "每本書只朗讀一次"
L.OPT_READ_ONCE_TIP = "此角色已聽過的書再次開啟時不再朗讀。播放仍然有效，已讀記錄按角色記住。"
L.OPT_SECTION_READ = "此角色已讀內容"
L.OPT_FORGET = "忘記已讀記錄"
L.OPT_FORGET_DONE_FMT = "已忘記 %1$d 本書；將重新朗讀。"
L.OPT_FORGET_TIP = "清除此角色的記錄，使每本書都如初見。僅在「每本書只朗讀一次」開啟時有意義。"
L.PLAY = "播放"
L.STOP = "停止"
L.PLAY_TIP = "大聲朗讀這本書"
L.STOP_TIP = "停止朗讀這本書"
L.CONTRIBUTE = "貢獻"
L.REPORT = "回報"
L.NO_LINE = "本頁沒有台詞"
L.NO_LINE_TIP = "傳送你客戶端的文字以便新增。"
L.MENU_READ_BOOK = "朗讀這本書"
L.MENU_BOOK_SETTINGS = "Spoken Books 設定"
L.OPT_SECTION_LANGUAGE = "語言"
L.OPT_VOICE_LANGUAGE = "語音語言"
L.OPT_VOICE_LANGUAGE_TIP = "哪個語言的音包為你朗讀。自動使用你的遊戲執行語言。只有安裝了以該語言錄製的音包才能聽到。"
L.OPT_LANG_AUTO_FMT = "自動（%1$s）"
L.OPT_FALLBACK_LANGUAGE = "備選語言"
L.OPT_FALLBACK_LANGUAGE_TIP = "所選語言的包沒有該頁面時讀什麼。選擇無則保持靜默，而不用你沒要的語言朗讀。"
L.OPT_FALLBACK_NONE = "無（靜默）"
L.OPT_NO_PACK_AUDIO = "已安裝的音包還沒有本頁的旁白。"
L.OPT_NO_PACK_INSTALLED = "未安裝 Spoken Books 音包。"
L.OPT_PAGE_COUNT_FMT = "第 %1$d 頁，共 %2$d 頁"
