const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'TaylorFlow.html'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'assets/phrases/index.js'), 'utf8');

function htmlFunction(name) {
  const line = html.split(/\r?\n/).find(value => value.startsWith(`function ${name}(`));
  assert.ok(line, `TaylorFlow.html must define ${name}`);
  return line;
}

const functions = [
  "const COLLECTION_PHRASE_LEGACY_TOTALS={idioms:24,proverbs:24,quotes:20};",
  htmlFunction('collectionPhraseTotal'),
  htmlFunction('collectionPhrasePrefix'),
  htmlFunction('collectionPhraseMapLegacyProgress'),
  htmlFunction('collectionPhraseProgressData'),
  htmlFunction('collectionPhraseLearnedSet'),
].join('\n');

function createContext(seed) {
  const store = new Map(Object.entries(seed || {}));
  const context = vm.createContext({
    COLLECTION_PHRASE_SETS: {
      idioms: { items: [] },
      proverbs: { items: [] },
      quotes: { items: [] },
    },
    localStorage: {
      getItem: key => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
    },
  });
  context.globalThis = context;
  vm.runInContext(functions, context);
  return { context, store };
}

const originalV1 = JSON.stringify({
  idioms: [0, 1, 23, 24, -1, 1.5],
  proverbs: [0, 23, 24],
  quotes: [0, 19, 20],
});

const fallback = createContext({ 'taylorflow-phrase-study-v1': originalV1 });
let mapped = JSON.parse(JSON.stringify(fallback.context.collectionPhraseProgressData()));
assert.deepEqual(mapped.idioms, ['idm-0001', 'idm-0002', 'idm-0024']);
assert.deepEqual(mapped.proverbs, ['prv-0001', 'prv-0024']);
assert.deepEqual(mapped.quotes, ['qte-0001', 'qte-0020']);
assert.equal(fallback.store.get('taylorflow-phrase-study-v1'), originalV1, 'v1 backup must stay unchanged');
assert.deepEqual(JSON.parse(fallback.store.get('taylorflow-phrase-study-v2')), {
  schemaVersion: 2,
  idioms: ['idm-0001', 'idm-0002', 'idm-0024'],
  proverbs: ['prv-0001', 'prv-0024'],
  quotes: ['qte-0001', 'qte-0020'],
});

const staleMigration = createContext({
  'taylorflow-phrase-study-v1': originalV1,
  'taylorflow-phrase-study-v2': JSON.stringify({ schemaVersion: 2, idioms: [], proverbs: [], quotes: [] }),
});
mapped = JSON.parse(JSON.stringify(staleMigration.context.collectionPhraseProgressData()));
assert.deepEqual(mapped.idioms, ['idm-0001', 'idm-0002', 'idm-0024']);
assert.deepEqual(mapped.proverbs, ['prv-0001', 'prv-0024']);
assert.deepEqual(mapped.quotes, ['qte-0001', 'qte-0020']);
assert.equal(staleMigration.store.get('taylorflow-phrase-study-v1'), originalV1, 'stale migration must keep v1 backup unchanged');

const loaded = createContext({ 'taylorflow-phrase-study-v1': originalV1 });
vm.runInContext(manifest, loaded.context);
assert.equal(loaded.context.collectionPhraseTotal('idioms'), 1000);
assert.equal(loaded.context.collectionPhraseTotal('proverbs'), 400);
assert.equal(loaded.context.collectionPhraseTotal('quotes'), 300);
for (const [id, prefix] of [['idioms', 'idm'], ['proverbs', 'prv'], ['quotes', 'qte']]) {
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/phrases', `${id}.js`), 'utf8'), loaded.context);
  const pack = loaded.context.TF_PHRASE_DATA[id];
  const metadata = loaded.context.TF_PHRASE_INDEX.collections[id];
  assert.equal(pack.items.length, metadata.count, `${id} bundle count must match manifest`);
  assert.equal(metadata.count, metadata.target, `${id} target must be met`);
  for (const [index, item] of pack.items.entries()) {
    assert.equal(item.id, `${prefix}-${String(index + 1).padStart(4, '0')}`, `${id} IDs must remain ordered and stable`);
    assert.equal(item.reviewed, false, `${id} items must not claim teacher review`);
    assert.ok(item.text && item.vi && item.ex && item.exVi, `${id} items must contain all learning text`);
  }
}
mapped = JSON.parse(JSON.stringify(loaded.context.collectionPhraseProgressData()));
const storedV2 = JSON.parse(fallback.store.get('taylorflow-phrase-study-v2'));
assert.deepEqual(mapped, {
  idioms: storedV2.idioms,
  proverbs: storedV2.proverbs,
  quotes: storedV2.quotes,
});
assert.equal(loaded.context.collectionPhraseLearnedSet('idioms', mapped.idioms).size, 3);
assert.equal(loaded.context.collectionPhraseLearnedSet('proverbs', mapped.proverbs).size, 2);
assert.equal(loaded.context.collectionPhraseLearnedSet('quotes', mapped.quotes).size, 2);
assert.equal(loaded.store.get('taylorflow-phrase-study-v1'), originalV1, 'loading manifest must not alter v1 backup');

const manifestTag = '<script src="./assets/phrases/index.js"';
const tagIndex = html.indexOf(manifestTag);
const collectionDefinitionIndex = html.indexOf('const COLLECTION_PHRASE_SETS=');
assert.ok(tagIndex >= 0 && tagIndex < collectionDefinitionIndex, 'manifest must load before application initialization');
const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
assert.match(serviceWorker, /\['index\.js','idioms\.js','proverbs\.js','quotes\.js'\]/, 'service worker must precache phrase packs');
assert.match(serviceWorker, /epu-pwa-v\d+/);

console.log('Phrase progress regression passed: legacy indices preserved, stale empty v2 recovered, stable IDs retained, v1 backup unchanged, manifest counts available.');
