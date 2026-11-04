/**
 * The front page's words, in English. Every other language's file has this shape.
 *
 * Plain strings only, so a dictionary can cross from the server page to the client components
 * as props. A `{name}` is filled in by `fill`. A string that holds a sentence holds all of it:
 * nothing is built from pieces, because a piece does not translate.
 */
export const EN = {
  meta: {
    title: "Spoken: voiced quests, lore and books for World of Warcraft",
    description:
      "Spoken reads quest dialogue, NPC greetings, zone lore and in-world books aloud in WoW: Forever and Classic Era. Install it with the Spoken Manager, CurseForge or by hand.",
  },
  skip: "Skip to content",
  newTab: " (opens in a new tab)",
  nav: {
    sections: "Sections",
    menu: "Menu",
    voices: "Voices",
    install: "Install",
    gallery: "Gallery",
    community: "Community",
    signIn: "Sign in",
    backstage: "Backstage",
    language: "Language",
  },
  hero: {
    title: "Spoken reads World of Warcraft aloud",
    lede: "Quest dialogue, NPC greetings, zone lore and in-world books, voiced in ten languages with subtitles on screen. Spoken is a free addon for WoW: Forever and Classic Era.",
    install: "Install Spoken",
    gallery: "See the gallery",
    managerRuns: "The Spoken Manager runs on Windows, macOS and Linux.",
    worksWith: "Works with",
    foreverAlt: "World of Warcraft: Forever",
    eraAlt: "World of Warcraft Classic Era",
    lineLabel: "An example of Spoken's subtitles: a character speaking a line",
  },
  voices: {
    title: "What Spoken voices",
    intro: "Five parts, each with its own on/off switch in the settings. Pick one to see what it does.",
    subtitlesTitle: "Subtitles and windows",
    subtitles:
      "Show the words as subtitles, in a small window or in a large one. Words can be highlighted as they are spoken. Every line has Stop and Replay.",
    languagesTitle: "Languages",
    languages:
      "English, German, Spanish (Spain and Latin America), French, Portuguese, Russian, Korean and both Chinese scripts. Italian is made by the community.",
    reportsTitle: "Reports",
    reports:
      "If a line has a wrong word or voice, the Report button sends it to the people who correct it. The fix comes in an update.",
    compendiumTitle: "Azeroth's Compendium",
    compendium:
      "Every quest, place story, readable and boss story in one window, with a search box. Play any of them without going there.",
    compendiumTabs: "Tabs in the Compendium",
    compendiumOpens:
      "Opens from the minimap menu, with /sp compendium, or from the Place Story button beside the world map",
    compendiumText: "Text size and the text language are set on Spoken's page",
    compendiumShotAlt:
      "The Compendium on its Places tab: the zones and areas in a list on the left, and the story of Shadowglen on the right",
  },
  showcase: {
    partsLabel: "Parts of Spoken",
    quests: {
      title: "Quests",
      summary: "Quest givers speak the accept and completion text when you open a quest.",
      facts: [
        "A voice that fits the speaker's race and sex",
        "Several NPCs can share one quest, such as the class trainers",
        "Names, and most classes and races, are read as “adventurer”",
      ],
      browse: "Browse the quests",
      position: "Position in the quests example",
    },
    gossip: {
      title: "Gossip",
      summary: "Innkeepers, guards and vendors greet you and answer when you talk to them.",
      facts: [
        "Greetings and replies, voiced per NPC",
        "A guard line is shared by every guard that says it",
        "Silence NPC Voices mutes the game's own voice for the same NPC",
      ],
      browse: "Browse the gossip",
      position: "Position in the gossip example",
    },
    places: {
      title: "Places",
      summary: "A narrator tells the lore of each zone and area as you enter it.",
      facts: ["Zone and subzone lore, one recording per place", "Starts when you cross into the area", "Available in ten languages"],
      browse: "Browse the places",
      position: "Position in the places example",
    },
    readables: {
      title: "Readables",
      summary: "Books, letters, notes and plaques you open in the world are read aloud.",
      facts: [
        "Has its own on/off switch in Spoken's settings",
        "Stop and Replay work on every line",
        "Book pages with no voice yet can be contributed",
      ],
      browse: "Browse the readables",
      position: "Position in the readables example",
    },
    bosses: {
      title: "Bosses",
      summary: "A boss's story shows in the narrator when you target it or when it dies.",
      facts: [
        "Voiced when Spoken Audio: Places and Bosses is installed, words only without it",
        "Shown once for each boss on each character",
        "Pick target or kill under Show a Boss's Story",
      ],
      browse: "Browse the bosses",
      position: "Position in the bosses example",
    },
    examplesLabel: "Examples",
    noVoice: "Boss stories are voiced by the Spoken Audio: Places and Bosses pack. Without it they show as words in the narrator.",
    noRecording: "No recording yet",
    playNone: "Play: no recording yet",
    play: "Play: {name}",
    pause: "Pause: {name}",
    time: "{time} of {total}",
    failed: "This recording could not be played. Check your connection and try again.",
    earlier: "Earlier examples",
    more: "More examples",
    /** What a recording's second line says where the data holds a kind of text rather than a title. */
    kinds: {
      Gossip: "Gossip",
      Journal: "Journal",
      Letter: "Letter",
      Tablet: "Tablet",
      Scroll: "Scroll",
    },
  },
  manager: {
    title: "Spoken Manager",
    lead: "A desktop app for Windows, macOS and Linux. It installs and updates Spoken and its voice packs for every WoW install on your computer. An update downloads only the files that changed, not the whole pack again.",
    download: "Download the Manager",
    files: "Windows .exe, macOS .dmg or Linux .AppImage, from the GitHub release page.",
    step1: "It finds your games",
    step1Text: "Forever and Classic Era each get a card.",
    step2: "You choose the languages",
    step2Text: "Install Spoken and the voice packs you want with one button.",
    step3: "Updates are one button",
    step3Text: "New versions and new recordings show up as an Update button on the card.",
    windowLabel: "The Spoken Manager window, listing two installed games with their Spoken status",
  },
  install: {
    title: "Install Spoken",
    intro: "Choose one. Each installs Spoken and the voice packs for your language. Restart the game afterwards.",
    waysLabel: "Ways to install Spoken",
    tabManager: "Spoken Manager",
    tabCurseforge: "CurseForge",
    tabManual: "By hand",
    recommended: "Recommended",
    managerText:
      "Download the Manager, open it and press Install. It finds your game folder, installs Spoken and the voice packs for the languages you pick, and updates them when a new version comes out. An update downloads only the files that changed, so a new recording does not mean downloading the whole pack again.",
    managerPros: [
      "Finds your game folder",
      "Updates download only what changed, not the whole pack",
      "Installs every pack, in any language",
      "Optional sharing sends the lines you collect, a few minutes after you log out",
      "Lists community voice packs",
    ],
    windows: "Windows (.exe)",
    macArm: "macOS, Apple silicon (.dmg)",
    macIntel: "macOS, Intel (.dmg)",
    linux: "Linux (.AppImage)",
    otherFiles: "Other files are on the {link}. If Windows SmartScreen stops the installer, choose More info, then Run anyway.",
    releasePage: "release page",
    italianVoice: "For Italian, choose the language under Voice Language in Spoken's settings.",
    curseforgeText:
      "Install the Spoken addon for your language in the CurseForge app. It pulls in Spoken and every voice pack for that language. It only works through the app: the website download of a meta addon is empty.",
    curseforgePros: [
      "One meta addon per language",
      "Updates through the CurseForge app",
      "Works only through the app",
      "New packs can take longer to appear",
    ],
    italianOthers: "Italian is made by others and not maintained here: {link}. {note}",
    italianLink: "Spoken Italian",
    italianNote: "No game client runs in Italian: install the pack, then choose the language under Voice Language in Spoken's settings.",
    manualText: "Pick your language, download each zip and unzip them into Interface/AddOns.",
    manualPros: ["Plain zips from GitHub", "The only route for the 1.12 and 3.3.5 clients", "You update every zip yourself"],
    noPack: "No pack in this language yet",
    oldClients: "On the 1.12 and 3.3.5 clients, take the Spoken Quests zip from the release page. Spoken is inside it.",
    addon: "Spoken",
    addonNote: "The addon. Required.",
    packName: "{name} voices",
    githubAll: "GitHub: all",
    curseforgePart: "CurseForge: {part}",
    sections: {
      quests: { name: "Quests and Gossip", note: "Quest dialogue and what NPCs say" },
      places: { name: "Places", note: "Lore of each zone" },
      readables: { name: "Readables", note: "Books, letters and notes" },
      bosses: { name: "Bosses", note: "The story of each dungeon and raid boss" },
    },
  },
  gallery: {
    title: "Gallery",
    previous: "Previous picture",
    next: "Next picture",
    pictures: "Gallery pictures",
    earlier: "Earlier pictures",
    more: "More pictures",
    items: [
      {
        title: "Place story",
        text: "The Place Story panel beside the map, here for Go'Shek Farm, with its picture and story. Buttons open the Compendium, play the story and report it.",
        alt: "The world map open on Go'Shek Farm, with its Place Story panel beside it",
      },
      {
        title: "Zones on the map",
        text: "A zone has a story and a picture too. Arathi Highlands also shows how many of its 19 places have been discovered.",
        alt: "The Arathi Highlands map with the Place Story panel showing its picture and lore",
      },
      {
        title: "Dark look",
        text: "The Place Story panel in the dark look, telling the story of Azeroth beside the world map.",
        alt: "The world map with a dark Place Story panel telling the story of Azeroth",
      },
      {
        title: "Narrator on parchment",
        text: "A place story in the narrator window, with its picture. The word being read is marked in red, with Stop, Skip and Report buttons.",
        alt: "A parchment panel for Teldrassil showing a picture and the first lines of its story",
      },
      {
        title: "Compendium: Places",
        text: "Azeroth's Compendium lists places by continent and zone, with how many are discovered, and plays any story without going there.",
        alt: "The Compendium's Places tab showing the story of Shadowglen with its picture",
      },
      {
        title: "Compendium: Quests",
        text: "A quest with the text of its description and its completion, and a Play button for each.",
        alt: "The Compendium's Quests tab showing the quest Rescue OOX-09/HL with its text",
      },
      {
        title: "Compendium, dark look",
        text: "The Compendium in the dark look, here on the quest Jitters' Growling Gut.",
        alt: "The Compendium in a dark look showing the quest Jitters' Growling Gut",
      },
      {
        title: "Compendium: Readables",
        text: "Books, journals, letters, notes and scrolls, listed by name and kind. Here, Lonebrow's Journal.",
        alt: "The Compendium's Readables tab showing Lonebrow's Journal",
      },
      {
        title: "DialogueUI: Parchment",
        text: "A journal page read in the DialogueUI narrator style, on its Parchment theme. The word being read is marked in red.",
        alt: "A Faded Journal Page with its text and playback buttons, one word marked in red",
      },
      {
        title: "DialogueUI: Dark",
        text: "A tablet read in the DialogueUI narrator style, on its Dark theme. The word being read is marked in gold.",
        alt: "An Ancient Tablet with its text and playback buttons, one word highlighted in gold",
      },
    ],
  },
  fits: {
    title: "Fits the way you play",
    intro: "Spoken follows your game's language and works alongside the addons that change how quests look.",
    languagesTitle: "Voice languages",
    languages:
      "Menus and settings follow the game's text language. The language you hear is a separate choice, Voice Language, and plays once its voice pack is installed. Italian is made by the community.",
    addonsTitle: "Addons it works with",
    dialogueUi: "Adds a Listen button and marks the words being read inside its window. Its own settings are left alone.",
    ellesmereUi: "Spoken's windows, scroll bars and Compendium can draw in its flat look and font.",
    leatrixPlus: "Quests it accepts or turns in for you are still read. Auto turn-in addons work the same way.",
    leatrixMaps: "The Place Story panel sits beside the map frame Leatrix draws.",
    versionsTitle: "Game versions",
    versions:
      "WoW: Forever and Classic Era. On the 1.12 and 3.3.5 clients Spoken starts in the Large Window, and 3.3.5 can switch to subtitles.",
  },
  backstage: {
    title: "Backstage",
    intro: "Every voice in Spoken starts as a line a player sent in. Backstage is where the team takes it from there.",
    flow: [
      {
        title: "Players send lines",
        text: "Optional sharing in the Manager, or the Contribute page, sends quest, NPC and book text that has no voice yet.",
      },
      { title: "The team reviews", text: "Contributions are checked and translated where they need it." },
      { title: "Voices are made", text: "Recordings are generated on this website and checked by listeners." },
      { title: "Packs are updated", text: "New recordings ship as voice pack updates, which the Manager installs." },
    ],
    workTitle: "Work on the voices",
    work: [
      "Generate and replace voice recordings for quests, gossip, zones and books",
      "Translate lines and set how names and words are pronounced",
      "Review player reports and the lines players contributed",
    ],
    roles: "What you can change depends on your role in each language. Without an account you can still browse the lines and {link}.",
    upload: "upload the lines you collected",
  },
  login: {
    signInTitle: "Sign in",
    account: "Use your Spoken account.",
    email: "Email",
    password: "Password",
    signingIn: "Signing in...",
    noAccount: "No account yet?",
    register: "Register",
    forgot: "Forgot your password?",
    welcome: "Welcome back",
    signedInAs: "Signed in as {email}",
    open: "Open Backstage",
    notYou: "Not you?",
    signOut: "Sign out",
    signOutFailed: "Could not sign out. Try again.",
    failed: "Something went wrong. Try again.",
  },
  community: {
    title: "Community",
    intro: "Forever keeps adding quests and NPCs. Spoken learns the new text from players.",
    shareTitle: "Share what you find",
    share:
      "Sharing is optional. Turn it on in the Manager and Spoken sends the quest and NPC text it has no voice for, so it can be recorded.",
    packTitle: "Make a voice pack",
    pack: "Another narrator, a missing language or fixes to an official pack. Packs are listed on the Manager's Community page.",
    helpTitle: "Get help",
    help: "Help, bug reports and ideas have their own channels on Discord, in every language Spoken supports.",
    discord: "Join the Discord",
  },
  footer: {
    label: "Footer",
    releases: "Releases",
    browse: "Browse the lines",
    contribute: "Contribute",
    disclaimer:
      "Spoken is a fan project and is not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft and the game artwork shown here belong to Blizzard Entertainment.",
  },
};

type Widen<T> = T extends string ? string : T extends readonly (infer U)[] ? Widen<U>[] : { [K in keyof T]: Widen<T[K]> };

/** The shape of a dictionary: every key of English, with a string wherever English has one. */
export type SiteText = Widen<typeof EN>;
