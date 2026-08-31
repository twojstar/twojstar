const RECOVERABLE_HLS_ERROR = /(?:manifest|level|frag|key)Load(?:Error|TimeOut)/i;

export function isRecoverableHlsError(message: unknown, state = "error"): boolean {
  return state === "error" && RECOVERABLE_HLS_ERROR.test(String(message || ""));
}

export function shouldWaitForHlsRecovery(
  message: unknown,
  state = "error",
  recoveryState = "idle",
): boolean {
  return recoveryState !== "exhausted" && isRecoverableHlsError(message, state);
}
