// Stand-ins for the symbols the compiled Remotely Save bundle provides around the
// Google Drive class. Names match the real minified output on purpose - the class
// extracted by build_test.py calls these directly. Kept as real exports (not text
// substitution) so static analysis sees genuine uses instead of flagging them dead.

// Instance method on purpose (not static): mirrors the real base class Mp stands in
// for, called as `this.checkConnectCommonOps()` - static would break that call site.
export class Mp { checkConnectCommonOps() { return true } }

export const r = (thisArg, _unusedA, _unusedP, generator) => new Promise((resolve, reject) => {
  const iterator = generator.call(thisArg)
  function step(operation, value) {
    let result = undefined
    try { result = operation.call(iterator, value) } catch (error) { return reject(error) }
    if (result.done) return resolve(result.value)
    return Promise.resolve(result.value).then(
      value => step(iterator.next, value),
      value => step(iterator.throw, value),
    )
  }
  step(iterator.next)
})

export const I = "application/octet-stream"
export const kh = "application/vnd.google-apps.folder"
export const dh = { contentType: () => "text/markdown", lookup: () => "text/markdown" }
export const Vp = (timestamp) => new Date(timestamp).toISOString()
export const zp = (key) => {
  const parts = key.split("/").slice(0, -1)
  const out = []
  let current = ""
  for (const part of parts) { current += `${part}/`; out.push(current.slice(0, -1)) }
  return out
}
export const Th = (file, parentId, parentPath) => ({
  keyRaw: `${parentPath || ""}${file.name}`,
  id: file.id,
  parentID: parentId,
  parentIDPath: parentPath,
  isFolder: file.mimeType === kh,
})
export const th = (size, chunk) => {
  const out = []
  for (let start = 0; start < size; start += chunk) {
    out.push({ start, end: Math.min(start + chunk, size) - 1 })
  }
  return out
}
export class vh {
  on() { return this }
  add(callback) { void this; return callback() }
  async onIdle() { return this }
  pause() { return this }
  clear() { return this }
}
export const Eh = () => ({ access_token: "tok", expires_in: 3600 })
