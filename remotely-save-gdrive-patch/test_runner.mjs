// Runs writeFile/mkdir dedup checks against a Bh class module built by
// build_test.py. Usage: node test_runner.mjs <path to the generated class module>
import { pathToFileURL } from "node:url"
import { kh } from "./test_stubs.mjs"

const writeLine = (message = "") => process.stdout.write(`${message}\n`)
const writeError = (message) => process.stderr.write(`${message}\n`)
const classPath = process.argv[2]
if (!classPath) {
  writeError("usage: node test_runner.mjs <path to the generated class module>")
  process.exit(1)
}
const { default: Bh } = await import(pathToFileURL(classPath).href)

// ---- fake Drive ----
let calls = []
let listing = []
let listingPages = null
let uploadStatus = 200
let trashStatus = 200
globalThis.fetch = (url, opts = {}) => {
  const urlStr = typeof url === "string" ? url : String(url)
  const bodyText = typeof opts.body === "string" ? opts.body : ""
  calls.push({ method: opts.method || "GET", url: urlStr, body: opts.body })
  if (urlStr.includes("/drive/v3/files?q=")) {
    const parsed = new URL(urlStr)
    const query = parsed.searchParams.get("q") || ""
    const isFolderQuery = query.includes("mimeType='application/vnd.google-apps.folder'")
    const pageIndex = Number(parsed.searchParams.get("pageToken") || "0")
    const page = listingPages ? (listingPages[pageIndex] || []) : listing
    const nextPageToken = listingPages && pageIndex + 1 < listingPages.length ? String(pageIndex + 1) : undefined
    const files = page.filter(file => (file.mimeType === kh) === isFolderQuery)
    return { status: 200, json: () => ({ files, ...(nextPageToken ? { nextPageToken } : {}) }) }
  }
  if (opts.method === "PATCH" && bodyText.includes('"trashed":true')) {
    return { status: trashStatus, json: () => ({}) }
  }
  if (urlStr.includes("/upload/drive/v3/files") && urlStr.includes("resumable")) {
    return { status: uploadStatus, headers: { get: () => "https://upload.example/session" } }
  }
  if (urlStr === "https://upload.example/session") {
    return { status: 200, json: () => ({ id: "NEWBIG", name: "big.md" }) }
  }
  if (urlStr.includes("/upload/drive/v3/files")) {
    return { status: uploadStatus, json: () => ({ id: "NEW1", name: "loga.md" }) }
  }
  return { status: 200, json: () => ({ id: "F1", name: "x", mimeType: kh }) }
}

const mkfs = () => {
  // saveUpdatedConfigFunc - nothing to persist in this fake filesystem
  const fs = new Bh(
    { accessToken: "tok", refreshToken: "ref", accessTokenExpiresAtTimeMs: Date.now() + 9e6 },
    "Vault",
    () => undefined,
  )
  fs.baseDirID = "BASE"
  fs.vaultFolderExists = true
  return fs
}

const buf = (size) => new Uint8Array(size).buffer
const trashCalls = () => calls.filter(call => typeof call.body === "string" && call.body.includes('"trashed":true'))
let failures = 0
const check = (name, condition, extra) => {
  writeLine(`${condition ? "PASS  " : "FAIL  "}${name}${condition ? "" : `  <<< ${JSON.stringify(extra)}`}`)
  if (!condition) failures++
}

// 1. small file, no remote copy -> POST create with parents
calls = []; listing = []; listingPages = null
await mkfs().writeFile("loga.md", buf(10), Date.now(), Date.now())
let up = calls.find(call => call.url.includes("uploadType=multipart"))
check("new file -> POST create", up.method === "POST" && up.url.includes("/files?uploadType"), up)
let meta = JSON.parse(await up.body.get("metadata").text())
check("new file -> metadata carries parents", Array.isArray(meta.parents), meta)

// 2. small file, one remote copy -> PATCH that id, no parents in metadata
calls = []; listing = [{ id: "OLD1", name: "loga.md", mimeType: "text/markdown" }]
await mkfs().writeFile("loga.md", buf(10), Date.now(), Date.now())
up = calls.find(call => call.url.includes("uploadType=multipart"))
check("existing file -> PATCH same id", up.method === "PATCH" && up.url.includes("/files/OLD1?uploadType"), up)
meta = JSON.parse(await up.body.get("metadata").text())
check("update -> no parents / no createdTime in metadata", meta.parents === undefined && meta.createdTime === undefined, meta)
check("update -> no extra trash calls", trashCalls().length === 0)

