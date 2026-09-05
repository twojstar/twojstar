import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function workspaceDirectory(importMetaUrl) {
  return dirname(dirname(fileURLToPath(importMetaUrl)));
}

export function dependencyFile(importMetaUrl, relativePath) {
  const workspace = workspaceDirectory(importMetaUrl);
  const workspaceRoot = dirname(workspace);
  const candidates = [
    join(workspace, "node_modules", relativePath),
    join(workspaceRoot, "node_modules", relativePath),
  ];

  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Unable to resolve workspace dependency file: ${relativePath}`);
  }
  return resolved;
}
