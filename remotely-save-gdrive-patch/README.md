# remotely-save-gdrive-patch

Third-party patch for the
[Remotely Save](https://github.com/remotely-save/remotely-save) Obsidian
plugin: its Google Drive backend `writeFile`/`mkdir` always `POST` a new
file instead of updating the existing one, so Drive accumulates duplicate
copies of every note on each sync.

Upstream's Google Drive backend (`pro/src/fsGoogleDrive.ts`) is
source-available in the public repo, but under the
[PolyForm Strict License 1.0.0](https://polyformproject.org/licenses/strict/1.0.0/)
- personal/noncommercial use is a permitted purpose, **redistributing or
modifying it is not**. So this patches your own compiled `main.js` in
place rather than forking the source, and stays something you run
yourself: there is no CI step or release that publishes a patched build
(see "No redistribution" below). It locates the Google Drive class body
in `main.js` and splices in a name+parent lookup, switches the upload
calls to `PATCH` on an existing file id, and trashes extra duplicate
**files** it finds along the way (folders are never trashed).

## Files

- `patch_gdrive.py` - applies the patch to a `main.js`.
  `python patch_gdrive.py <path> [--apply]`; without `--apply` it only
  reports whether every anchor matches. Pass the installed Remotely Save
  `main.js` explicitly so the patch never guesses which vault to modify.
- `build_test.py` - `python build_test.py <patched_main.js> <out.mjs>`
  extracts the patched class and writes it as a standalone ES module
  importing `test_stubs.mjs`.
- `test_stubs.mjs` - real exports for the handful of symbols the compiled
  bundle provides around the Drive class (same short names as the actual
  minified build, on purpose - the extracted class calls them directly).
- `test_runner.mjs` - `node test_runner.mjs <out.mjs>` dynamically
  imports the generated class module and runs dedup/upload checks
  against a fake Drive. No Obsidian, no real Drive account, no network.

## Anchors are pinned to a specific upstream build

Every anchor is an exact substring of the *minified* `main.js`. A new
upstream release reminifies and very likely renames the local variables
the anchors depend on (`Vp`, `kh`, `Bh`, ...), so a version bump usually
needs the anchors re-derived by hand against the new build.
`patch_gdrive.py` aborts loudly ("an anchor did not match exactly once")
instead of silently no-op'ing or writing something broken - that failure
is the signal that this file needs updating, not a bug.

## CI only verifies, it does not publish

`.github/workflows/remotely-save-gdrive-patch-ci.yml` downloads
upstream's latest `main.js`, applies the patch, and runs the generated
test - so an anchor mismatch against a new upstream release shows up
here instead of only at the next local re-patch. It triggers on pull requests,
pushes touching this directory or the workflow file, plus manual `workflow_dispatch` -
deliberately **no schedule**, since a scheduled run would just fail
loudly every time upstream ships a build the anchors do not match, with
nobody watching. Re-run it by hand after an upstream release to notice a
mismatch, or after fixing one.

**No redistribution.** The job has no write permissions and does not
create a release, tag, or artifact - the patched `main.js` it builds is
discarded with the runner. Anything that published the patched build (a
release, an artifact download, a gist) would be distributing a modified
derivative of PolyForm-Strict-licensed code, which the license does not
permit.

## Installing the patched build

Obsidian's own plugin updater does not know about this fork and will
overwrite the patched `main.js` with vanilla upstream on its next
auto-update - that is what originally required re-applying the patch by
hand after every plugin update, and still does:

```sh
python patch_gdrive.py /path/to/your/vault/.obsidian/plugins/remotely-save/main.js --apply
```

run again against your own vault's installed copy whenever Obsidian reverts
it. Disabling auto-update for this plugin
avoids the surprise, at the cost of missing upstream's own fixes until
you update by hand.
