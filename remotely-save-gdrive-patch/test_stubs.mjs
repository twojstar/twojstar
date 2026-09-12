// Stand-ins for the symbols the compiled Remotely Save bundle provides around the
// Google Drive class. Names match the real minified output on purpose - the class
// extracted by build_test.py calls these directly. Kept as real exports (not text
// substitution) so static analysis sees genuine uses instead of flagging them dead.

// Instance method on purpose (not static): mirrors the real base class Mp stands in
// for, called as `this.checkConnectCommonOps()` - static would break that call site.
export class Mp { checkConnectCommonOps() { return true } }

export const r = (thisArg, _a, _P, generator) => new Promise((resolve, reject) => {
  const gen = generator.call(thisArg)
  function step(f, v) {
    let res
    try { res = f.call(gen, v) } catch (e) { return reject(e) }
    if (res.done) return resolve(res.value)
    return Promise.resolve(res.value).then(x => step(gen.next, x), x => step(gen.throw, x))
  }
  step(gen.next)
})

export const I = "application/octet-stream"
export const kh = "application/vnd.google-apps.folder"
export const dh = { contentType: () => "text/markdown", lookup: () => "text/markdown" }
export const Vp = (t) => new Date(t).toISOString()
export const zp = (k) => {
  const parts = k.split("/").slice(0, -1)
  const out = []
  let cur = ""
  for (const p of parts) { cur += p + "/"; out.push(cur.slice(0, -1)) }
  return out
}
export const Th = (f, pid, ppath) => ({ keyRaw: (ppath || "") + f.name, id: f.id, parentID: pid, parentIDPath: ppath, isFolder: f.mimeType === kh })
export const th = (size, chunk) => {
  const out = []
  for (let st = 0; st < size; st += chunk) out.push({ start: st, end: Math.min(st + chunk, size) - 1 })
  return out
}
export class vh { on() {} add(f) { return f() } async onIdle() {} pause() {} clear() {} }
export const Eh = () => ({ access_token: "tok", expires_in: 3600 })
