# Small Window portrait checks

From the repository root, with LuaJIT:

```sh
luajit tests/minimal-classic/verify.lua
```

`make test-player` runs it with the other suites.

It loads Spoken's real queue, actions and portraits against `fixture.lua`, a small WoW UI and
timer fixture, and checks whose face the Small Window shows as speakers, targets and the queue
change: native snapshots, exact-GUID matching, an unmet quest giver drawn from its appearance and
retried while uncached, the bounded cache, and the line badges. It also compiles every Lua file
Spoken ships as Lua 5.1 and checks that the `Minimal*.tga` textures are power-of-two RGBA.

The window itself (controls, title, progress, backgrounds, Bronze Border) is
`tests/lua/minimal_window_test.lua`'s. Neither proves how the client draws it; that still needs a
look in game.
