// Words the main process puts in front of the player: the errors it throws, and the few messages
// that ride on a job. The window's own words are in renderer/strings.*; these are the ones built
// here, where a failure happens, and they reach the window through `job.message` and an IPC
// rejection's message.
//
// The language is one module-level value, set when the settings load or change, the same way the
// window keeps its own. Nothing has to thread a language through the installer, the downloader or
// the guards, which take no settings at all.
//
// English is the source and the default, so a failure built before any setting was read -- and
// every test that asserts a message -- reads as it always did.
import { DEFAULT_SETTINGS, bcp47Of, type UiLanguage } from '../shared/types'

type Params = Record<string, string | number>

/** `{name}` is filled from `params`; anything else is left alone. */
function fill(text: string, params?: Params): string {
  return params ? text.replace(/\{(\w+)\}/g, (all, key: string) => (key in params ? String(params[key]) : all)) : text
}

const EN = {
  // errors.ts
  'errors.cancelled': 'Cancelled.',
  'errors.failed': 'Something went wrong: {text}',

  // jobs.ts
  'jobs.waiting': 'Waiting for another job on this game',

  // games.ts
  'games.chooseFirst': 'Choose a folder first.',
  'games.notThere': 'That folder does not exist.',
  'games.notWow':
    'This does not look like a World of Warcraft folder. Choose the game folder (the one that holds {flavors}), one of those folders, or its {addOns} folder.',
  'games.betaEnded': '{folder} is the WoW: Forever beta, which has ended. Spoken runs on the released game in _forever_.',
  'games.notSupported': 'Spoken runs on WoW: Forever, Classic Era and Anniversary. {folder} is not one of them.',
  'games.addFailed': 'That folder could not be added.',

  // guard.ts
  'guard.linked': 'This folder is linked to a development checkout. The manager will not change it.',
  'guard.noSpace': 'Not enough free space on {drive} for {what}: about {needed} needed, {free} free.',
  'guard.dlBadName': 'That is not a usable folder name for downloads.',
  'guard.dlNetwork': 'Network folders (\\\\server\\share) cannot be used for downloads. Choose a folder on a local drive.',
  'guard.dlFullWin': 'Choose a full folder path for downloads, such as D:\\Downloads.',
  'guard.dlFullUnix': 'Choose a full folder path for downloads, such as /home/you/Downloads.',
  'guard.dlInGame': "Downloads cannot be kept inside a game's AddOns or WTF folder.",
  'guard.dlIsFile': 'That path is a file, not a folder.',
  'guard.dlFileInWay': 'That folder cannot be created: a file is in the way.',
  'guard.dlNoWrite': 'The manager cannot write to that folder.',
  'guard.dlNoDrive': 'That drive does not exist.',

  // download.ts
  'download.mismatch':
    'The downloaded file does not match what {source} published, so it was deleted. Try again; if it keeps happening, check your connection.',
  'download.stopped': 'The download stopped before it finished ({why}). The part that arrived is kept; press the button again to continue.',
  'download.gone': '{source} no longer has this file. Refresh the list and try again.',
  'download.refused': '{source} refused the download ({status}).',

  // install.ts
  'install.damaged': 'The downloaded zip file is damaged or holds unsafe paths, so nothing was installed.',
  'install.rollbackCancelled':
    'Cancelled, but the manager could not put back {failed}. The previous version is in {backupDir}. Copy it back into the AddOns folder before installing again.',
  'install.rollbackFailed':
    'Something went wrong, and the manager could not put back {failed}. The previous version is in {backupDir}. Copy it back into the AddOns folder before installing again.',
  'install.undoFailed':
    "An earlier change to this game's add-ons could not be undone ({failed}). The previous version is in {where}. Copy it back into the AddOns folder, then try again.",
  'install.tooManyEntries':
    'The zip holds more than {entries} files, more than a pack of this kind may have, so nothing was installed.',
  'install.tooBig': 'The zip would unpack to more than {size}, more than a pack of this kind may take, so nothing was installed.',
  'install.outside': 'The zip holds a file or folder the manager may not install ({name}), so nothing was installed.',
  'install.wrongFolders': 'The zip file does not hold the expected folders ({missing}), so nothing was installed.',
  'install.wrongFoldersPlain': 'The zip file does not hold the folders it should, so nothing was installed.',
  'install.noSpokenFolder': 'The zip file has no Spoken folder, so nothing was installed.',
  'install.strayFolder': 'The zip holds a folder the manager may not install ({folder}), so nothing was installed.',
  'install.incomplete': 'The zip file is incomplete ({name}\\{name}.toc is missing), so nothing was installed.',
  'install.notWritable':
    'The manager cannot write to {path}. Check that the folder is not read-only and that your account may change it.',
  'install.communityNoChecksum': 'This community pack has no checksum, so the manager will not install it.',
  'install.communityBadName': 'This community pack has no valid folder name, so the manager will not install it.',
  'install.fileNotFolder': '{folder} in the AddOns folder is a file, not a folder, so it was left alone.',
  'install.nothingChanged': 'Nothing was changed: {why}.{hint}',
  'install.hintInUse':
    ' A file may be in use: close the game and anything else that has the add-on open, then try again.',

  // service.ts
  'service.channelUnreadable': 'The voice pack channel could not be read.',
  'service.needsSpoken': '{product} needs Spoken {need} or newer, which is not released yet.',
  'service.notOnServer': '{product} is not on the voice pack server right now. Press refresh and try again.',
  'service.nothingToRepair': '{product} is not installed, so there is nothing to repair. Install it instead.',
  'service.versionGoneRepair':
    'Version {version} of {product} is no longer in the list of releases, so it cannot be put back. Update it instead.',
  'service.versionUnknownRepair': 'The installed version of {product} is not known, so it cannot be put back. Update it instead.',
  'service.versionNotListed': 'Version {version} of {product} is not in the list of releases.',
  'service.noReleaseYet': 'There is no release of {product} to install yet.',
  'service.listNotLoaded': 'The list of releases has not been loaded yet. Check your connection, press refresh and try again.',
  'service.waitForJobs': 'Wait for the running downloads and installs to finish first.',
  'service.turnOnSharing': 'Turn on Sharing first.',
  'service.upToDate': 'Spoken is up to date.',

  // packs-remote.ts
  'packs.notTrusted': 'The voice pack list could not be trusted ({why}), so it was not used.',
  'packs.serverStatus': 'The voice pack server answered {status}. Try again later.',

  // contributor.ts
  'contributor.reachSite': 'Could not reach the site.',
  'contributor.reachSiteCheck': 'Could not reach the site to check your account. Try again.',
  'contributor.signInFirst': 'Sign in to the site first.',
  'contributor.noAdminFor': 'Your account does not administer {lang}.',
  'contributor.badCredentials': 'That email or password is not right.',
  'contributor.waitASecond': 'The site asked to wait. Try again in a while.',
  'contributor.siteHttp': 'The site answered HTTP {status}.',
  'contributor.noSession': 'The site did not keep you signed in.',
  'contributor.notConfirmed': 'The site did not confirm the sign-in. Try again.',
  'contributor.notOneOf': '{folder} is not one of the {lang} packs.',
  'contributor.releaseRunning': 'A release to {store} is already running. Wait for it to end or cancel it.',
  'contributor.saveToken': 'Save your {name} token under Stores first.',
  'contributor.saveRepo': 'Save your GitHub repository under Stores first.',
  'contributor.channelCheck': 'Could not check the voice pack channel, so nothing was published. Try again.',
  'contributor.stepZip': 'zipping',
  'contributor.stepUpload': 'uploading',

  // share.ts
  'share.reachSite': 'The site could not be reached ({why}).',
  'share.siteStatus': 'The site answered {status}.',

  // contributor-upload.ts
  'upload.reachStore': 'Could not reach {store}.',
  'upload.storeHttp': '{store} answered HTTP {status}{text}',
  'upload.linkInPack': '{path} is a link, which a pack cannot hold.',
  'upload.notInstalled': '{folder} is not installed.',
  'upload.cannotRead': 'Could not read {folder}.',
  'upload.cannotZip': 'Could not zip {folder}.',
  'upload.zipUnreadable': 'The zip to send could not be read.',
  'upload.cfToken': 'CurseForge did not accept that token.',
  'upload.cfVersions': "CurseForge's list of game versions could not be read.",
  'upload.cfDuplicate': 'CurseForge has {count} game versions named {name}. Change the game versions under Stores.',
  'upload.cfTooBig': "{folder} is over CurseForge's upload limit (HTTP 413).",
  'upload.repoShape': 'The GitHub repository must look like owner/repo.',
  'upload.ghToken': 'GitHub did not accept that token.',
  'upload.ghNoRepo': 'GitHub shows no repository {repo} to that token.',
  'upload.ghNoWrite': 'That token cannot push to {repo}: it needs write access.',
  'upload.ghUnfinishedNoId': 'GitHub holds an unfinished {name}, with no id to remove it by.',
  'upload.ghRemoveFailed': 'Could not remove the unfinished {name}. {answer}',
  'upload.badAnswer': "GitHub's answer could not be read.",
  'upload.noReleaseId': "GitHub's answer names no release id.",

  // contributor-store.ts
  'store.duplicateProject': '{other} and {folder} have the same CurseForge project id, {id}. Each pack needs its own project.',
  'store.cannotKeep':
    'Spoken Manager cannot keep secrets on this computer right now. If your system asked for access, allow it and try again.',
  'store.digitsOnly': 'The CurseForge project id for {lang} must be digits only.',

  // updater.ts
  'updater.installFailed': 'Could not install the update. Try again, or close the manager and open it again.',
  'updater.checkFailed': 'Could not check for a newer manager. Check your connection and try again.',
  'updater.notInstalled': 'The manager can only update itself when it is installed.',

  // index.ts, the tray menu
  'tray.show': 'Show Spoken Manager',
  'tray.quit': 'Quit Spoken Manager'
} as const

