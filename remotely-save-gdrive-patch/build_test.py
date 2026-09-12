"""Extract the (patched) Google Drive class from a real main.js and write it as a
standalone ES module that imports test_stubs.mjs and exports the class default.
Run the result with: node test_runner.mjs <output.mjs>

Usage: python build_test.py <patched_main.js> <output.mjs>
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from patch_gdrive import class_span  # noqa: E402


def main():
    plugin_path, out_path = sys.argv[1], sys.argv[2]
    with open(plugin_path, encoding='utf-8') as f:
        s = f.read()
    a, b = class_span(s)
    klass = s[a:b]

    stubs_url = (Path(__file__).resolve().parent / 'test_stubs.mjs').as_uri()
    module = (
        f"import {{ Mp, r, I, kh, dh, Vp, zp, Th, th, vh, Eh }} from '{stubs_url}';\n\n"
        f"{klass}\n\nexport default Bh;\n"
    )
    with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(module)
    print(out_path)


if __name__ == '__main__':
    main()
