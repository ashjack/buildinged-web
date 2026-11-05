import { TestBed } from '@angular/core/testing';
import { FURNITURE_TILE_MIME, FurnitureCellComponent, FurnitureCellDrop, furnitureTileDrag } from './furniture-cell.component';

describe('FurnitureCellComponent', () => {
  let component: FurnitureCellComponent;
  let canvas: HTMLCanvasElement;
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ declarations: [FurnitureCellComponent] });
    const fixture = TestBed.createComponent(FurnitureCellComponent);
    component = fixture.componentInstance;
    component.scale = .5;
    host = fixture.nativeElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    component.ngOnChanges();
    canvas = host.querySelector('canvas')!;
  });

  afterEach(() => { host.remove(); furnitureTileDrag.tiles = null; });

  const drag = (type: string, x: number, y: number) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(FURNITURE_TILE_MIME, '["fridge_000"]');
    const event = new DragEvent(type, { clientX: x, clientY: y, dataTransfer, cancelable: true, bubbles: true });
    canvas.dispatchEvent(event);
    return event;
  };

  // At scale .5 an empty cell has a 2x2 grid whose square 0,0 is centred 35px right and 59px down from its corner.
  it('only accepts tile drags over a grid diamond', () => {
    const rect = canvas.getBoundingClientRect();
    expect(drag('dragover', rect.left + 35, rect.top + 59).defaultPrevented).toBeTrue();
    expect(drag('dragover', rect.left + 35, rect.top + 10).defaultPrevented).toBeFalse();
    expect(drag('dragover', rect.left + 2, rect.top + 59).defaultPrevented).toBeFalse();
  });

  it('drops onto the diamond under the pointer and ignores drops elsewhere', () => {
    const drops: FurnitureCellDrop[] = [];
    component.dropped.subscribe(drop => drops.push(drop));
    const rect = canvas.getBoundingClientRect();
    drag('drop', rect.left + 35, rect.top + 10);
    expect(drops).toEqual([]);
    drag('drop', rect.left + 35, rect.top + 59);
    expect(drops).toEqual([{ x: 0, y: 0, tiles: ['fridge_000'] }]);
  });

  it('accepts and drops tiles even when the browser drops the custom drag data', () => {
    const drops: FurnitureCellDrop[] = [];
    component.dropped.subscribe(drop => drops.push(drop));
    furnitureTileDrag.tiles = ['fridge_001', 'fridge_002'];
    const rect = canvas.getBoundingClientRect();
    const send = (type: string) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/uri-list', 'blob:tile');
      dataTransfer.setData('text/html', '<img>');
      const event = new DragEvent(type, { clientX: rect.left + rect.width / 2, clientY: rect.bottom - 10, dataTransfer, cancelable: true });
      canvas.dispatchEvent(event);
      return event;
    };
    expect(send('dragover').defaultPrevented).toBeTrue();
    send('drop');
    expect(drops.length).toBe(1);
    expect(drops[0].tiles).toEqual(['fridge_001', 'fridge_002']);
    expect(furnitureTileDrag.tiles).toBeNull();
  });

  it('ignores drags that are not tiles', () => {
    const rect = canvas.getBoundingClientRect();
    const event = new DragEvent('dragover', { clientX: rect.left + 10, clientY: rect.top + 10, dataTransfer: new DataTransfer(), cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBeFalse();
  });
});