export type MessageKey = keyof typeof EN

const ZH: Record<MessageKey, string> = {
  'errors.cancelled': '已取消。',
  'errors.failed': '出了点问题：{text}',

  'jobs.waiting': '正在等待这台游戏上的另一个任务',

  'games.chooseFirst': '请先选择一个文件夹。',
  'games.notThere': '该文件夹不存在。',
  'games.notWow':
    '这看起来不是《魔兽世界》的文件夹。请选择游戏主目录（也就是包含 {flavors} 的那个），或其中某个文件夹，或它的 {addOns} 文件夹。',
  'games.betaEnded': '{folder} 是已结束的《魔兽世界》Forever 测试版。Spoken 运行在正式版的 _forever_ 中。',
  'games.notSupported': 'Spoken 可运行于《魔兽世界》正式服（Forever）、经典旧世和周年纪念版。{folder} 不在其中。',
  'games.addFailed': '无法添加该文件夹。',

  'guard.linked': '此文件夹链接到了开发用的检出目录，管理器不会改动它。',
  'guard.noSpace': '{drive} 空间不足，无法{what}：需要约 {needed}，可用 {free}。',
  'guard.dlBadName': '这不是一个可用的下载文件夹名。',
  'guard.dlNetwork': '网络文件夹（\\\\server\\share）不能用于下载。请选择本地磁盘上的文件夹。',
  'guard.dlFullWin': '请填写完整的下载文件夹路径，例如 D:\\Downloads。',
  'guard.dlFullUnix': '请填写完整的下载文件夹路径，例如 /home/you/Downloads。',
  'guard.dlInGame': '下载文件不能放在游戏的 AddOns 或 WTF 文件夹里。',
  'guard.dlIsFile': '该路径是一个文件，不是文件夹。',
  'guard.dlFileInWay': '无法创建该文件夹：有同名文件挡着。',
  'guard.dlNoWrite': '管理器无法写入该文件夹。',
  'guard.dlNoDrive': '该磁盘不存在。',

  'download.mismatch': '下载的文件与 {source} 发布的版本不符，已删除。请重试；如果反复出现，请检查网络连接。',
  'download.stopped': '下载尚未完成就中断了（{why}）。已下载的部分会保留；再点一次按钮即可继续。',
  'download.gone': '{source} 上已经没有这个文件了。请刷新列表后重试。',
  'download.refused': '{source} 拒绝了这个下载（{status}）。',

  'install.damaged': '下载的 zip 文件已损坏，或含有不安全的路径，因此没有安装任何内容。',
  'install.rollbackCancelled': '已取消，但管理器无法还原 {failed}。旧版本位于 {backupDir}，请在重新安装前把它复制回 AddOns 文件夹。',
  'install.rollbackFailed': '出了点问题，且管理器无法还原 {failed}。旧版本位于 {backupDir}，请在重新安装前把它复制回 AddOns 文件夹。',
  'install.undoFailed': '此前对该游戏插件的一处改动无法撤销（{failed}）。旧版本位于 {where}，请把它复制回 AddOns 文件夹后重试。',
  'install.tooManyEntries': '该 zip 含有多于 {entries} 个文件，超出此类语音包的上限，因此没有安装任何内容。',
  'install.tooBig': '该 zip 解压后会超过 {size}，超出此类语音包的限额，因此没有安装任何内容。',
  'install.outside': '该 zip 含有管理器不允许安装的文件或文件夹（{name}），因此没有安装任何内容。',
  'install.wrongFolders': '该 zip 中没有应有的文件夹（缺少 {missing}），因此没有安装任何内容。',
  'install.wrongFoldersPlain': '该 zip 中没有应有的文件夹，因此没有安装任何内容。',
  'install.noSpokenFolder': '该 zip 中没有 Spoken 文件夹，因此没有安装任何内容。',
  'install.strayFolder': '该 zip 含有管理器不允许安装的文件夹（{folder}），因此没有安装任何内容。',
  'install.incomplete': '该 zip 不完整（缺少 {name}\\{name}.toc），因此没有安装任何内容。',
  'install.notWritable': '管理器无法写入 {path}。请确认该文件夹不是只读的，且你的账户有修改权限。',
  'install.communityNoChecksum': '这个社区语音包没有校验值，管理器不会安装它。',
  'install.communityBadName': '这个社区语音包没有有效的文件夹名，管理器不会安装它。',
  'install.fileNotFolder': 'AddOns 文件夹中的 {folder} 是一个文件而不是文件夹，已保持原样。',
  'install.nothingChanged': '没有任何改动：{why}。{hint}',
  'install.hintInUse': ' 可能有文件正被占用：请关闭游戏以及其它正在使用该插件的程序，然后重试。',

  'service.channelUnreadable': '无法读取语音包频道。',
  'service.needsSpoken': '{product} 需要 {need} 或更新版本的 Spoken，而该版本尚未发布。',
  'service.notOnServer': '语音包服务器上现在没有 {product}。请按刷新后重试。',
  'service.nothingToRepair': '{product} 尚未安装，没有可修复的内容。请改为安装。',
  'service.versionGoneRepair': '{product} 的 {version} 版已不在发布列表中，因此无法还原。请改为更新。',
  'service.versionUnknownRepair': '不知道 {product} 已安装的版本，因此无法还原。请改为更新。',
  'service.versionNotListed': '{product} 的 {version} 版不在发布列表中。',
  'service.noReleaseYet': '{product} 还没有可安装的发布版。',
  'service.listNotLoaded': '发布列表尚未加载。请检查网络连接，按刷新后重试。',
  'service.waitForJobs': '请先等待正在进行的下载和安装结束。',
  'service.turnOnSharing': '请先开启共享。',
  'service.upToDate': 'Spoken 已是最新。',

  'packs.notTrusted': '无法信任语音包列表（{why}），因此未使用它。',
  'packs.serverStatus': '语音包服务器返回 {status}。请稍后重试。',

  'contributor.reachSite': '无法连接网站。',
  'contributor.reachSiteCheck': '无法连接网站来核验你的账户。请重试。',
  'contributor.signInFirst': '请先登录网站。',
  'contributor.noAdminFor': '你的账户不管理 {lang}。',
  'contributor.badCredentials': '邮箱或密码不正确。',
  'contributor.waitASecond': '网站要求稍后再试。请过一会儿再试。',
  'contributor.siteHttp': '网站返回 HTTP {status}。',
  'contributor.noSession': '网站没能保持你的登录状态。',
  'contributor.notConfirmed': '网站未能确认本次登录。请重试。',
  'contributor.notOneOf': '{folder} 不属于 {lang} 的语音包。',
  'contributor.releaseRunning': '已有一个发往 {store} 的发布正在进行。请等待它结束或取消它。',
  'contributor.saveToken': '请先在“商店”中保存你的 {name} 令牌。',
  'contributor.saveRepo': '请先在“商店”中保存你的 GitHub 仓库。',
  'contributor.channelCheck': '无法检查语音包频道，因此没有发布任何内容。请重试。',
  'contributor.stepZip': '正在压缩',
  'contributor.stepUpload': '正在上传',

  'share.reachSite': '无法连接网站（{why}）。',
  'share.siteStatus': '网站返回 {status}。',

  'upload.reachStore': '无法连接 {store}。',
  'upload.storeHttp': '{store} 返回 HTTP {status}{text}',
  'upload.linkInPack': '{path} 是一个链接，语音包不能包含链接。',
  'upload.notInstalled': '{folder} 未安装。',
  'upload.cannotRead': '无法读取 {folder}。',
  'upload.cannotZip': '无法压缩 {folder}。',
  'upload.zipUnreadable': '无法读取要发送的 zip 文件。',
  'upload.cfToken': 'CurseForge 不接受该令牌。',
  'upload.cfVersions': '无法读取 CurseForge 的游戏版本列表。',
  'upload.cfDuplicate': 'CurseForge 上有 {count} 个名为 {name} 的游戏版本。请在“商店”中更改游戏版本。',
  'upload.cfTooBig': '{folder} 超出了 CurseForge 的上传上限（HTTP 413）。',
  'upload.repoShape': 'GitHub 仓库应形如 owner/repo。',
  'upload.ghToken': 'GitHub 不接受该令牌。',
  'upload.ghNoRepo': '该令牌看不到仓库 {repo}。',
  'upload.ghNoWrite': '该令牌无法推送到 {repo}：需要写入权限。',
  'upload.ghUnfinishedNoId': 'GitHub 上有一个未完成的 {name}，但它的 id 缺失，无法删除。',
  'upload.ghRemoveFailed': '无法删除未完成的 {name}。{answer}',
  'upload.badAnswer': '无法读取 GitHub 的响应。',
  'upload.noReleaseId': 'GitHub 的响应中没有发布 id。',

  'store.duplicateProject': '{other} 和 {folder} 使用了同一个 CurseForge 项目 id：{id}。每个语音包需要各自的项目。',
  'store.cannotKeep': 'Spoken 管理器目前无法在此电脑上保存密钥。如果你的系统询问了访问权限，请允许后重试。',
  'store.digitsOnly': '{lang} 的 CurseForge 项目 id 只能包含数字。',

  'updater.installFailed': '无法安装更新。请重试，或关闭管理器后重新打开。',
  'updater.checkFailed': '无法检查是否有新的管理器版本。请检查网络连接后重试。',
  'updater.notInstalled': '管理器只有在安装后才能真正自我更新。',

  'tray.show': '显示 Spoken 管理器',
  'tray.quit': '退出 Spoken 管理器'
}

const MESSAGES: Record<UiLanguage, Record<MessageKey, string>> = { enUS: EN as Record<MessageKey, string>, zhCN: ZH }

let current: UiLanguage = DEFAULT_SETTINGS.uiLanguage

/** Set when the settings load or change. A language with no dictionary leaves English in place. */
export function setMainLanguage(lang: UiLanguage): void {
  if (MESSAGES[lang]) current = lang
}

/** The tag `Intl` wants, for the numbers and dates this process writes into a message. */
export function mainLocale(): string {
  return bcp47Of(current)
}

export function mainLanguage(): UiLanguage {
  return current
}

/** The words for `key`, with `{name}` filled from `params`. */
export function t(key: MessageKey, params?: Params): string {
  return fill((MESSAGES[current] ?? EN)[key] ?? EN[key], params)
}
