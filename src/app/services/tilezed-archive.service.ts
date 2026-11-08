import { Injectable } from '@angular/core';
import type { Entry, ZipReader } from '@zip.js/zip.js';
import { tilezedSheetName } from '../utils/tilezed-sheets';

export interface TilezedArchiveSheets {
  sheets: Map<string, Blob>;
  errors: Map<string, string>;
}

const MAX_SHEET_BYTES = 64 * 1024 * 1024;
const INDEX_LIFETIME_MS = 5 * 60 * 1000;
// Enough for every published ZIP pack, so enabling them all doesn't evict and re-read directories per building.
const MAX_INDEXES = 8;

/** An HTTP failure, so callers can tell a pack that doesn't exist from a temporary error. */
export class TilepackHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

interface TilepackIndex {
  reader: ZipReader<string>;
  sheets: Map<string, Entry>;
  created: number;
}

function entryPriority(path: string): number {
  const parts = path.replace(/\\/g, '/').split('/');
  const tiles = parts.findIndex(part => part.toLowerCase() === 'tiles');
  if (tiles < 0 || tiles >= parts.length - 1) return -1;
  if (parts[tiles + 1].toLowerCase() === '2x') return 2;
  return tiles === parts.length - 2 ? 1 : 0;
}

@Injectable({ providedIn: 'root' })
export class TilezedArchiveService {
  private readonly indexes = new Map<string, Promise<TilepackIndex>>();

  async load(url: string, names: readonly string[]): Promise<TilezedArchiveSheets> {
    const wanted = new Set(names.map(tilezedSheetName));
    const sheets = new Map<string, Blob>();
    const errors = new Map<string, string>();
    if (!wanted.size) return { sheets, errors };

    const zip = await import('@zip.js/zip.js');
    class RangeReader extends zip.Reader<string> {
      private etag: string | null = null;

      constructor(private readonly source: string) { super(source); }

      override async init(): Promise<void> {
        const response = await fetch(this.source, { method: 'HEAD' });
        if (!response.ok) throw new TilepackHttpError(`Could not inspect tilepack (HTTP ${response.status}).`, response.status);
        const length = response.headers.get('Content-Length');
        const size = length === null ? NaN : Number(length);
        if (!Number.isSafeInteger(size) || size <= 0 || response.headers.has('Content-Encoding')) {
          throw new Error('The tilepack server did not provide a usable archive size.');
        }
        this.size = size;
        this.etag = response.headers.get('ETag');
        await super.init!();
      }

      override async readUint8Array(offset: number, length: number): Promise<Uint8Array> {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 ||
            length > MAX_SHEET_BYTES || offset + length > this.size) {
          throw new Error('The tilepack requested an invalid byte range.');
        }
        if (!length) return new Uint8Array();
        const end = offset + length - 1;
        const response = await fetch(this.source, { headers: { Range: `bytes=${offset}-${end}` } });
        if (response.status !== 206) {
          await response.body?.cancel();
          throw new Error(`The tilepack server does not support partial downloads (HTTP ${response.status}).`);
        }
        const contentRange = response.headers.get('Content-Range');
        if (contentRange) {
          const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(contentRange.trim());
          if (!match || Number(match[1]) !== offset || Number(match[2]) !== end || Number(match[3]) !== this.size) {
            await response.body?.cancel();
            throw new Error('The tilepack server returned an unexpected byte range.');
          }
        }
        const etag = response.headers.get('ETag');
        if (this.etag && etag && this.etag !== etag) {
          await response.body?.cancel();
          throw new Error('The tilepack changed while it was being read. Try opening the map again.');
        }
        if (!response.body) throw new Error('The tilepack returned an empty byte range.');
        const data = new Uint8Array(length);
        const stream = response.body.getReader();
        let received = 0;
        try {
          while (true) {
            const chunk = await stream.read();
            if (chunk.done) break;
            if (chunk.value.length > length - received) {
              await stream.cancel();
              throw new Error('The tilepack returned more data than requested.');
            }
            data.set(chunk.value, received);
            received += chunk.value.length;
          }
        } finally {
          stream.releaseLock();
        }
        if (received !== length) throw new Error('The tilepack returned an incomplete byte range.');
        return data;
      }
    }

    const indexKey = url;
    let request = this.indexes.get(indexKey);
    if (request && Date.now() - (await request).created > INDEX_LIFETIME_MS) {
      const expired = await request;
      await expired.reader.close();
      this.indexes.delete(indexKey);
      request = undefined;
    }
    if (!request) {
      request = (async () => {
        const reader = new zip.ZipReader(new RangeReader(url));
        try {
          const selected = new Map<string, { entry: Entry; priority: number }>();
          for (const entry of await reader.getEntries()) {
            if (entry.directory || !/\.png$/i.test(entry.filename)) continue;
            const name = tilezedSheetName(entry.filename);
            const priority = entryPriority(entry.filename);
            if (priority < 0) continue;
            const previous = selected.get(name);
            if (!previous || priority > previous.priority ||
                (priority === previous.priority && entry.filename.localeCompare(previous.entry.filename) < 0)) {
              selected.set(name, { entry, priority });
            }
          }
          return { reader, sheets: new Map([...selected].map(([name, value]) => [name, value.entry])), created: Date.now() };
        }
        catch (error) { await reader.close(); throw error; }
      })();
      this.indexes.set(indexKey, request);
      if (this.indexes.size > MAX_INDEXES) {
        const oldest = this.indexes.keys().next().value;
        if (oldest !== undefined) {
          const expired = this.indexes.get(oldest)!;
          this.indexes.delete(oldest);
          void expired.then(value => value.reader.close()).catch(error => console.warn('Could not release tilepack index:', error));
        }
      }
    }
    try {
      const index = await request;
      for (const name of wanted) {
        const entry = index.sheets.get(name);
        if (!entry) continue;
        try {
          if (!Number.isSafeInteger(entry.compressedSize) || !Number.isSafeInteger(entry.uncompressedSize) ||
              entry.compressedSize < 0 || entry.uncompressedSize < 0 ||
              entry.compressedSize > MAX_SHEET_BYTES || entry.uncompressedSize > MAX_SHEET_BYTES) {
            throw new Error('The tilesheet exceeds the download size limit.');
          }
          if (!entry.getData) throw new Error('The tilepack entry cannot be read.');
          const chunks: Uint8Array[] = [];
          let size = 0;
          const writer = new WritableStream<Uint8Array>({
            write(chunk) {
              size += chunk.length;
              if (size > entry.uncompressedSize || size > MAX_SHEET_BYTES) {
                throw new Error('The tilesheet exceeds its expected download size.');
              }
              chunks.push(chunk.slice());
            },
          });
          await entry.getData<void>(writer, {
            checkSignature: true,
            useWebWorkers: false,
          });
          if (size !== entry.uncompressedSize) throw new Error('The tilesheet download is incomplete.');
          sheets.set(name, new Blob(chunks, { type: 'image/png' }));
        } catch (error) {
          errors.set(name, error instanceof Error ? error.message : String(error));
        }
      }
      if (errors.size && this.indexes.get(indexKey) === request) {
        this.indexes.delete(indexKey);
        await index.reader.close();
      }
      return { sheets, errors };
    } catch (error) {
      if (this.indexes.get(indexKey) === request) this.indexes.delete(indexKey);
      await request.then(value => value.reader.close(), () => undefined);
      throw error;
    }
  }
}
