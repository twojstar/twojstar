"""Patch Remotely Save's main.js: Google Drive writeFile/mkdir overwrite instead of create-new.

Upstream (github.com/remotely-save/remotely-save) ships the Google Drive backend only
in the built main.js - it is closed-source, not in src/. writeFile/mkdir always POST a
new file, so Drive accumulates duplicates of the same name on every sync. This patch
adds a name+parent lookup and switches to PATCH on an existing id, trashing extra
duplicate files (never folders) it finds along the way.

Verified anchors: upstream 0.5.25. A future minified build renames local variables on
every release, so a version bump likely needs new anchors - the script aborts loudly
instead of silently no-op'ing or corrupting output when an anchor does not match
exactly once.

Usage:
  python patch_gdrive.py [plugin_path] [--apply]

  plugin_path defaults to the local Obsidian vault's installed copy. Without --apply,
  only reports whether every anchor matches; add --apply to write the patched file
  (a plugin_path + '.orig' backup is written first).
"""
import shutil
import sys

DEFAULT_PLUGIN = r'C:\Users\travn\Documents\Obsidian_Vault\.obsidian\plugins\remotely-save\main.js'

FIELDS = ("kind,fileExtension,md5Checksum,mimeType,parents,size,spaces,id,name,trashed,"
          "createdTime,modifiedTime,quotaBytesUsed,originalFilename,fullFileExtension,"
          "sha1Checksum,sha256Checksum")

HELPER = """}
/* remotely-save local patch: resolve an existing Drive file/folder id for name+parent,
   so writeFile/mkdir can update in place instead of creating yet another copy.
   Keeps the OLDEST match (stable id + Drive revision history) and moves any extra
   duplicate FILES to the Drive trash. Folders are never trashed. */
async _rsvFindExisting(name,parentID,isFolder){
  try{
    const esc=name.split(String.fromCharCode(92)).join(String.fromCharCode(92,92)).split("'").join(String.fromCharCode(92)+"'");
    const folderMime="application/vnd.google-apps.folder";
    const q=`name='${esc}' and '${parentID}' in parents and trashed=false and mimeType${isFolder?"=":"!="}'${folderMime}'`;
    const url=`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=100&orderBy=createdTime&fields=files(id,name,mimeType,createdTime,modifiedTime)`;
    const res=await fetch(url,{method:"GET",headers:{Authorization:`Bearer ${await this._getAccessToken()}`}});
    if(res.status!==200){console.warn(`remotely-save patch: lookup failed for ${name} (HTTP ${res.status}), falling back to create`);return undefined}
    const found=(await res.json()).files||[];
    if(found.length===0)return undefined;
    if(!isFolder&&found.length>1){
      for(let k=1;k<found.length;k++){
        try{
          const del=await fetch(`https://www.googleapis.com/drive/v3/files/${found[k].id}`,{method:"PATCH",headers:{Authorization:`Bearer ${await this._getAccessToken()}`,"Content-Type":"application/json"},body:JSON.stringify({trashed:true})});
          console.info(`remotely-save patch: trashed duplicate ${name} id=${found[k].id} (HTTP ${del.status})`);
        }catch(err){console.warn(`remotely-save patch: cannot trash duplicate ${name}`,err)}
      }
    }
    return found[0].id;
  }catch(err){console.warn(`remotely-save patch: lookup threw for ${name}`,err);return undefined}
}
"""

