// Every word the window shows, in English. Other languages can follow by swapping this file's
// object; nothing else in the window holds text a player reads (apart from names from the data).
import { FLAVOR_FOLDER_LIST, type Section, type Snapshot } from '@shared/types'

export type Platform = Snapshot['platform']

/** What the system calls its file browser, for text that says where a folder opens. */
export function fileManager(platform: Platform): string {
  return platform === 'darwin' ? 'Finder' : platform === 'linux' ? 'File Manager' : 'Explorer'
}

/** Where the game usually lives, for the help text of the empty state. */
function gameFolderExample(platform: Platform): string {
  if (platform === 'darwin') return '/Applications/World of Warcraft'
  if (platform === 'linux') return 'the World of Warcraft folder inside your Wine prefix or Lutris/Bottles game folder'
  return 'the game folder (for example C:\\Program Files (x86)\\World of Warcraft)'
}

export const REPO_URL = 'https://github.com/rusty-key/spoken-wow'
export const SITE_URL = 'https://spoken.rusty.one'
export const COMMUNITY_README_URL = 'https://github.com/rusty-key/spoken-wow/blob/master/community/README.md'

export const S = {
  appName: 'Spoken Manager',
  tabs: { home: 'Home', spoken: 'Spoken', voices: 'Voice Packs', community: 'Community', settings: 'Settings' },
  refresh: {
    idle: 'Check for New Versions',
    last: (time: string) => `Last checked ${time}`,
    offline: 'Offline: showing what was kept',
    label: 'Refresh the List of Releases'
  },
  banners: {
    offline: "Can't reach GitHub. Showing the last list.",
    updateReady: (v: string) => `Update ready: restart to use ${v}`,
    updating: (pct: number) => `Downloading a manager update: ${pct}%`,
    updateAvailable: (v: string) => `Version ${v} is available.`,
    download: 'Download'
  },
  common: {
    loading: 'Loading',
    cancel: 'Cancel',
    retry: 'Retry',
    open: 'Open',
    remove: 'Remove',
    dismiss: 'Dismiss',
    keep: 'Keep',
    repair: 'Repair',
    change: 'Change',
    copy: 'Click to Copy',
    copied: 'Copied',
    newer: 'Pre-Release',
    latest: 'Latest',
    installed: 'Installed',
    notReleased: 'Not Released Yet',
    game: 'Game',
    version: 'Version',
    readOnly: 'This folder is read-only for your account.',
    showIn: (platform: Platform) => `Show in ${fileManager(platform)}`
  },
  window: { minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close' },
  strip: { add: 'Add a Game Folder', missing: (label: string) => `${label} is not installed on this PC` },
  empty: {
    title: 'No Game for Spoken Found',
    text: (platform: Platform) =>
      `Spoken runs on WoW: Forever, Classic Era and Anniversary. Add the folder your game is installed in: ${gameFolderExample(platform)}, a ${FLAVOR_FOLDER_LIST} folder, or an AddOns folder.`,
    add: 'Add Game Folder',
    scan: 'Scan Again',
    scanning: 'Looking'
  },
  home: {
    title: 'My Games',
    sort: 'Sort By',
    sortInstalled: 'Installed First',
    sortName: 'Name',
    filters: 'Show',
    filterAll: 'All',
    filterWith: 'With Spoken',
    filterWithout: 'Without Spoken',
    noMatch: 'No game matches this filter.',
    notInstalled: 'Not installed on this PC',
    addFolder: 'Add Folder',
    whatsNew: "What's New",
    readAll: 'Read All',
    noVoice: 'No Voice Packs',
    voicePacks: (n: number) => `${n} Voice Pack${n === 1 ? '' : 's'}`,
    packUpdates: (n: number) => `${n} Voice Pack Update${n === 1 ? '' : 's'}`,
    installSpoken: 'Install Spoken',
    update: 'Update',
    manage: 'Manage',
    voicePacksButton: 'Voice Packs',
    openSpoken: (label: string) => `Open Spoken for ${label}`
  },
  status: {
    upToDate: (v: string) => `Spoken ${v} · up to date`,
    updateAvailable: (from: string, to: string) => `Update available: ${from} → ${to}`,
    notInstalled: 'Spoken not installed',
    linked: 'Linked to a development folder',
    ahead: (v: string) => `Spoken ${v} · newer than the last release`,
    unknown: (v?: string) => (v ? `Spoken ${v} · installed by hand` : 'Spoken installed by hand')
  },
  spoken: {
    title: 'Spoken',
    channel: 'Version',
    install: 'Install',
    installVersion: (_v: string) => 'Install',
    updateTo: (_v: string) => 'Update',
    reinstall: 'Reinstall',
    linkedButton: 'Linked',
    noRelease: 'No release found',
    moreActions: 'More Actions',
    openAddOns: 'Open AddOns Folder',
    repair: 'Repair',
    removeItem: 'Remove Spoken',
    github: 'View on GitHub',
    confirmRemove: (label: string) => `Remove Spoken from ${label}? Your settings and saved data are not touched.`,
    addOnsPath: 'AddOns Folder',
    tabModules: 'Modules',
    tabChangelog: 'Changelog',
    installedState: 'Installed',
    missing: 'Missing',
    linkedState: 'Linked',
    noNotes: 'No notes for this release.',
    noReleases: 'No releases to show yet. Refresh when you are online.',
    prerelease: 'Pre-Release'
  },
  modules: [
    { folder: 'Spoken', title: 'Spoken', text: 'The core: the narrator, the queue and the settings window.' },
    { folder: 'Spoken_Quests', alt: 'Spoken_Conversations', title: 'Quests and Gossip', text: 'Reads quest text and what NPCs say when you talk to them.' },
    { folder: 'Spoken_Places', title: 'Places', text: 'Tells the story of a zone, dungeon or area as you enter it.' },
    { folder: 'Spoken_Readables', title: 'Readables', text: 'Reads books, letters and notes when you open them.' },
    { folder: 'Spoken_Bosses', alt: 'Spoken_NPCs', title: 'Bosses', text: 'Tells the story of each dungeon and raid boss when it falls.' },
    { folder: 'SpokenContributions', title: 'Contributions', text: 'Lets you send in missing lines and recordings.' }
  ],
  voices: {
    title: 'Voice Packs',
    languages: 'Voice Language',
    sections: {
      quests: { title: 'Quests', text: 'Every quest, spoken as you read it, and the gossip of the people who give them.' },
      places: { title: 'Places', text: 'The story of each zone, dungeon and place, told as you arrive.' },
      readables: { title: 'Readables', text: 'Books, letters and notes read aloud when you open them.' },
      bosses: { title: 'Bosses', text: 'The story of each dungeon and raid boss, told when it falls.' }
    } satisfies Record<Section, { title: string; text: string }>,
    packNames: { all: 'All Quests', alliance: 'Alliance', horde: 'Horde', shared: 'Shared', gossip: 'Gossip' },
    splitHint: 'Or Only Part of It',
    notInstalled: 'Not Installed',
    installedVersion: (v: string) => `Installed ${v}`,
    badge: { installed: 'Installed', update: 'Update Available', linked: 'Linked', ahead: 'Newer Than Release', unknown: 'Installed by Hand' },
    install: 'Install',
    update: 'Update',
    withSpoken: (action: string) => `${action} Spoken and Pack`,
    confirmRemove: 'Remove this pack?',
    installAll: (_lang: string) => 'Install All',
    allInstalled: (_lang: string) => 'All Installed',
    confirmAll: (n: number, size: string, lang: string) =>
      `Install ${n} pack${n === 1 ? '' : 's'} in ${lang}? About ${size} to download.`,
    confirmInstall: 'Install',
    nothingReleased: 'No voice packs have been released yet.'
  },
  community: {
    title: 'Community Voice Packs',
    intro: 'Voice packs that players made.',
    needsNewer: 'Needs a newer Spoken to play these.',
    notice: "Packs from the community are not made or checked by Spoken's authors. A pack carries code that runs in the game. Install only from authors you trust.",
    share: 'Share Your Pack',
    language: 'Language',
    section: 'Section',
    allLanguages: 'All Languages',
    allSections: 'All',
    search: 'Search by Title or Author',
    searchLabel: 'Search',
    by: (author: string) => `by ${author}`,
    authorPage: "Author's Page",
    authorPageLabel: (author: string) => `${author}'s page`,
    licenseUnknown: 'License Not Stated',
    installedVersion: (v: string) => `Installed ${v}`,
    noMatch: 'No pack matches these filters.',
    clear: 'Clear Filters',
    emptyTitle: 'No community packs yet.',
    emptyText: 'Be the first.',
    offline: "Can't reach GitHub. Showing the last list we had.",
    errorTitle: "Can't load the list of community packs.",
    errorText: 'Check your connection and try again.',
    unreadable: 'The list of community packs could not be read.',
    count: (shown: number, all: number) => (shown === all ? `${all} Pack${all === 1 ? '' : 's'}` : `${shown} of ${all} Packs`)
  },
  jobs: {
    queued: 'Waiting',
    downloading: (pct: number) => `Downloading ${pct}%`,
    downloadingUnknown: 'Downloading',
    verifying: 'Verifying',
    extracting: 'Extracting',
    installing: 'Installing',
    removing: 'Removing',
    done: 'Done',
    cancelled: 'Cancelled',
    error: 'Something went wrong'
  },
  sharingPrompt: {
    title: 'Help Voice More of the Game',
    text: 'Automatically send the lines Spoken had no voice for?',
    note: 'You can change this in Settings.',
    no: 'No Thanks',
    yes: 'Send Automatically'
  },
  settings: {
    title: 'Settings',
    installLocation: 'Install Location',
    collapseAll: 'Collapse All',
    expandAll: 'Expand All',
    folders: 'Game Folders',
    foldersText: 'The manager installs into the AddOns folder of each game listed here.',
    auto: 'Auto',
    manual: 'Manual',
    noFolders: 'No game folders yet.',
    updates: 'Updates',
    prereleases: 'Include Pre-Releases',
    prereleasesText: 'Offer alpha and beta versions of Spoken and the voice packs.',
    checkOnStart: 'Check for Updates When the Manager Starts',
    checkOnStartText: 'Looks at GitHub for new releases each time you open the manager.',
    autoUpdate: 'Keep the Manager Up to Date',
    autoUpdateText: 'Downloads a new manager in the background and uses it after a restart.',
    downloads: 'Downloads',
    clearDownloads: 'Clear Downloaded Files',
    cleared: (files: number, size: string) => `Deleted ${files} file${files === 1 ? '' : 's'}, ${size}`,
    clearedNone: 'There are no downloaded files to delete.',
    checkUpdate: 'Check for Manager Updates',
    updateChecking: 'Checking for a new manager',
    updateCurrent: 'The manager is up to date.',
    updateAvailable: (v: string) => `Manager ${v} is available.`,
    downloadsFolder: 'Download Folder',
    appFolder: 'App Folder',
    useDefault: 'Use the App Folder',
    keepZips: 'Keep Downloaded Zip Files After Installing',
    keepZipsText: 'Saves a copy of each pack, so a reinstall does not download it again. Packs are large.',
    sharing: 'Sharing',
    sharingSwitch: 'Send What Spoken Collects',
    sharingText: 'Sent to spoken.rusty.one after each logout, with your pack versions and a random id. Nothing about your account.',
    lastSent: (count: number, when: string) => `Last sent: ${count} line${count === 1 ? '' : 's'}, ${when}`,
    neverSent: 'Nothing sent yet.',
    sending: 'Sending',
    sendNow: 'Send Now',
    resetId: 'Reset Id',
    resetDone: 'This manager has a new id. Lines already sent are not sent again.',
    about: 'About',
    disclaimer: 'World of Warcraft and its logos and artwork are trademarks and works of Blizzard Entertainment. Spoken is a fan project and is not affiliated with or endorsed by Blizzard Entertainment.',
    version: 'Manager Version',
    dataPath: 'Data Folder',
    openLogs: 'Open Log Folder',
    repository: 'GitHub Repository',
    site: 'Project Site'
  }
}
