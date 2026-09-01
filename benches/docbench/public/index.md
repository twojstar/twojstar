# Doc Bench

> Local-first browser studio for documents and PDFs, designed to edit, inspect and export without uploading source files.

Doc Bench runs at https://docbench.travny.workers.dev/.

## Documents

- Edit TXT, Markdown, JSON, YAML/YML and XML.
- Validate and format structured text.
- Inspect Markdown, JSON, YAML and XML with richer previews.
- Preserve UTF-8 BOM and LF, CRLF or CR line endings unless deliberately changed.
- Save back to a selected local file in supported browsers or download the result.

## PDFs

- Preview PDFs locally.
- Merge files and reorder or delete pages.
- Inspect and edit bookmark trees while remapping targets after page changes.
- Apply lossless optimization, optional lossy image recompression and Fast Web View.
- Rebuild and verify the result before download.

## Privacy and agent access

Files stay in the browser and the application has no telemetry. On WebMCP-capable browser hosts, `read_document`, `set_document_text`, `validate_document`, `format_document` and `inspect_document` operate on the visible editor state. Returned tool results can contain document text and are then subject to the host/model data-handling policy.

## Links

- [Application](https://docbench.travny.workers.dev/)
- [Concise LLM guide](https://docbench.travny.workers.dev/llms.txt)
- [Full LLM guide](https://docbench.travny.workers.dev/llms-full.txt)
- [Source](https://github.com/trvny/trvny/tree/main/benches/docbench)
- [Portable builds](https://github.com/trvny/trvny/releases/tag/benches-portable-latest)
