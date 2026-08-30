import { ICON as android192Icon } from "./favicon-android-192.ts";
import { ICON as android512Icon } from "./favicon-android-512.ts";
import { ICON as appleIcon } from "./favicon-apple.ts";
import { ICON as icoIcon } from "./favicon-ico-data.ts";
import { ICONS as smallIcons } from "./favicon-small.ts";

type Icon = {
  readonly type: string;
  readonly data: string;
};

const ICONS = new Map<string, Icon>([
  ...Object.entries(smallIcons),
  [appleIcon.path, appleIcon],
  [android192Icon.path, android192Icon],
  [android512Icon.path, android512Icon],
  [icoIcon.path, icoIcon],
]);

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return buffer;
}

export function faviconResponse(pathname: string): Response | null {
  const icon = ICONS.get(pathname);
  if (!icon) return null;
  return new Response(decodeBase64(icon.data), {
    headers: {
      "content-type": icon.type,
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}
