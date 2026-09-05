# twojstar

Organization workshop for shared tools, experiments, Workers, and projects that
benefit from one maintained home instead of another tiny repository.

## Bench family

The first migrated workspace is [`benches/`](benches/):

- [Codebench](benches/codebench/) · https://codebench.trfny.com
- [Docbench](benches/docbench/) · https://docbench.travny.workers.dev
- [Streambench](benches/streambench/) · https://streambench.trfny.com

The Bench workspace was extracted from [`trvny/trvny`](https://github.com/trvny/trvny)
with its filtered Git history preserved. Its existing Cloudflare Workers remain
separate deployments and keep their current public endpoints.

## License

The repository-level license is [Apache-2.0](LICENSE). Migrated Bench code keeps
its original [ISC license](benches/LICENSE).
