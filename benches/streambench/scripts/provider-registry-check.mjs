import {
  PROVIDERS,
  bindProviderHandlers,
  providerById,
  providerManifest,
} from "../src/providers/registry.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(callback, message) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(message);
}

assert(PROVIDERS.length > 0, "provider registry is empty");
assert(new Set(PROVIDERS.map((provider) => provider.id)).size === PROVIDERS.length, "provider ids are not unique");

for (const provider of PROVIDERS) {
  assert(/^[a-z0-9-]+$/.test(provider.id), `invalid provider id: ${provider.id}`);
  assert(providerById(provider.id) === provider, `provider lookup failed: ${provider.id}`);
  assert(Array.isArray(provider.scopes) && provider.scopes.length > 0, `provider has no scopes: ${provider.id}`);

  for (const scope of provider.scopes) {
    assert(scope.id && scope.label && scope.values, `invalid scope in ${provider.id}`);
    assert(typeof scope.default === "string" && scope.default.length > 0, `scope has no default in ${provider.id}`);
  }
}

const manifest = providerManifest();
assert(manifest.length === PROVIDERS.length, "manifest size mismatch");
for (const provider of manifest) {
  assert(provider.endpoints.catalog === `/api/catalog?provider=${provider.id}`, `invalid catalog endpoint: ${provider.id}`);
  assert(provider.endpoints.playlist === `/api/playlist?provider=${provider.id}`, `invalid playlist endpoint: ${provider.id}`);
}

const noop = () => null;
const handlers = Object.fromEntries(PROVIDERS.map((provider) => [
  provider.id,
  { catalog: noop, playlist: noop },
]));
const bound = bindProviderHandlers(handlers);
assert(bound.size === PROVIDERS.length, "bound provider size mismatch");
for (const provider of PROVIDERS) {
  assert(bound.get(provider.id)?.provider === provider, `provider binding failed: ${provider.id}`);
}

const missingHandlers = { ...handlers };
delete missingHandlers[PROVIDERS[0].id];
expectThrow(() => bindProviderHandlers(missingHandlers), "missing provider handlers were accepted");
expectThrow(() => bindProviderHandlers({ ...handlers, extra: { catalog: noop, playlist: noop } }), "extra provider handlers were accepted");

console.log(`provider registry checks passed (${PROVIDERS.length})`);
