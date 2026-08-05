import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(projectRoot, '../..');
const distDirectory = join(projectRoot, 'dist');

const walkFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });

const convertStylesheetLinks = (html) =>
  html.replace(/<link\b[^>]*>/g, (tag) => {
    if (!/\brel=["']stylesheet["']/.test(tag)) return tag;
    const href = tag.match(/\bhref=["']([^"']+)["']/)?.[1];
    return href ? `<style src="${href}"/>` : tag;
  });

const indexPath = join(distDirectory, 'index.html');
const indexHtml = convertStylesheetLinks(readFileSync(indexPath, 'utf8'));
writeFileSync(indexPath, indexHtml, 'utf8');

const windowsHtml = indexHtml.replace('<html', '<html window-frame="solid"');
writeFileSync(join(distDirectory, 'index_windows.html'), windowsHtml, 'utf8');

for (const file of walkFiles(distDirectory)) {
  if (extname(file) !== '.css') continue;
  const css = readFileSync(file, 'utf8').replace(/! important/g, ' !important');
  writeFileSync(file, css, 'utf8');
}

const packfolder =
  process.platform === 'win32'
    ? join(repositoryRoot, 'sciter/packfolder.exe')
    : join(repositoryRoot, 'sciter/packfolder-mac');
const archivePath = join(repositoryRoot, 'resources/dist.rc');

execFileSync(packfolder, [distDirectory, archivePath, '-binary'], {
  stdio: 'inherit',
});

console.log(`Packed Sciter UI archive: ${archivePath}`);
