const GAMES = [
  {
    flavor: "forever",
    name: "WoW: Forever",
    version: "1.60.1.70450",
    pos: "34% 30%",
    filter: "brightness(0.55) saturate(0.8)",
    art: "/landing/hero.jpg",
    logo: "/landing/games/logo-forever.png",
    icon: "/landing/games/icon-forever.png",
    status: { tone: "warn", text: "Update available: 3.4.0 → 3.5.0" },
    flags: ["3 Voice Packs"],
    tags: ["DE"],
    note: "2 Voice Pack Updates",
    primary: "Update",
  },
  {
    flavor: "era",
    name: "WoW: Classic Era",
    version: "1.15.8.65301",
    pos: "12% 22%",
    filter: "brightness(0.85)",
    art: "/landing/art-era.jpg",
    logo: "/landing/games/logo-era.png",
    icon: "/landing/games/icon-era.png",
    status: { tone: "ok", text: "Spoken 3.5.0 · up to date" },
    flags: ["No Voice Packs"],
    tags: [],
    primary: "Manage",
  },
] as const;

/**
 * The Spoken Manager's Home page as the app draws it: its tokens, its game cards with the key
 * art and logo, its strip of installed games. Fills and shadows only, no borders.
 */
export default function ManagerWindow() {
  return (
    <div className="bn-app" role="img" aria-label="The Spoken Manager window, listing two installed games with their Spoken status">
      <div aria-hidden="true">
        <div className="bn-app-bar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="bn-app-logo" src="/landing/icons/spoken-192.png" alt="" />
          <span className="bn-app-tab on">Home</span>
          <span className="bn-app-tab">Spoken</span>
          <span className="bn-app-tab">Voice Packs</span>
          <span className="bn-app-tab">Community</span>
          <span className="bn-app-end">
            v0.1.0<b>SETTINGS</b>
          </span>
        </div>
        <div className="bn-app-strip">
          <small>My Games</small>
          {GAMES.map((game, index) => (
            <span key={game.flavor} className={index === 0 ? "on" : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={game.icon} alt="" />
            </span>
          ))}
        </div>
        <div className="bn-app-body">
          <h4>My Games</h4>
          <div className="bn-games">
            {GAMES.map((game) => (
              <article key={game.flavor} className="bn-app-game">
                <div className="bn-app-art">
                  <i style={{ backgroundImage: `url(${game.art})`, backgroundPosition: game.pos, filter: game.filter }} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={game.logo} alt="" />
                </div>
                <div className="bn-app-card">
                  <p className="bn-app-eyebrow">Game Version {game.version}</p>
                  <h5>{game.name}</h5>
                  <p className={`bn-app-status ${game.status.tone}`}>{game.status.text}</p>
                  <div className={`bn-app-flags${game.tags.length === 0 ? " dim" : ""}`}>
                    {game.flags[0]}
                    {game.tags.map((tag) => (
                      <span key={tag} className="bn-app-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {"note" in game && <p className="bn-app-status warn">{game.note}</p>}
                  <div className="bn-app-actions">
                    <span className={`bn-app-btn${game.primary === "Manage" ? "" : " blue"}`}>{game.primary}</span>
                    <span className="bn-app-btn">Voice Packs</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="bn-app-news">
            <div className="bn-app-news-art">
              <i style={{ backgroundImage: "url(/landing/hero.jpg)", backgroundPosition: "34% 30%", filter: "brightness(0.55) saturate(0.8)" }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/games/logo-forever.png" alt="" />
            </div>
            <div className="bn-app-news-body">
              <p className="bn-app-eyebrow">What&apos;s New</p>
              <h5>Release notes</h5>
              <p>What changed in each version shows here, so you can read it before you press Update.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
