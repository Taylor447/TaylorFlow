import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets', 'tests');
const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
const writeFallback = async (name, value) => {
  const serialized = JSON.stringify(value).replace(/</g, '\\u003c');
  await writeFile(path.join(dir, name), 'window.TF_TEST_DATA=window.TF_TEST_DATA||{};window.TF_TEST_DATA[' +
    JSON.stringify(value.id || 'index') + ']=' + serialized + ';', 'utf8');
};
await writeFallback('index.js', index);
for (const meta of index.tests) {
  if (meta.status !== 'ready') continue;
  const data = JSON.parse(await readFile(path.join(dir, meta.id + '.json'), 'utf8'));
  await writeFallback(meta.id + '.js', data);
}
console.log('Đã tạo bản dự phòng offline cho danh mục và ' + index.tests.filter(x => x.status === 'ready').length + ' đề.');
