import { ICONS as androidIcons } from "./favicon-android.js";
import { ICONS as smallIcons } from "./favicon-small.js";

type Icon = {
  readonly type: string;
  readonly data: string;
};

const ICONS: Record<string, Icon> = { ...smallIcons, ...androidIcons };

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

export function faviconResponse(pathname: string): Response | null {
  const icon = ICONS[pathname];
  if (!icon) return null;

  return new Response(decodeBase64(icon.data), {
    headers: {
      "content-type": icon.type,
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}
