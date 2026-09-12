// Runs the 9 writeFile/mkdir dedup checks against a Bh class module built by
// build_test.py. Usage: node test_runner.mjs <path to the generated class module>
import { pathToFileURL } from "node:url"
import { kh } from "./test_stubs.mjs"

const classPath = process.argv[2]
if (!classPath) {
  console.error("usage: node test_runner.mjs <path to the generated class module>")
  process.exit(1)
}
const { default: Bh } = await import(pathToFileURL(classPath).href)

// ---- fake Drive ----
let calls = []
let listing = []
globalThis.fetch = (url, opts = {}) => {
  const urlStr = typeof url === "string" ? url : String(url)
  calls.push({ method: opts.method || "GET", url: urlStr, body: opts.body })
  if (urlStr.includes("/drive/v3/files?q=")) {
    const query = decodeURIComponent(urlStr.split("q=")[1].split("&")[0])
    const isFolderQ = query.includes("mimeType='application/vnd.google-apps.folder'")
    return { status: 200, json: () => ({ files: listing.filter(f => (f.mimeType === kh) === isFolderQ) }) }
  }
  if (urlStr.includes("/upload/drive/v3/files") && urlStr.includes("resumable")) {
    return { status: 200, headers: { get: () => "https://upload.example/session" } }
  }
  if (urlStr === "https://upload.example/session") {
    return { status: 200, json: () => ({ id: "NEWBIG", name: "big.md" }) }
  }
  if (urlStr.includes("/upload/drive/v3/files")) {
    return { status: 200, json: () => ({ id: "NEW1", name: "loga.md" }) }
  }
  return { status: 200, json: () => ({ id: "F1", name: "x", mimeType: kh }) }
}

const mkfs = () => {
  // saveUpdatedConfigFunc - nothing to persist in this fake filesystem
  const fs = new Bh({ accessToken: "tok", refreshToken: "ref", accessTokenExpiresAtTimeMs: Date.now() + 9e6 }, "Vault", () => {})
  fs.baseDirID = "BASE"; fs.vaultFolderExists = true
  return fs
}

const buf = (n) => new Uint8Array(n).buffer
let failures = 0
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS  " : "FAIL  "}${name}${cond ? "" : `  <<< ${JSON.stringify(extra)}`}`)
  if (!cond) failures++
}

// 1. small file, no remote copy -> POST create with parents
calls = []; listing = []
await mkfs().writeFile("loga.md", buf(10), Date.now(), Date.now())
let up = calls.find(c => c.url.includes("uploadType=multipart"))
check("new file -> POST create", up.method === "POST" && up.url.includes("/files?uploadType"), up)
let meta = JSON.parse(await up.body.get("metadata").text())
check("new file -> metadata carries parents", Array.isArray(meta.parents), meta)

// 2. small file, one remote copy -> PATCH that id, no parents in metadata
calls = []; listing = [{ id: "OLD1", name: "loga.md", mimeType: "text/markdown" }]
await mkfs().writeFile("loga.md", buf(10), Date.now(), Date.now())
up = calls.find(c => c.url.includes("uploadType=multipart"))
check("existing file -> PATCH same id", up.method === "PATCH" && up.url.includes("/files/OLD1?uploadType"), up)
meta = JSON.parse(await up.body.get("metadata").text())
check("update -> no parents / no createdTime in metadata", meta.parents === undefined && meta.createdTime === undefined, meta)
check("update -> no extra trash calls", calls.filter(c => String(c.body).includes("trashed")).length === 0)

// 3. three duplicates -> keep the first (oldest), trash the rest
calls = []; listing = [{ id: "OLD1", name: "loga.md" }, { id: "DUP2", name: "loga.md" }, { id: "DUP3", name: "loga.md" }]
await mkfs().writeFile("loga.md", buf(10), Date.now(), Date.now())
up = calls.find(c => c.url.includes("uploadType=multipart"))
const trashed = calls.filter(c => String(c.body).includes('"trashed":true')).map(c => c.url.split("/files/")[1])
check("dupes -> updates the oldest", up.url.includes("/files/OLD1?uploadType"), up)
check("dupes -> trashes DUP2+DUP3 only", JSON.stringify(trashed) === JSON.stringify(["DUP2", "DUP3"]), trashed)

// 4. large file (>5 MiB), existing -> resumable session opened with PATCH
calls = []; listing = [{ id: "BIG1", name: "big.md" }]
await mkfs().writeFile("big.md", buf(6 * 1024 * 1024), Date.now(), Date.now())
const sess = calls.find(c => c.url.includes("uploadType=resumable"))
check("large existing file -> PATCH resumable session", sess.method === "PATCH" && sess.url.includes("/files/BIG1?uploadType=resumable"), sess)
check("large existing -> metadata without parents", JSON.parse(sess.body).parents === undefined, sess.body)

// 5. large file, new -> POST
calls = []; listing = []
await mkfs().writeFile("big.md", buf(6 * 1024 * 1024), Date.now(), Date.now())
const sess2 = calls.find(c => c.url.includes("uploadType=resumable"))
check("large new file -> POST resumable session", sess2.method === "POST" && sess2.url.includes("/files?uploadType=resumable"), sess2)

// 6. mkdir on an existing folder -> PATCH, never a second folder, never trash
calls = []; listing = [{ id: "FOLD1", name: "sub", mimeType: kh }]
await mkfs().mkdir("sub/", Date.now(), Date.now())
const mk = calls.find(c => c.url.includes("/drive/v3/files") && !c.url.includes("?q="))
check("existing folder -> PATCH, no duplicate folder", mk.method === "PATCH" && mk.url.includes("/files/FOLD1"), mk)
check("folders are never trashed", calls.filter(c => String(c.body).includes("trashed")).length === 0)

// 7. mkdir, folder absent -> POST create
calls = []; listing = []
await mkfs().mkdir("sub/", Date.now(), Date.now())
const mk2 = calls.find(c => c.url.includes("/drive/v3/files") && !c.url.includes("?q="))
check("new folder -> POST create", mk2.method === "POST", mk2)

// 8. lookup failure -> falls back to old create behaviour instead of throwing
calls = []; listing = []
const realFetch = globalThis.fetch
globalThis.fetch = (url, opts) => (String(url).includes("?q=") ? { status: 500, json: () => ({}) } : realFetch(url, opts))
await mkfs().writeFile("loga.md", buf(10), Date.now(), Date.now())
up = calls.find(c => c.url.includes("uploadType=multipart"))
check("lookup HTTP 500 -> falls back to POST create", up.method === "POST", up)
globalThis.fetch = realFetch

// 9. apostrophe in a name is escaped in the q filter
calls = []; listing = []
await mkfs().writeFile("it's a note.md", buf(10), Date.now(), Date.now())
const query = decodeURIComponent(calls[0].url.split("q=")[1].split("&")[0])
check("apostrophe escaped in query", query.includes(`name='it${String.fromCharCode(92)}'s a note.md'`), query)

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
