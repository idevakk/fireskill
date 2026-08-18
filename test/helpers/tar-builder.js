/**
 * Minimal ustar archive builder for tests. Used to craft hostile and benign
 * tarballs without depending on the network or on the `tar` package itself.
 */

/**
 * Build a single 512-byte ustar header + data blocks.
 * @param {object} opts
 * @param {string} opts.name  entry path (<=100 chars)
 * @param {string} [opts.type]  '0' file, '5' directory, '2' symlink
 * @param {string|Buffer} [opts.data]  file content
 * @param {string} [opts.linkname]  symlink target
 * @param {number} [opts.mode]
 */
export function tarEntry({ name, type = '0', data = '', linkname = '', mode = 0o644 }) {
  const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const header = Buffer.alloc(512);

  header.write(name, 0, 'utf8'); // name (100)
  header.write(mode.toString(8).padStart(7, '0'), 100, 'ascii'); // mode (8)
  header.write('0000000', 108, 'ascii'); // uid
  header.write('0000000', 116, 'ascii'); // gid
  header.write(body.length.toString(8).padStart(11, '0'), 124, 'ascii'); // size
  header.write('00000000000', 136, 'ascii'); // mtime
  header.write('        ', 148, 'ascii'); // chksum placeholder (8 spaces)
  header.write(type, 156, 'ascii'); // typeflag
  header.write(linkname, 157, 'utf8'); // linkname (100)
  header.write('ustar', 257, 'ascii'); // magic
  header.write('00', 263, 'ascii'); // version
  header.write('root', 265, 'ascii'); // uname
  header.write('root', 297, 'ascii'); // gname

  // checksum: sum of all bytes with the chksum field treated as spaces
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');

  const padded = body.length > 0 ? Buffer.alloc(Math.ceil(body.length / 512) * 512) : Buffer.alloc(0);
  body.copy(padded);
  return Buffer.concat([header, padded]);
}

/**
 * Concatenate entries and append the two zero-block end-of-archive markers.
 * @param {Array<Buffer>} entries
 * @returns {Buffer} an uncompressed tar stream.
 */
export function tarArchive(entries) {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

/**
 * Build a GitHub-style archive whose entries all live under one top-level
 * directory (like real archive tarball roots), because
 * `extractAndValidateArchive` always strips one path component.
 */
import { gzipSync } from 'zlib';

/**
 * Build a GitHub-style (gzipped, single-root-dir) archive whose entries all
 * live under one top-level directory, because `extractAndValidateArchive`
 * always strips one path component.
 */
/**
 * Build a GitHub-style (gzipped, single-root-dir) archive. Accepts plain
 * entry descriptors (same shape as tarEntry options: { name, type, data,
 * linkname, mode }) and wraps them under one top-level directory, because
 * `extractAndValidateArchive` always strips one path component.
 */
export function gitHubStyleArchive(entries, rootDir = 'root') {
  const prefixed = entries.map((e) => ({
    ...e,
    name: String(e.name || '').replace(/^\//, ''),
  })).map((f) => ({
    ...f,
    name: f.name === '' ? rootDir : `${rootDir}/${f.name}`,
  }));
  return gzipSync(tarArchive([
    tarEntry({ name: rootDir, type: '5' }),
    ...prefixed.map(tarEntry),
  ]));
}