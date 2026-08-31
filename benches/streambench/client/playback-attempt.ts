export type PlaybackAttempt = {
  id: number;
  signal: AbortSignal;
};

export function createPlaybackAttemptCoordinator() {
  let sequence = 0;
  let active: { id: number; controller: AbortController } | null = null;

  const cancel = (reason: "superseded" | "stopped" = "stopped"): void => {
    if (active && !active.controller.signal.aborted) active.controller.abort(reason);
    active = null;
  };

  return {
    begin(): PlaybackAttempt {
      cancel("superseded");
      const controller = new AbortController();
      active = { id: ++sequence, controller };
      return { id: active.id, signal: controller.signal };
    },
    cancel,
    current(): PlaybackAttempt | null {
      if (!active || active.controller.signal.aborted) return null;
      return { id: active.id, signal: active.controller.signal };
    },
    complete(attempt: PlaybackAttempt): void {
      if (active?.id === attempt.id && active.controller.signal === attempt.signal) active = null;
    },
  };
}

export function beginPlaybackAttemptForTarget(
  coordinator: { begin(): PlaybackAttempt },
  target: { hidden?: boolean; item?: { external?: boolean } } | null,
) {
  if (!target) return { ok: false as const, error: "Playlist entry does not exist." };
  if (target.hidden) return { ok: false as const, error: "Playlist entry is hidden." };
  if (target.item?.external) {
    return { ok: false as const, error: "This entry is an external page and cannot play inside Streambench." };
  }
  return { ok: true as const, attempt: coordinator.begin() };
}

export function completePlaybackAttemptIfTerminal(
  coordinator: { complete(attempt: PlaybackAttempt): void },
  attempt: PlaybackAttempt,
  outcome: { pending?: boolean },
): boolean {
  if (outcome.pending) return false;
  coordinator.complete(attempt);
  return true;
}
