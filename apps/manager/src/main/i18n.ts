// Words the main process puts in front of the player: the errors it throws and the messages a job
// carries. The language is one module-level value set from the settings, so the installer, the
// downloader and the guards need no settings passed in. English is the default.
import { DEFAULT_SETTINGS, bcp47Of, type UiLanguage } from '../shared/types'

type Params = Record<string, string | number>

/** `{name}` is filled from `params`; anything else is left alone. */
function fill(text: string, params?: Params): string {
  return params ? text.replace(/\{(\w+)\}/g, (all, key: string) => (key in params ? String(params[key]) : all)) : text
}

const EN = {
  'errors.cancelled': 'Cancelled.',
  'errors.failed': 'Something went wrong: {text}',

  'jobs.waiting': 'Waiting for another job on this game',

  'games.chooseFirst': 'Choose a folder first.',
  'games.notThere': 'That folder does not exist.',
  'games.notWow':
    'This does not look like a World of Warcraft folder. Choose the game folder (the one that holds {flavors}), one of those folders, or its {addOns} folder.',
  'games.betaEnded': '{folder} is the WoW: Forever beta, which has ended. Spoken runs on the released game in _forever_.',
  'games.notSupported': 'Spoken runs on WoW: Forever, Classic Era and Anniversary. {folder} is not one of them.',
  'games.addFailed': 'That folder could not be added.',

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

  'download.mismatch':
    'The downloaded file does not match what {source} published, so it was deleted. Try again; if it keeps happening, check your connection.',
  'download.stopped': 'The download stopped before it finished ({why}). The part that arrived is kept; press the button again to continue.',
  'download.gone': '{source} no longer has this file. Refresh the list and try again.',
  'download.refused': '{source} refused the download ({status}).',

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

  'proxy.invalid': 'That is not a proxy the manager can use. Write it as http://127.0.0.1:8080 or socks5://127.0.0.1:10808.',

  'packs.notTrusted': 'The voice pack list could not be trusted ({why}), so it was not used.',
  'packs.serverStatus': 'The voice pack server answered {status}. Try again later.',

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
  'contributor.zipRunning': '{folder} is being zipped already.',
  'contributor.stepUpload': 'uploading',

  'share.reachSite': 'The site could not be reached ({why}).',
  'share.siteStatus': 'The site answered {status}.',

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
  'upload.cfTooBig': "{folder} is over the 500 MB CurseForge takes through its API (HTTP 413). Press Zip on its row and upload the zip on CurseForge's site, which takes up to 1 GB.",
  'upload.repoShape': 'The GitHub repository must look like owner/repo.',
  'upload.ghToken': 'GitHub did not accept that token.',
  'upload.ghNoRepo': 'GitHub shows no repository {repo} to that token.',
  'upload.ghNoWrite': 'That token cannot push to {repo}: it needs write access.',
  'upload.ghUnfinishedNoId': 'GitHub holds an unfinished {name}, with no id to remove it by.',
  'upload.ghRemoveFailed': 'Could not remove the unfinished {name}. {answer}',
  'upload.badAnswer': "GitHub's answer could not be read.",
  'upload.noReleaseId': "GitHub's answer names no release id.",

  'store.duplicateProject': '{other} and {folder} have the same CurseForge project id, {id}. Each pack needs its own project.',
  'store.cannotKeep':
    'Spoken Manager cannot keep secrets on this computer right now. If your system asked for access, allow it and try again.',
  'store.digitsOnly': 'The CurseForge project id for {lang} must be digits only.',

  'updater.installFailed': 'Could not install the update. Try again, or close the manager and open it again.',
  'updater.checkFailed': 'Could not check for a newer manager. Check your connection and try again.',
  'updater.notInstalled': 'The manager can only update itself when it is installed.',

  'tray.show': 'Show Spoken Manager',
  'tray.quit': 'Quit Spoken Manager'
}

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

  'proxy.invalid': '管理器无法使用这个代理。请写成 http://127.0.0.1:8080 或 socks5://127.0.0.1:10808。',

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
  'contributor.zipRunning': '{folder} 正在压缩中。',
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
  'upload.cfTooBig': '{folder} 超出了 CurseForge API 的 500 MB 上限（HTTP 413）。请在该行点击“压缩”，然后在 CurseForge 网站上传该 zip，网站上限为 1 GB。',
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

