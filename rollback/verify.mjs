import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

for (const file of ['assets/js/catalog.js', 'assets/js/shell.js', 'assets/js/world.js', 'assets/js/app.js', 'assets/js/app.legacy.js', 'assets/js/world.legacy.js']) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) fail(`${file} 语法错误\n${check.stderr}`);
}

const manifest = readFileSync('rollback/v1/SHA256SUMS', 'utf8').trim().split('\n');
for (const line of manifest) {
  const [hash, file] = line.split(/\s+/, 2);
  if (sha256(file) !== hash) fail(`备份指纹不符: ${file}`);
}
if (sha256('assets/css/world.legacy.css') !== sha256('rollback/v1/world.css')) fail('world.legacy.css 与备份不一致');
if (sha256('assets/js/app.legacy.js') !== sha256('rollback/v1/app.js')) fail('app.legacy.js 与备份不一致');
if (sha256('assets/js/world.legacy.js') !== sha256('rollback/v1/world.js')) fail('world.legacy.js 与备份不一致');

const legacyHtml = readFileSync('index.legacy.html', 'utf8');
if (!legacyHtml.includes('assets/js/world.legacy.js') || !legacyHtml.includes('assets/css/world.legacy.css') || !legacyHtml.includes('index.html')) {
  fail('index.legacy.html 没有指向备份脚本或新版入口');
}

const context = { window: {} };
vm.createContext(context);
vm.runInContext(readFileSync('assets/js/data.js', 'utf8'), context);
vm.runInContext(readFileSync('assets/js/catalog.js', 'utf8'), context);
const { SITE_DATA: data, CATALOG: catalog } = context.window;

if (catalog.counts.total !== data.counts.total || catalog.counts.xhs !== data.counts.xhs || catalog.counts.bili !== data.counts.bili) {
  fail(`数量不一致 catalog=${JSON.stringify(catalog.counts)} data=${JSON.stringify(data.counts)}`);
}
if (catalog.counts.total !== 74 || catalog.counts.xhs !== 32 || catalog.counts.bili !== 42 || catalog.featured.length !== 6) {
  fail('作品数量或精选数量异常');
}

const ids = new Set();
for (const item of data.items) {
  if (ids.has(item.id)) fail(`重复 ID ${item.id}`);
  ids.add(item.id);
  if (!existsSync(item.image)) fail(`缺少封面 ${item.image}`);
  if (!existsSync(item.texture)) fail(`缺少贴图 ${item.texture}`);
  if (!catalog.byId.get(item.id)) fail(`目录缺少 ${item.id}`);
}
for (const id of data.featuredIds) {
  if (!catalog.byId.has(id)) fail(`精选不存在 ${id}`);
}

const referencedImages = new Set(data.items.map((item) => item.image.split('/').pop()));
referencedImages.add('avatar.webp');
referencedImages.add('bili-avatar.webp');
for (const file of readdirSync('assets/images')) {
  if (!referencedImages.has(file)) fail(`封面没有被使用 ${file}`);
}
const referencedTextures = new Set([...data.items.map((item) => item.texture.split('/').pop()), 'sphere.js']);
for (const file of readdirSync('assets/textures')) {
  if (!referencedTextures.has(file)) fail(`贴图没有被使用 ${file}`);
}

const page = `${readFileSync('index.html', 'utf8')}\n${readFileSync('assets/js/shell.js', 'utf8')}`;
for (const asset of ['assets/images/avatar.webp', 'assets/images/bili-avatar.webp', 'assets/audio/starlit-steps.wav', 'assets/lib/three-bundle.js', 'assets/textures/sphere.js']) {
  if (!page.includes(asset) && asset !== 'assets/textures/sphere.js' && asset !== 'assets/lib/three-bundle.js') fail(`页面没有引用 ${asset}`);
}
if (!readFileSync('assets/js/world.js', 'utf8').includes('assets/textures/sphere.js')) fail('展馆没有加载球面贴图');
if (!readFileSync('index.html', 'utf8').includes('assets/lib/three-bundle.js')) fail('页面没有加载 three.js');

const opening = catalog.search('开箱');
const gbc = catalog.search('GBC');
const rabbit = catalog.search('兔兔');
const bili = catalog.search('B站');
const bv = catalog.search('BV1uTsHzsEqF');
if (!opening.length || !gbc.length || !rabbit.length || bili.length !== 42 || bv.length !== 1) {
  fail(`搜索结果异常 开箱=${opening.length} GBC=${gbc.length} 兔兔=${rabbit.length} B站=${bili.length} BV=${bv.length}`);
}
if (catalog.filterItems('cat:日常').length === 0) fail('日常分类为空');
if (!catalog.knownFilter('cat:chiikawa') || catalog.knownFilter('cat:不存在')) fail('筛选识别异常');
const first = catalog.items[0];
const around = catalog.neighbors(first, catalog.items);
if (around.next.id !== catalog.items[1].id || around.prev.id !== catalog.items.at(-1).id) fail('前后作品没有首尾相接');

if (process.exitCode) process.exit(process.exitCode);
console.log(`ok ${catalog.counts.total} works, backup fingerprints match`);
