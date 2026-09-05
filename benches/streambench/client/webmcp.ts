"use strict";

(() => {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  const ui = globalThis.StreambenchUi;
  if (!ui) return;

  const lifecycle = new AbortController();
  const register = (tool) => {
    try {
      Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal }))
        .catch((error) => console.warn("Streambench WebMCP registration failed", error));
    } catch (error) {
      console.warn("Streambench WebMCP registration failed", error);
    }
  };

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) lifecycle.abort();
  });

  register({
    name: "read_stream_state",
    title: "Read Streambench state",
    description: "Read player, playlist, provider, diagnostics and EPG state without changing Streambench.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      return { ok: true, ...ui.readState() };
    },
  });

  register({
    name: "search_streams",
    title: "Search Streambench playlist",
    description: "Search the currently loaded playlist without changing its visible filter or playback state.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 500, default: "" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute({ query = "", limit = 20 } = {}) {
      if (typeof query !== "string" || query.length > 500) {
        return { ok: false, error: "query must be a string of at most 500 characters." };
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return { ok: false, error: "limit must be an integer from 1 to 50." };
      }
      return { ok: true, query, ...ui.searchEntries(query, limit) };
    },
  });

  register({
    name: "start_stream_playback",
    title: "Start Streambench playback",
    description: "Start playback for one non-external entry through Streambench's existing relay-aware UI. The returned entry is the logical playlist item; state.diagnostics.address reports the effective playback route.",
    inputSchema: {
      type: "object",
      properties: { index: { type: "integer", minimum: 0 } },
      required: ["index"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute({ index } = {}) {
      if (!Number.isInteger(index) || index < 0) {
        return { ok: false, error: "index must be a non-negative integer." };
      }
      return ui.startPlayback(index);
    },
  });

  register({
    name: "stop_stream_playback",
    title: "Stop Streambench playback",
    description: "Stop the current Streambench media playback without changing the loaded playlist.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute() {
      return ui.stopPlayback();
    },
  });
})();