// The window has the complete dictionaries; these maps cover the main-process messages that can
// be thrown while a language is being changed. Rare diagnostic wording inherits English until it
// is needed by a translated workflow.
const DE: Partial<Record<MessageKey, string>> = {
  'errors.cancelled': 'Abgebrochen.', 'errors.failed': 'Etwas ist schiefgelaufen: {text}', 'jobs.waiting': 'Warte auf einen anderen Vorgang für dieses Spiel',
  'games.chooseFirst': 'Wähle zuerst einen Ordner.', 'games.notThere': 'Dieser Ordner existiert nicht.', 'games.addFailed': 'Der Ordner konnte nicht hinzugefügt werden.',
  'service.upToDate': 'Spoken ist aktuell.', 'service.waitForJobs': 'Warte zuerst, bis laufende Downloads und Installationen beendet sind.', 'service.turnOnSharing': 'Aktiviere zuerst das Teilen.',
  'contributor.reachSite': 'Die Website ist nicht erreichbar.', 'contributor.signInFirst': 'Melde dich zuerst auf der Website an.', 'contributor.badCredentials': 'E-Mail oder Passwort ist falsch.',
  'upload.reachStore': 'Verbindung zu {store} nicht möglich.', 'upload.notInstalled': '{folder} ist nicht installiert.', 'upload.cannotRead': '{folder} konnte nicht gelesen werden.',
  'updater.installFailed': 'Das Update konnte nicht installiert werden. Versuche es erneut oder schließe den Manager und öffne ihn wieder.', 'updater.checkFailed': 'Es konnte nicht nach einem neuen Manager gesucht werden. Prüfe deine Verbindung.', 'tray.show': 'Spoken Manager anzeigen', 'tray.quit': 'Spoken Manager beenden'
}
const ES: Partial<Record<MessageKey, string>> = {
  'errors.cancelled': 'Cancelado.', 'errors.failed': 'Algo salió mal: {text}', 'jobs.waiting': 'Esperando otra tarea en este juego',
  'games.chooseFirst': 'Elige primero una carpeta.', 'games.notThere': 'Esa carpeta no existe.', 'games.addFailed': 'No se pudo añadir esa carpeta.',
  'service.upToDate': 'Spoken está actualizado.', 'service.waitForJobs': 'Espera a que terminen las descargas e instalaciones en curso.', 'service.turnOnSharing': 'Activa primero Compartir.',
  'contributor.reachSite': 'No se pudo acceder al sitio.', 'contributor.signInFirst': 'Inicia sesión primero en el sitio.', 'contributor.badCredentials': 'El correo o la contraseña no son correctos.',
  'upload.reachStore': 'No se pudo acceder a {store}.', 'upload.notInstalled': '{folder} no está instalado.', 'upload.cannotRead': 'No se pudo leer {folder}.',
  'updater.installFailed': 'No se pudo instalar la actualización. Inténtalo de nuevo o cierra y vuelve a abrir el administrador.', 'updater.checkFailed': 'No se pudo buscar un administrador nuevo. Comprueba tu conexión.', 'tray.show': 'Mostrar Spoken Manager', 'tray.quit': 'Salir de Spoken Manager'
}
const FR: Partial<Record<MessageKey, string>> = {
  'errors.cancelled': 'Annulé.', 'errors.failed': 'Une erreur est survenue : {text}', 'jobs.waiting': 'En attente d’une autre tâche pour ce jeu',
  'games.chooseFirst': 'Choisis d’abord un dossier.', 'games.notThere': 'Ce dossier n’existe pas.', 'games.addFailed': 'Impossible d’ajouter ce dossier.',
  'service.upToDate': 'Spoken est à jour.', 'service.waitForJobs': 'Attends la fin des téléchargements et installations en cours.', 'service.turnOnSharing': 'Active d’abord le partage.',
  'contributor.reachSite': 'Impossible de joindre le site.', 'contributor.signInFirst': 'Connecte-toi d’abord au site.', 'contributor.badCredentials': 'Cet e-mail ou ce mot de passe est incorrect.',
  'upload.reachStore': 'Impossible de joindre {store}.', 'upload.notInstalled': '{folder} n’est pas installé.', 'upload.cannotRead': 'Impossible de lire {folder}.',
  'updater.installFailed': 'Impossible d’installer la mise à jour. Réessaie ou ferme puis rouvre le Manager.', 'updater.checkFailed': 'Impossible de rechercher un nouveau Manager. Vérifie ta connexion.', 'tray.show': 'Afficher Spoken Manager', 'tray.quit': 'Quitter Spoken Manager'
}
const KO: Partial<Record<MessageKey, string>> = {
  'errors.cancelled': '취소됨.', 'errors.failed': '문제가 발생했습니다: {text}', 'jobs.waiting': '이 게임의 다른 작업을 기다리는 중',
  'games.chooseFirst': '먼저 폴더를 선택하세요.', 'games.notThere': '폴더가 존재하지 않습니다.', 'games.addFailed': '폴더를 추가할 수 없습니다.',
  'service.upToDate': 'Spoken이 최신 상태입니다.', 'service.waitForJobs': '진행 중인 다운로드와 설치가 끝날 때까지 기다리세요.', 'service.turnOnSharing': '먼저 공유를 켜세요.',
  'contributor.reachSite': '사이트에 연결할 수 없습니다.', 'contributor.signInFirst': '먼저 사이트에 로그인하세요.', 'contributor.badCredentials': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'upload.reachStore': '{store}에 연결할 수 없습니다.', 'upload.notInstalled': '{folder}이(가) 설치되지 않았습니다.', 'upload.cannotRead': '{folder}을(를) 읽을 수 없습니다.',
  'updater.installFailed': '업데이트를 설치할 수 없습니다. 다시 시도하거나 Manager를 닫았다가 다시 여세요.', 'updater.checkFailed': '새 Manager를 확인할 수 없습니다. 연결을 확인하세요.', 'tray.show': 'Spoken Manager 표시', 'tray.quit': 'Spoken Manager 종료'
}
const PT: Partial<Record<MessageKey, string>> = {
  'errors.cancelled': 'Cancelado.', 'errors.failed': 'Algo deu errado: {text}', 'jobs.waiting': 'Aguardando outra tarefa neste jogo',
  'games.chooseFirst': 'Escolha uma pasta primeiro.', 'games.notThere': 'Essa pasta não existe.', 'games.addFailed': 'Não foi possível adicionar essa pasta.',
  'service.upToDate': 'O Spoken está atualizado.', 'service.waitForJobs': 'Aguarde o fim dos downloads e instalações em andamento.', 'service.turnOnSharing': 'Ative o compartilhamento primeiro.',
  'contributor.reachSite': 'Não foi possível acessar o site.', 'contributor.signInFirst': 'Entre primeiro no site.', 'contributor.badCredentials': 'O e-mail ou a senha não estão corretos.',
  'upload.reachStore': 'Não foi possível acessar {store}.', 'upload.notInstalled': '{folder} não está instalado.', 'upload.cannotRead': 'Não foi possível ler {folder}.',
  'updater.installFailed': 'Não foi possível instalar a atualização. Tente novamente ou feche e abra o Manager.', 'updater.checkFailed': 'Não foi possível verificar um novo Manager. Verifique sua conexão.', 'tray.show': 'Mostrar Spoken Manager', 'tray.quit': 'Sair do Spoken Manager'
}
const RU: Partial<Record<MessageKey, string>> = {
  'errors.cancelled': 'Отменено.', 'errors.failed': 'Что-то пошло не так: {text}', 'jobs.waiting': 'Ожидание другой задачи для этой игры',
  'games.chooseFirst': 'Сначала выберите папку.', 'games.notThere': 'Этой папки не существует.', 'games.addFailed': 'Не удалось добавить папку.',
  'service.upToDate': 'Spoken обновлён.', 'service.waitForJobs': 'Сначала дождитесь завершения загрузок и установок.', 'service.turnOnSharing': 'Сначала включите общий доступ.',
  'contributor.reachSite': 'Не удалось связаться с сайтом.', 'contributor.signInFirst': 'Сначала войдите на сайт.', 'contributor.badCredentials': 'Неверный адрес электронной почты или пароль.',
  'upload.reachStore': 'Не удалось связаться с {store}.', 'upload.notInstalled': '{folder} не установлен.', 'upload.cannotRead': 'Не удалось прочитать {folder}.',
  'updater.installFailed': 'Не удалось установить обновление. Повторите попытку или закройте и снова откройте менеджер.', 'updater.checkFailed': 'Не удалось проверить наличие нового менеджера. Проверьте подключение.', 'tray.show': 'Показать Spoken Manager', 'tray.quit': 'Выйти из Spoken Manager'
}
const ZH_TW: Partial<Record<MessageKey, string>> = {
  'errors.cancelled': '已取消。', 'errors.failed': '發生問題：{text}', 'jobs.waiting': '正在等待這個遊戲的其他作業',
  'games.chooseFirst': '請先選擇資料夾。', 'games.notThere': '這個資料夾不存在。', 'games.addFailed': '無法加入這個資料夾。',
  'service.upToDate': 'Spoken 已是最新。', 'service.waitForJobs': '請先等待目前的下載與安裝完成。', 'service.turnOnSharing': '請先開啟分享。',
  'contributor.reachSite': '無法連線到網站。', 'contributor.signInFirst': '請先登入網站。', 'contributor.badCredentials': '電子郵件或密碼不正確。',
  'upload.reachStore': '無法連線到 {store}。', 'upload.notInstalled': '{folder} 尚未安裝。', 'upload.cannotRead': '無法讀取 {folder}。',
  'updater.installFailed': '無法安裝更新。請重試，或關閉管理器後重新開啟。', 'updater.checkFailed': '無法檢查新的管理器。請檢查連線。', 'tray.show': '顯示 Spoken 管理器', 'tray.quit': '退出 Spoken 管理器'
}

const MESSAGES: Record<UiLanguage, Record<MessageKey, string>> = {
  enUS: EN,
  deDE: { ...EN, ...DE },
  esES: { ...EN, ...ES },
  frFR: { ...EN, ...FR },
  koKR: { ...EN, ...KO },
  ptBR: { ...EN, ...PT },
  ruRU: { ...EN, ...RU },
  zhCN: ZH,
  zhTW: { ...EN, ...ZH_TW }
}

let current: UiLanguage = DEFAULT_SETTINGS.uiLanguage

export function setMainLanguage(lang: UiLanguage): void {
  current = lang
}

export function mainLocale(): string {
  return bcp47Of(current)
}

export function t(key: MessageKey, params?: Params): string {
  return fill(MESSAGES[current][key], params)
}
