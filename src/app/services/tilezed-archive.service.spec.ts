import { TilezedArchiveService } from './tilezed-archive.service';

describe('TileZed partial tilepack reader', () => {
  let service: TilezedArchiveService;
  let bytes: Uint8Array;
  let requests: string[];

  beforeEach(async () => {
    const zip = await import('@zip.js/zip.js');
    const writer = new zip.ZipWriter<Blob>(new zip.BlobWriter('application/zip'));
    const options = { level: 0, useWebWorkers: false };
    await writer.add('Tiles/grass_01.png', new zip.TextReader('one-times'), options);
    await writer.add('Tiles/2x/Main.pack/grass_01.png', new zip.TextReader('two-times'), options);
    await writer.add('Tiles/vegetation_01.png', new zip.TextReader('vegetation-pixels-xyz'), options);
    await writer.add('Other/ignored_01.png', new zip.TextReader('not-a-tilesheet'), options);
    bytes = new Uint8Array(await (await writer.close()).arrayBuffer());
    requests = [];
    service = new TilezedArchiveService();
    spyOn(window, 'fetch').and.callFake(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Length': String(bytes.length), ETag: '"test"' } });
      }
      const range = new Headers(init?.headers).get('Range');
      if (!range) throw new Error('A full tilepack download was attempted.');
      requests.push(range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) throw new Error(`Unexpected range: ${range}`);
      const start = Number(match[1]), end = Number(match[2]);
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, ETag: '"test"' },
      });
    });
  });

  it('reads only requested entries and prefers a 2x sheet to its 1x version', async () => {
    const result = await service.load('https://example.test/pack.zip', ['grass_01', 'vegetation_01', 'ignored_01']);

    expect(await result.sheets.get('grass_01')?.text()).toBe('two-times');
    expect(await result.sheets.get('vegetation_01')?.text()).toBe('vegetation-pixels-xyz');
    expect(result.sheets.has('ignored_01')).toBeFalse();
    expect(result.errors.size).toBe(0);
    expect(requests.length).toBeGreaterThan(0);
  });

  it('rejects servers without an archive size rather than downloading the whole pack', async () => {
    (window.fetch as jasmine.Spy).and.resolveTo(new Response(null, { status: 200 }));

    await expectAsync(service.load('https://example.test/pack.zip', ['grass_01']))
      .toBeRejectedWithError(/usable archive size/);
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects servers that ignore range requests', async () => {
    (window.fetch as jasmine.Spy).and.callFake(async (_url, init) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 200, headers: { 'Content-Length': String(bytes.length) } })
        : new Response(bytes, { status: 200 }));

    await expectAsync(service.load('https://example.test/pack.zip', ['grass_01']))
      .toBeRejectedWithError(/does not support partial downloads/);
  });

  it('cancels a partial response that sends more data than requested', async () => {
    let cancelled = false;
    (window.fetch as jasmine.Spy).and.callFake(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Length': String(bytes.length) } });
      }
      const range = new Headers(init?.headers).get('Range');
      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
      if (!match) throw new Error(`Unexpected range: ${range}`);
      const start = Number(match[1]), end = Number(match[2]);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(end - start + 2)); },
        cancel() { cancelled = true; },
      }), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } });
    });

    await expectAsync(service.load('https://example.test/pack.zip', ['grass_01']))
      .toBeRejectedWithError(/more data than requested/);
    expect(cancelled).toBeTrue();
  });

  it('reports a corrupted entry instead of returning it as a valid sheet', async () => {
    const content = new TextEncoder().encode('vegetation-pixels-xyz');
    for (let i = 0; i <= bytes.length - content.length; i++) {
      if (content.every((value, offset) => bytes[i + offset] === value)) {
        bytes[i] ^= 1;
        break;
      }
    }

    const result = await service.load('https://example.test/pack.zip', ['vegetation_01']);

    expect(result.sheets.has('vegetation_01')).toBeFalse();
    expect(result.errors.get('vegetation_01')).toBeTruthy();
  });
});
