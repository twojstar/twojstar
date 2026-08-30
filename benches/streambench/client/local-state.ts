const STORAGE_KEY = "streambench.state.v1";
const MAX_RECENT = 20;
const MAX_ITEMS = 250;
const MEDIA_MODES = new Set<MediaMode>(["auto", "video", "audio"]);

type MediaMode = "auto" | "video" | "audio";
type StateBucket = "favorites" | "hidden";
type StateView = StateBucket | "recent";
type PreferenceName = "provider" | "mediaMode";

export type StateItem = {
  stateKey?: string;
  id?: string;
  url?: string;
  title?: string;
  group?: string;
  album?: string;
  logo?: string;
  country?: string;
  language?: string;
  radio?: boolean;
  hls?: boolean;
  providerId?: string;
  providerLabel?: string;
  protocol?: string;
  playback?: string;
  quality?: string;
  external?: boolean;
  [key: string]: unknown;
};

export type ItemSnapshot = {
  stateKey: string;
  id: string;
  url: string;
  title: string;
  group: string;
  album: string;
  logo: string;
  country: string;
  language: string;
  radio: boolean;
  hls: boolean;
  providerId: string;
  providerLabel: string;
  protocol: string;
  playback: string;
  quality: string;
  external: boolean;
};

type LocalStateValue = {
  version: 1;
  favorites: Record<string, ItemSnapshot>;
  hidden: Record<string, ItemSnapshot>;
  edits: Record<string, ItemSnapshot>;
  recent: ItemSnapshot[];
  preferences: {
    provider: string;
    mediaMode: MediaMode;
  };
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function emptyState(): LocalStateValue {
  return {
    version: 1,
    favorites: {},
    hidden: {},
    edits: {},
    recent: [],
    preferences: {
      provider: "",
      mediaMode: "auto",
    },
  };
}

function safeText(value: unknown, maxLength = 220): string {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function safeStateKey(value: unknown): string {
  return String(value || "").replace(/[\u0000\r\n\t]/g, "");
}

function safeUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isMediaMode(value: unknown): value is MediaMode {
  return typeof value === "string" && MEDIA_MODES.has(value as MediaMode);
}

export function itemKey(item: StateItem | null | undefined): string {
  const storedKey = safeStateKey(item?.stateKey);
  if (storedKey) return storedKey;
  const provider = safeText(item?.providerId || "local", 60) || "local";
  const url = safeUrl(item?.url);
  const id = safeText(item?.id, 180);
  const identity = id && url ? `${id}|${url}` : url;
  return identity ? `${provider}:${identity}` : "";
}

export function itemSnapshot(item: StateItem | null | undefined): ItemSnapshot | null {
  const url = safeUrl(item?.url);
  if (!url || !item) return null;
  return {
    stateKey: safeStateKey(item.stateKey),
    id: safeText(item.id, 180),
    url,
    title: safeText(item.title, 180) || new URL(url).hostname,
    group: safeText(item.group, 120),
    album: safeText(item.album, 120),
    logo: safeUrl(item.logo),
    country: safeText(item.country, 40),
    language: safeText(item.language, 100),
    radio: Boolean(item.radio),
    hls: Boolean(item.hls),
    providerId: safeText(item.providerId || "local", 60) || "local",
    providerLabel: safeText(item.providerLabel || "Lokalna", 80) || "Lokalna",
    protocol: safeText(item.protocol, 20),
    playback: safeText(item.playback, 20),
    quality: safeText(item.quality, 20),
    external: Boolean(item.external),
  };
}

function normalizeItems(value: unknown, { edits = false }: { edits?: boolean } = {}): Record<string, ItemSnapshot> {
  const result: Record<string, ItemSnapshot> = {};
  const record = asRecord(value);
  if (!record) return result;
  for (const [rawKey, rawItem] of Object.entries(record).slice(0, MAX_ITEMS)) {
    const item = asRecord(rawItem);
    if (!item) continue;
    const key = safeStateKey(rawKey);
    const snapshot = itemSnapshot({ ...item, stateKey: edits ? key : safeStateKey(item.stateKey) });
    if (!key || !snapshot) continue;
    if (edits || itemKey(snapshot) === key) {
      snapshot.stateKey = key;
      result[key] = snapshot;
    }
  }
  return result;
}

export function normalizeState(value: unknown): LocalStateValue {
  const state = emptyState();
  const input = asRecord(value);
  if (!input) return state;
  state.favorites = normalizeItems(input.favorites);
  state.hidden = normalizeItems(input.hidden);
  state.edits = normalizeItems(input.edits, { edits: true });

  if (Array.isArray(input.recent)) {
    const seen = new Set<string>();
    for (const rawItem of input.recent) {
      const item = asRecord(rawItem);
      if (!item) continue;
      const snapshot = itemSnapshot(item);
      const key = snapshot ? itemKey(snapshot) : "";
      if (!snapshot || !key || seen.has(key)) continue;
      seen.add(key);
      state.recent.push(snapshot);
      if (state.recent.length >= MAX_RECENT) break;
    }
  }

  const preferences = asRecord(input.preferences);
  const provider = safeText(preferences?.provider, 60);
  const mediaMode = isMediaMode(preferences?.mediaMode) ? preferences.mediaMode : "auto";
  state.preferences = { provider, mediaMode };
  return state;
}

export function createLocalState(storage: StorageLike | null | undefined = globalThis.localStorage) {
  let state = emptyState();

  function load(): LocalStateValue {
    try {
      state = normalizeState(JSON.parse(storage?.getItem(STORAGE_KEY) || "null"));
    } catch {
      state = emptyState();
    }
    return state;
  }

  function save(): void {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Browsing still works when storage is unavailable or full.
    }
  }

  function toggle(bucket: StateBucket, item: StateItem): boolean {
    const snapshot = itemSnapshot(item);
    const key = snapshot ? itemKey(snapshot) : "";
    if (!key || !snapshot) return false;
    snapshot.stateKey = key;
    if (state[bucket][key]) delete state[bucket][key];
    else state[bucket][key] = snapshot;
    save();
    return Boolean(state[bucket][key]);
  }

  load();
  return {
    get value(): LocalStateValue {
      return state;
    },
    reload: load,
    isFavorite(item: StateItem): boolean {
      return Boolean(state.favorites[itemKey(item)]);
    },
    isHidden(item: StateItem): boolean {
      return Boolean(state.hidden[itemKey(item)]);
    },
    toggleFavorite(item: StateItem): boolean {
      return toggle("favorites", item);
    },
    toggleHidden(item: StateItem): boolean {
      return toggle("hidden", item);
    },
    addRecent(item: StateItem): void {
      const snapshot = itemSnapshot(item);
      const key = snapshot ? itemKey(snapshot) : "";
      if (!key || !snapshot) return;
      snapshot.stateKey = key;
      state.recent = [snapshot, ...state.recent.filter((entry) => itemKey(entry) !== key)].slice(0, MAX_RECENT);
      save();
    },
    clearRecent(): void {
      state.recent = [];
      save();
    },
    editFor(item: StateItem): ItemSnapshot | null {
      return state.edits[itemKey(item)] || null;
    },
    applyEdit(item: StateItem): StateItem {
      const key = itemKey(item);
      const edit = state.edits[key];
      return edit ? { ...item, ...edit, stateKey: key } : { ...item, stateKey: key };
    },
    setEdit(item: StateItem, changes: StateItem): ItemSnapshot | null {
      const key = itemKey(item);
      if (!key) return null;
      const snapshot = itemSnapshot({ ...item, ...changes, stateKey: key });
      if (!snapshot) return null;
      snapshot.stateKey = key;
      state.edits[key] = snapshot;
      save();
      return snapshot;
    },
    clearEdit(item: StateItem): boolean {
      const key = itemKey(item);
      if (!key || !state.edits[key]) return false;
      delete state.edits[key];
      save();
      return true;
    },
    items(view: StateView): StateItem[] {
      if (view === "favorites") return Object.values(state.favorites).map((item) => this.applyEdit(item));
      if (view === "recent") return state.recent.map((item) => this.applyEdit(item));
      if (view === "hidden") return Object.values(state.hidden).map((item) => this.applyEdit(item));
      return [];
    },
    setPreference(name: PreferenceName, value: string): void {
      if (name === "provider") state.preferences.provider = safeText(value, 60);
      if (name === "mediaMode" && isMediaMode(value)) state.preferences.mediaMode = value;
      save();
    },
  };
}
