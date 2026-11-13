# Caption checks

From the repository root:

```sh
luajit tests/captions/verify.lua
```

Lua 5.1 also works. This suite runs as part of `make test-player`.

The suite loads the real queue, both player layouts, actions, captions and
quest adapter. `fixture.lua` supplies WoW widgets with explicit methods and
simple font measurements. Missing methods fail the test.

Checks cover playback timing, pause and restart, two-word highlighting,
page boundaries, one/two-line layout, Unicode, long words, settings, hidden
modes, queue placement and switching player layouts. Native portrait rendering
is covered by `tests/minimal-classic`; live audio and appearance still need
an in-game check.
