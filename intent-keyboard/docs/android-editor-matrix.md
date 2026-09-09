# Android real-editor matrix

This is the repeatable physical validation gate for host composition ownership. Unit tests cover the pure ownership policy; this matrix checks how real `InputConnection` implementations behave around that policy.

Use a debug APK from the exact final commit being evaluated. Keep remote fallback disabled unless a scenario explicitly needs it, and use disposable non-sensitive text.

## Editor classes

Run the core scenarios in at least one representative editor from each available class:

| Class | Examples | Why it matters |
| --- | --- | --- |
| Native Android text field | small test app, Settings search, simple notes field | Baseline `InputConnection` behavior |
| WebView / browser editor | web form, contenteditable field | Composition and selection callbacks can differ from native widgets |
| Messaging composer | common chat/messaging app | Real-world send actions, aggressive editor state updates |
| Rich/editor-style field | notes/document editor when available | Cursor/range movement and host-side formatting |
| Sensitive field | password/PIN field | Semantic buffering and composing text must stay disabled |

Record the exact app/version and field type used. Different apps in the same class are not assumed equivalent.

## Core scenarios

For every non-sensitive editor, start with a fresh field and run these cases:

1. **Raw draft mirror**
   - Type `jutro dam znac rano`.
   - Expected: one keyboard-owned composing region mirrors the draft; no duplicate committed copy appears.

2. **Preview replacement**
   - Use `Natural` or `Civilized` and wait for/render a preview.
   - Expected: a safe preview replaces the same owned composing region. The raw draft remains the keyboard source of truth.

3. **Revert before commit**
   - Produce a preview, then tap **Revert**.
   - Expected: the owned composing region returns to the raw draft. If the host refuses restoration, the preview remains and keyboard/host state does not silently diverge.

4. **Explicit commit**
   - Produce a safe preview and tap **Commit**.
   - Expected: exactly one final copy remains in the field and composition ownership is cleared.

5. **Cursor move inside/outside composition**
   - Move the caret before or inside the mirrored draft while the keyboard owns composition.
   - Expected: ownership is finalized/abandoned according to the current policy; later rendering must not rewrite text whose ownership became ambiguous.

6. **Selection range change**
   - Select part of the composing draft or create a non-collapsed selection.
   - Expected: the keyboard does not keep rewriting the old composing region after the selection boundary changes.

7. **Host finalizes composition**
   - Trigger an editor action that causes composing candidates to disappear, if the editor exposes one.
   - Expected: internal ownership/buffer tracking is cleared rather than resurrecting the old composition.

8. **Editor/context switch**
   - Start a draft, then move to another field/app and return.
   - Expected: the previous owned composition is finalized where possible; stale draft ownership is not carried into the new connection.

9. **Enter/editor action**
   - Exercise Send/Search/Done/Next where available and a multiline newline field separately.
   - Expected: the current safe draft is finalized once before the host action; multiline fields append newline instead of accidentally sending.

10. **Backspace boundaries**
    - Delete while the private draft is non-empty, then continue when it becomes empty.
    - Expected: draft deletion stays within keyboard-owned state first; host deletion is used only after that buffer is empty.

## Sensitive-field gate

Open a password, visible-password, web-password or numeric-password field when available.

Expected invariants:

- characters go directly to the host field,
- no semantic/private draft buffering is active,
- no composing mirror owned by Intent Keyboard is created,
- no local or remote semantic render is requested,
- switching back to a normal field does not resurrect sensitive text.

Do not use real credentials.

## Failure criteria

Treat any of these as a failed editor case:

- duplicate insertion after preview or commit,
- rendered text replacing host text after composition ownership was lost,
- cursor/selection jumps caused by keyboard-owned updates,
- stale preview reappearing after context switch or revert,
- Commit reporting success while the host visibly rejected/changed the text,
- sensitive text entering semantic buffering or a provider path,
- keyboard and host showing different drafts with no explicit failure status.

A graceful mechanical fallback or explicit "composition unavailable" status is acceptable; silent text corruption is not.

## Result template

Record one row per editor/field combination:

| App/version | Field type | Draft mirror | Preview replace | Revert | Commit once | Cursor/range | Context switch | Enter | Sensitive gate | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |  |  |

Use `pass`, `fail`, or `n/a` for each scenario. A failure should include the raw draft, register, exact action sequence and whether the host still reported a composing range.

## What this gate can establish

Passing this matrix supports claims about composition/selection behavior only for the tested editor versions. It does not establish local-model latency, rewrite quality, translation quality or accelerator compatibility; those belong to [`android-local-benchmark.md`](android-local-benchmark.md).
