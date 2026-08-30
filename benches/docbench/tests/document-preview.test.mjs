import assert from "node:assert/strict";
import jsoncParser from "jsonc-parser";
import * as yaml from "js-yaml";

const { parseTree } = jsoncParser;
const source = `{
  "huge": 9007199254740993,
  "exponent": 1e400,
  "escaped": "\\u0061"
}`;
const errors = [];
const root = parseTree(source, errors, {
  allowTrailingComma: false,
  disallowComments: true,
});

assert.ok(root);
assert.deepEqual(errors, []);
assert.equal(root.type, "object");

function propertyValue(name) {
  const property = root.children.find((node) => node.children?.[0]?.value === name);
  assert.ok(property, `missing ${name} property`);
  return property.children[1];
}

function lexeme(node) {
  return source.slice(node.offset, node.offset + node.length);
}
assert.equal(lexeme(propertyValue("huge")), "9007199254740993");
assert.equal(lexeme(propertyValue("exponent")), "1e400");
assert.equal(lexeme(propertyValue("escaped")), '"\\u0061"');
assert.notEqual(JSON.parse(source).huge.toString(), lexeme(propertyValue("huge")));

const yamlSource = [
  "defaults: &d",
  "  huge: 9007199254740993",
  "created: 2020-01-01",
  "copy:",
  "  <<: *d",
].join("\n");
const schema = yaml.CORE_SCHEMA.withTags(yaml.mergeTag, yaml.timestampTag);
const [yamlDocument] = yaml.eventsToAst(yaml.parseEvents(yamlSource), {
  source: yamlSource,
  schema,
});

function mappingValue(mapping, key) {
  const pair = mapping.items.find((item) => item.key?.value === key);
  assert.ok(pair, `missing ${key} YAML key`);
  return pair.value;
}

const defaults = mappingValue(yamlDocument.contents, "defaults");
const huge = mappingValue(defaults, "huge");
assert.equal(huge.kind, "scalar");
assert.equal(huge.tag, "tag:yaml.org,2002:int");
assert.equal(huge.value, "9007199254740993");

const created = mappingValue(yamlDocument.contents, "created");
assert.equal(created.tag, "tag:yaml.org,2002:timestamp");
assert.equal(created.value, "2020-01-01");

const copy = mappingValue(yamlDocument.contents, "copy");
const merge = copy.items.find((item) => item.key?.value === "<<");
assert.ok(merge, "missing YAML merge key");
assert.equal(merge.key.tag, "tag:yaml.org,2002:merge");
assert.equal(merge.value.kind, "alias");
assert.equal(merge.value.anchor, "d");

const explicitYaml = yaml.eventsToAst(
  yaml.parseEvents("count: !!int 12\nenabled: !!bool false"),
  { source: "count: !!int 12\nenabled: !!bool false", schema },
)[0].contents;
assert.equal(mappingValue(explicitYaml, "count").tag, "!!int");
assert.equal(mappingValue(explicitYaml, "enabled").tag, "!!bool");

const complexYaml = yaml.eventsToAst(
  yaml.parseEvents("? [tenant, id]\n: value"),
  { source: "? [tenant, id]\n: value", schema },
)[0].contents;
assert.equal(complexYaml.items[0].key.kind, "sequence");
assert.deepEqual(complexYaml.items[0].key.items.map((item) => item.value), ["tenant", "id"]);

console.log("Doc Bench document preview tests passed.");
