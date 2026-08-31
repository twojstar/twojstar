type PlaybackSubmissionOptions = {
  playlistIndex?: number;
  preserveSelection?: boolean;
  preserveAttempt?: boolean;
};

function parsedIndex(value: string | undefined): number {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

export function activePlaylistIndex(form: HTMLFormElement): number {
  return parsedIndex(form.dataset.streambenchActivePlaylistIndex);
}

export function setActivePlaylistIndex(form: HTMLFormElement, index: number): void {
  if (Number.isInteger(index) && index >= 0) form.dataset.streambenchActivePlaylistIndex = String(index);
  else delete form.dataset.streambenchActivePlaylistIndex;
}

export function playbackSubmissionContext(form: HTMLFormElement) {
  return {
    playlistIndex: parsedIndex(form.dataset.streambenchPlaylistIndex),
    preserveSelection: form.dataset.streambenchPreserveSelection === "true",
    preserveAttempt: form.dataset.streambenchPreserveAttempt === "true",
  };
}

export function submitPlaybackForm(form: HTMLFormElement, {
  playlistIndex = activePlaylistIndex(form),
  preserveSelection = playlistIndex >= 0,
  preserveAttempt = false,
}: PlaybackSubmissionOptions = {}): void {
  const previous = {
    playlistIndex: form.dataset.streambenchPlaylistIndex,
    preserveSelection: form.dataset.streambenchPreserveSelection,
    preserveAttempt: form.dataset.streambenchPreserveAttempt,
  };
  if (playlistIndex >= 0) form.dataset.streambenchPlaylistIndex = String(playlistIndex);
  else delete form.dataset.streambenchPlaylistIndex;
  if (preserveSelection) form.dataset.streambenchPreserveSelection = "true";
  else delete form.dataset.streambenchPreserveSelection;
  if (preserveAttempt) form.dataset.streambenchPreserveAttempt = "true";
  else delete form.dataset.streambenchPreserveAttempt;
  try {
    form.requestSubmit();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const datasetKey = key === "playlistIndex" ? "streambenchPlaylistIndex"
        : key === "preserveSelection" ? "streambenchPreserveSelection"
          : "streambenchPreserveAttempt";
      if (value === undefined) delete form.dataset[datasetKey];
      else form.dataset[datasetKey] = value;
    }
  }
}
