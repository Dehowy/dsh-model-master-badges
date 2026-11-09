/**
 * Minimal POSIX (ustar) tar writer + lister, in pure JavaScript.
 *
 * Why not shell out to `npm pack` / `tar`? Under a sandboxed DSH workspace a
 * child process that captures another program's output through piped stdio is
 * killed with EPERM before it starts — `spawnSync('npm', …)` and even
 * `spawnSync('tar', ['--version'])` both fail. Building and reading the archive
 * in-process keeps packaging deterministic and works everywhere Node runs.
 */
import zlib from 'node:zlib'

const BLOCK = 512

function header({ name, size, mode = 0o644, mtime = 0 }) {
  const buf = Buffer.alloc(BLOCK, 0)
  const put = (str, offset, length) => {
    const bytes = Buffer.from(str, 'utf8')
    if (bytes.length > length) throw new Error(`tar field overflow: ${str}`)
    bytes.copy(buf, offset)
  }
  put(name, 0, 100)
  put(mode.toString(8).padStart(7, '0') + '\0', 100, 8)
  put('0000000\0', 108, 8) // uid
  put('0000000\0', 116, 8) // gid
  put(size.toString(8).padStart(11, '0') + '\0', 124, 12)
  put(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136, 12)
  buf.fill(0x20, 148, 156) // checksum placeholder = spaces
  put('0', 156, 1) // typeflag: regular file
  put('ustar\0', 257, 6)
  put('00', 263, 2)

  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += buf[i]
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return buf
}

/** @param {{path: string, data: Buffer}[]} entries paths are archive-relative */
export function createTarGz(entries) {
  const chunks = []
  for (const entry of entries) {
    if (entry.data.length > 0o7777777777) throw new Error(`file too large for ustar: ${entry.path}`)
    chunks.push(header({ name: `package/${entry.path}`, size: entry.data.length, mtime: Date.now() }))
    chunks.push(entry.data)
    const pad = entry.data.length % BLOCK
    if (pad) chunks.push(Buffer.alloc(BLOCK - pad, 0))
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0)) // end-of-archive marker
  return zlib.gzipSync(Buffer.concat(chunks), { level: 9 })
}

/** Parse a .tgz and return the archived paths, for verifying what we built. */
export function listTarGz(buffer) {
  const tar = zlib.gunzipSync(buffer)
  const names = []
  let offset = 0
  while (offset + BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + BLOCK)
    if (block.every(b => b === 0)) break // end-of-archive
    const name = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const size = parseInt(block.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0
    const typeflag = String.fromCharCode(block[156])
    if (!name) throw new Error(`corrupt tar header at offset ${offset}`)
    if (typeflag === '0' || typeflag === '\0') names.push(prefix ? `${prefix}/${name}` : name)
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK
  }
  return names
}