REPLACEMENTS = [
    # 0. inject the helper right before writeFile
    (
        '}writeFile(e,t,i,n){',
        HELPER + 'writeFile(e,t,i,n){',
    ),
    # 1. multipart branch: metadata depends on create-vs-update
    (
        'if(t.byteLength<=5242880){const a=new FormData,'
        'd={name:l,modifiedTime:Vp(i,!0),createdTime:Vp(n,!0),parents:[o]};',
        'if(t.byteLength<=5242880){const _rsvID=yield this._rsvFindExisting(l,o,!1);'
        'const a=new FormData,'
        'd=void 0===_rsvID?{name:l,modifiedTime:Vp(i,!0),createdTime:Vp(n,!0),parents:[o]}'
        ':{name:l,modifiedTime:Vp(i,!0)};',
    ),
    # 2. multipart branch: POST create -> PATCH update when the file exists
    (
        'const c=yield fetch("https://www.googleapis.com/upload/drive/v3/files'
        '?uploadType=multipart&fields=' + FIELDS + '",{method:"POST",'
        'headers:{Authorization:`Bearer ${yield this._getAccessToken()}`},body:a});',
        'const c=yield fetch(`https://www.googleapis.com/upload/drive/v3/files'
        '${void 0===_rsvID?"":"/"+_rsvID}?uploadType=multipart&fields=' + FIELDS + '`,'
        '{method:void 0===_rsvID?"POST":"PATCH",'
        'headers:{Authorization:`Bearer ${yield this._getAccessToken()}`},body:a});',
    ),
    # 3. resumable branch (>5 MiB): metadata depends on create-vs-update
    (
        '{const a={name:l,modifiedTime:Vp(i,!0),createdTime:Vp(n,!0),parents:[o]},'
        'd=JSON.stringify(a),',
        '{const _rsvID=yield this._rsvFindExisting(l,o,!1);'
        'const a=void 0===_rsvID?{name:l,modifiedTime:Vp(i,!0),createdTime:Vp(n,!0),parents:[o]}'
        ':{name:l,modifiedTime:Vp(i,!0)},d=JSON.stringify(a),',
    ),
    # 4. resumable branch: session start POST -> PATCH when the file exists
    (
        'u=yield fetch("https://www.googleapis.com/upload/drive/v3/files'
        '?uploadType=resumable&fields=' + FIELDS + '",{method:"POST",headers:c,body:d});',
        'u=yield fetch(`https://www.googleapis.com/upload/drive/v3/files'
        '${void 0===_rsvID?"":"/"+_rsvID}?uploadType=resumable&fields=' + FIELDS + '`,'
        '{method:void 0===_rsvID?"POST":"PATCH",headers:c,body:d});',
    ),
    # 5. mkdir: reuse an existing folder instead of creating a second one
    (
        'const a={mimeType:kh,modifiedTime:Vp(t,!0),createdTime:Vp(i,!0),name:s,parents:[o]},'
        'l=yield fetch("https://www.googleapis.com/drive/v3/files",{method:"POST",'
        'headers:{Authorization:`Bearer ${yield this._getAccessToken()}`,'
        '"Content-Type":"application/json"},body:JSON.stringify(a)});',
        'const _rsvFID=yield this._rsvFindExisting(s,o,!0);'
        'const a={mimeType:kh,modifiedTime:Vp(t,!0),createdTime:Vp(i,!0),name:s,parents:[o]},'
        'l=yield fetch(void 0===_rsvFID?"https://www.googleapis.com/drive/v3/files"'
        ':`https://www.googleapis.com/drive/v3/files/${_rsvFID}?fields=' + FIELDS + '`,'
        '{method:void 0===_rsvFID?"POST":"PATCH",'
        'headers:{Authorization:`Bearer ${yield this._getAccessToken()}`,'
        '"Content-Type":"application/json"},'
        'body:void 0===_rsvFID?JSON.stringify(a):JSON.stringify({modifiedTime:Vp(t,!0)})});',
    ),
    # 6. rm(): the trash PATCH sent a JSON body without a JSON content type
    (
        'if(200!==(yield fetch(`https://www.googleapis.com/drive/v3/files/${r}`,'
        '{method:"PATCH",headers:{Authorization:`Bearer ${yield this._getAccessToken()}`},'
        'body:JSON.stringify({trashed:!0})})).status)',
        'if(200!==(yield fetch(`https://www.googleapis.com/drive/v3/files/${r}`,'
        '{method:"PATCH",headers:{Authorization:`Bearer ${yield this._getAccessToken()}`,'
        '"Content-Type":"application/json"},'
        'body:JSON.stringify({trashed:!0})})).status)',
    ),
]

MARKER = 'class Bh extends Mp{constructor(e,t,r){super(),this.kind="googledrive"'


def class_span(s):
    start = s.index(MARKER)
    i = s.index('{', start)
    depth = 0
    j = i
    mode = None
    BS = chr(92)
    while j < len(s):
        c = s[j]
        if mode:
            if c == BS:
                j += 2
                continue
            if c == mode:
                mode = None
            j += 1
            continue
        if c in '"\'`':
            mode = c
            j += 1
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return start, j + 1
        j += 1
    raise SystemExit('class end not found')


def main():
    apply = '--apply' in sys.argv
    positional = [a for a in sys.argv[1:] if a != '--apply']
    plugin = positional[0] if positional else DEFAULT_PLUGIN
    backup = plugin + '.orig'

    with open(plugin, encoding='utf-8') as f:
        s = f.read()
    if '_rsvFindExisting' in s:
        print('ALREADY PATCHED - nothing to do')
        return
    a, b = class_span(s)
    body = s[a:b]
    print(f'class span {a}..{b} ({b - a} chars)')
    ok = True
    for idx, (old, new) in enumerate(REPLACEMENTS):
        n = body.count(old)
        print(f'anchor {idx}: {n} match(es)  {old[:60]!r}...')
        if n != 1:
            ok = False
            continue
        body = body.replace(old, new, 1)
    if not ok:
        raise SystemExit('ABORT: an anchor did not match exactly once - upstream likely '
                          'renamed minified locals, anchors need re-deriving')
    out = s[:a] + body + s[b:]
    if not apply:
        print(f'dry run OK ({len(s)} -> {len(out)} chars); re-run with --apply')
        return
    shutil.copyfile(plugin, backup)
    print('backup ->', backup)
    with open(plugin, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print(f'patched ({len(s)} -> {len(out)} chars)')


if __name__ == '__main__':
    main()