// 3. duplicates across pages -> keep oldest, upload, then trash every newer copy
calls = []; listing = []; listingPages = [
  [{ id: "OLD1", name: "loga.md" }, { id: "DUP2", name: "loga.md" }],
  [{ id: "DUP3", name: "loga.md" }],
]
await mkfs().writeFile("loga.md", buf(10), Date.now(), Date.now())
up = calls.find(call => call.url.includes("uploadType=multipart"))
const trashed = trashCalls().map(call => call.url.split("/files/")[1])
const uploadIndex = calls.findIndex(call => call.url.includes("uploadType=multipart"))
const firstTrashIndex = calls.findIndex(call => typeof call.body === "string" && call.body.includes('"trashed":true'))
check("dupes -> updates the oldest", up.url.includes("/files/OLD1?uploadType"), up)
check("dupes -> follows pagination", calls.filter(call => call.url.includes("/drive/v3/files?q=")).length === 2)
check("dupes -> trashes all newer copies", JSON.stringify(trashed) === JSON.stringify(["DUP2", "DUP3"]), trashed)
check("dupes -> cleanup happens after upload", uploadIndex >= 0 && firstTrashIndex > uploadIndex, { uploadIndex, firstTrashIndex })
listingPages = null

// 4. failed upload must leave duplicates visible
calls = []; listing = [{ id: "OLD1", name: "loga.md" }, { id: "DUP2", name: "loga.md" }]; uploadStatus = 500
let uploadFailed = false
try { await mkfs().writeFile("loga.md", buf(10), Date.now(), Date.now()) } catch { uploadFailed = true }
check("failed upload -> no duplicates trashed", uploadFailed && trashCalls().length === 0, calls)
uploadStatus = 200

// 5. cleanup HTTP errors are surfaced after a successful upload
calls = []; listing = [{ id: "OLD1", name: "loga.md" }, { id: "DUP2", name: "loga.md" }]; trashStatus = 429
let cleanupFailed = false
try { await mkfs().writeFile("loga.md", buf(10), Date.now(), Date.now()) } catch { cleanupFailed = true }
check("failed cleanup -> write reports failure", cleanupFailed && trashCalls().length === 1, calls)
trashStatus = 200

// 6. large file (>5 MiB), existing -> resumable session opened with PATCH
calls = []; listing = [{ id: "BIG1", name: "big.md" }]
await mkfs().writeFile("big.md", buf(6 * 1024 * 1024), Date.now(), Date.now())
const sess = calls.find(call => call.url.includes("uploadType=resumable"))
check("large existing file -> PATCH resumable session", sess.method === "PATCH" && sess.url.includes("/files/BIG1?uploadType=resumable"), sess)
check("large existing -> metadata without parents", JSON.parse(sess.body).parents === undefined, sess.body)

// 7. large file, new -> POST
calls = []; listing = []
await mkfs().writeFile("big.md", buf(6 * 1024 * 1024), Date.now(), Date.now())
const sess2 = calls.find(call => call.url.includes("uploadType=resumable"))
check("large new file -> POST resumable session", sess2.method === "POST" && sess2.url.includes("/files?uploadType=resumable"), sess2)

// 8. mkdir on an existing folder -> PATCH, never a second folder, never trash
calls = []; listing = [{ id: "FOLD1", name: "sub", mimeType: kh }]
await mkfs().mkdir("sub/", Date.now(), Date.now())
const mk = calls.find(call => call.url.includes("/drive/v3/files") && !call.url.includes("?q="))
check("existing folder -> PATCH, no duplicate folder", mk.method === "PATCH" && mk.url.includes("/files/FOLD1"), mk)
check("folders are never trashed", trashCalls().length === 0)

// 9. mkdir, folder absent -> POST create
calls = []; listing = []
await mkfs().mkdir("sub/", Date.now(), Date.now())
const mk2 = calls.find(call => call.url.includes("/drive/v3/files") && !call.url.includes("?q="))
check("new folder -> POST create", mk2.method === "POST", mk2)

// 10. lookup failure -> falls back to old create behaviour instead of throwing
calls = []; listing = []
const realFetch = globalThis.fetch
globalThis.fetch = (url, opts) => (String(url).includes("?q=") ? { status: 500, json: () => ({}) } : realFetch(url, opts))
await mkfs().writeFile("loga.md", buf(10), Date.now(), Date.now())
up = calls.find(call => call.url.includes("uploadType=multipart"))
check("lookup HTTP 500 -> falls back to POST create", up.method === "POST", up)
globalThis.fetch = realFetch

// 11. apostrophe in a name is escaped in the q filter
calls = []; listing = []
await mkfs().writeFile("it's a note.md", buf(10), Date.now(), Date.now())
const query = new URL(calls[0].url).searchParams.get("q") || ""
check("apostrophe escaped in query", query.includes(`name='it${String.fromCharCode(92)}'s a note.md'`), query)

writeLine(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
