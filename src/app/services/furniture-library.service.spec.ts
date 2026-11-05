import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { BUNDLED_FURNITURE_URL, FURNITURE_URL, FurnitureLibraryService } from './furniture-library.service';
import { BFurnitureGroup } from '../models/furniture-window.models';

const file = (label: string, revision = 1) => `version = 0
revision = ${revision}
source_revision = 0
group
{
    label = ${label}
    furniture
    {
        entry
        {
            orient = W
            0,0 = chair_0
        }
    }
}
`;

describe('FurnitureLibraryService', () => {
  let service: FurnitureLibraryService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(FurnitureLibraryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    service.ngOnDestroy();
    http.verify();
  });

  const flushPending = () => new Promise(resolve => setTimeout(resolve));

  it('loads the published list once and shares it', async () => {
    const first = service.load();
    const second = service.load();
    const request = http.expectOne(FURNITURE_URL);
    expect(request.request.headers.get('Cache-Control')).toBe('no-cache');
    request.flush(file('Published', 4));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a.document.revision).toBe(4);
    expect(a.document.groups[0].label).toBe('Published');
  });

  it('falls back to the bundled copy when nothing is published', async () => {
    const loading = service.load();
    http.expectOne(FURNITURE_URL).flush('missing', { status: 404, statusText: 'Not Found' });
    await flushPending();
    http.expectOne(BUNDLED_FURNITURE_URL).flush(file('Bundled'));
    expect((await loading).document.groups[0].label).toBe('Bundled');
  });

  it('emits again only when a refresh finds a different list', async () => {
    const seen: BFurnitureGroup[][] = [];
    service.groups$.subscribe(groups => seen.push(groups));
    const loading = service.load();
    http.expectOne(FURNITURE_URL).flush(file('One'));
    await loading;

    const same = service.refresh(true);
    http.expectOne(FURNITURE_URL).flush(file('One'));
    await same;
    expect(seen.length).toBe(1);

    const changed = service.refresh(true);
    http.expectOne(FURNITURE_URL).flush(file('Two'));
    await changed;
    expect(seen.map(groups => groups[0].label)).toEqual(['One', 'Two']);
  });

  it('does not refetch within a minute unless forced', async () => {
    const loading = service.load();
    http.expectOne(FURNITURE_URL).flush(file('One'));
    const library = await loading;
    expect(await service.refresh()).toBe(library);
    http.expectNone(FURNITURE_URL);
  });
});
