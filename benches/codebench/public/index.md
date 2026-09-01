# Code Bench

> Local-first browser studio for generating, styling, scanning and exporting QR codes and barcodes.

Code Bench is available at https://codebench.trfny.com/. User-entered code payloads are processed in the browser instead of uploaded to a Code Bench backend.

## What it does

- Generate and style QR codes, including structured Wi-Fi, contact and event payloads.
- Generate Code 128, EAN, Data Matrix, Aztec, PDF417 and other barcode formats.
- Scan QR codes and barcodes from local files or the camera when browser permissions allow it.
- Export generated codes as PNG, SVG, WebP, JPEG and terminal-friendly output where supported.
- Use the portable build for offline/local operation.

## Agent access

On browser hosts that implement WebMCP, Code Bench exposes `read_code_state`, `set_qr_code`, `set_barcode` and `export_code`. These tools reuse the visible application state and do not turn Code Bench into a remote payload store.

## Links

- [Application](https://codebench.trfny.com/)
- [Concise LLM guide](https://codebench.trfny.com/llms.txt)
- [Full LLM guide](https://codebench.trfny.com/llms-full.txt)
- [Source](https://github.com/trvny/trvny/tree/main/benches/codebench)
- [TRAVNY hub](https://trfny.com/)
