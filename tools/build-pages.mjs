import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
if (dirname(output) !== root) throw new Error('Output outside project');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// 只部署已追蹤的公開網頁與資產；Worker、測試、本機截圖不屬公開檔案。
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const publicFiles = files.filter(path => path === '_redirects' ||
  (!path.includes('/') && /\.(html|js|json|png|jpg|jpeg|svg|ico|css)$/i.test(path)) ||
  /^(assets|shared|圖庫|unused)\/.*\.(html|js|json|css|png|jpg|jpeg|webp|svg|ico|gif)$/i.test(path));
for (const path of publicFiles) {
  await mkdir(dirname(join(output, path)), { recursive: true });
  await copyFile(join(root, path), join(output, path));
}
await writeFile(join(output, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }));
console.log(`Built ${publicFiles.length} public files in dist/; Functions are compiled from functions/.`);
