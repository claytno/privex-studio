# Studio beta.9: scenes, preview and prelive interactions

Release source for beta.9. The public beta.8 installer remains immutable.

- Scene updates are serialized. Edits arriving during a change replace the queued
  target. Temporary main-process contention is retried, while equipment failures
  remain visible and can be retried manually.
- An empty composition removes visual sources and leaves a prepared black canvas.
  Existing audio and an ongoing broadcast remain active. Starting a new broadcast
  without sources is rejected before reserving a slot.
- Native source replacement is transactional, including failure after partial
  insertion. Unchanged audio devices are reusable after disconnection.
- Preview geometry uses the CSS viewport and native client rectangle, with edge
  rounding. Source settings remain in the docks so the preview stays visible.
- Saved layouts retry temporary contention and show a failure instead of silently
  losing an edit. Empty saved scenes do not automatically regain a camera.
- Before a session, Interactions edits an account preset. The next new session
  receives a separate copy. It does not start a live, reserve capacity, accept
  purchases or copy financial activity. A live already created is unchanged.

Server dependency: GET/PUT `/obs/v1/manager/commerce-preset`, with the additive
`live_commerce_presets` migration installed before activating the new admission
code. The limited device route requires a verified, active account and the
existing `studio:manager` scope. Publish the backend before the new installer.

Validation uses synthetic frames, mocked renderer sessions and an isolated SQLite
database. It does not establish live camera/game/window capture quality or
multi-monitor native window placement on the user's computer. Those require a
real device check. Production deployment and installer publication are separate from these tests.
