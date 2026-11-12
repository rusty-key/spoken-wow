# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Admin.** The project owner. Runs voice generation, cuts releases and moderates everything that
  reaches players.
- **Language teams.** Volunteers who maintain the text and voice lines of one language. Per-language
  grants decide what each of them may do.
- **Players and contributors.** They send text reports and contributions, often from the Spoken
  Manager desktop app.
- **Community voice pack authors.** Volunteers who publish their own voice packs. The zip is hosted
  on their GitHub releases, and every new pack or version waits for the admin's approval.

## Product Purpose

spoken.quest is the web workspace behind Spoken, the World of Warcraft addon that voices quests,
places, readables and bosses in many languages. Its purpose is to make every quest playable with
voice in the player's own language, with quality kept by review. Nothing ships to players without
the admin's approval.

## Operating Context

- The site is a working tool, not a showcase: dense lists, tables and forms.
- The Spoken Manager reads its data from the site. It already signs in to it and sends contributions.
- Volunteers do the work in their spare time, so flows must be easy to resume and easy to understand
  without help.

## Capabilities and Constraints

- Next.js app router with better-auth sessions, Postgres and shadcn/Tailwind components.
- Forms are client components that call `/api` route handlers. There are no server actions.
- There are three global roles: member, pack author (may submit community packs) and admin.
  Per-language capabilities are grants.
- A community pack is a single `SpokenCommunity_<id>` folder in a zip, hosted as a GitHub release
  asset. The Manager checks its sha256 and size before it installs anything.

## Product Principles

- The admin approves everything that reaches players.
- Volunteers come first: clear status, no dead ends, and no need to ask on Discord what happened.
- The existing interface is the authority for how things look and behave.
