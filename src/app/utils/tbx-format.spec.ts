import { readBuildingFile, writeBuildingFile } from './tbx-format';
import { emptyIndexGrid, readIndexGrid, writeIndexGrid } from './tbx-grid';

import { nativeBuildingXml } from '../testing/native-building.fixture';

const parse = (text: string) => new DOMParser().parseFromString(text, 'text/xml');
const roundTrip = (text: string) => readBuildingFile(parse(new XMLSerializer().serializeToString(writeBuildingFile(readBuildingFile(parse(text))))));

describe('TBX file compatibility', () => {
    it('round-trips native metadata, offsets, definitions and palette order', () => {
        const building = roundTrip(nativeBuildingXml);
        expect(building.version).toBe(3);
        expect(building.properties).toEqual({ empty: '', label: 'A & B <C>', notes: 'first line\nsecond line' });
        expect(building.entries[0].tiles[0].offset).toBe('1 -2');
        expect(building.furniture[1].corners).toBeTrue();
        expect(building.furniture[1].layer).toBe('Walls');
        expect(building.furniture[1].entries[0].grime).toBeFalse();
        expect(building.floors[0].objects[0].FurnitureTiles).toBe('1');
        expect(building.used_furniture).toBe('1 0');
        expect(building.floors[0].objects[1].FrameTile).toBe('0');
    });

    it('exports exactly the native room and tile cell counts with valid comma separators', () => {
        const xml = writeBuildingFile(readBuildingFile(parse(nativeBuildingXml)));
        const rooms = xml.getElementsByTagName('rooms')[0].textContent!.trim().split(',');
        const tiles = xml.getElementsByTagName('tiles')[0].textContent!.trim().split(',');
        expect(rooms.length).toBe(4);
        expect(tiles.length).toBe(9);
        expect(rooms.every(value => /^\d+$/.test(value.trim()))).toBeTrue();
        expect(tiles.every(value => /^\d+$/.test(value.trim()))).toBeTrue();
        expect(rooms.map(Number)).toEqual([1, 0, 0, 1]);
        expect(tiles.map(Number)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    });

    it('upgrades native version 2 on export', () => {
        expect(roundTrip(nativeBuildingXml.replace('version="3"', 'version="2"')).version).toBe(3);
    });

    it('recovers old web version 0 grids and drops only an empty room border', () => {
        const xml = parse(nativeBuildingXml.replace('version="3"', 'version="0"'));
        xml.getElementsByTagName('rooms')[0].textContent = '\n1,0,0\n0,1,0\n0,0,0\n';
        xml.getElementsByTagName('tiles')[0].textContent = '\n1,0,0\n0,1,0\n0,0,1\n';
        const building = readBuildingFile(xml);
        expect(building.version).toBe(3);
        expect(readIndexGrid(building.floors[0].rooms, 2, 2)).toEqual([[1, 0], [0, 1]]);
        expect(readIndexGrid(building.floors[0].tileLayers![0].tiles, 3, 3)[2][2]).toBe(1);
    });

    it('rejects malformed XML and unsupported versions instead of relabeling them', () => {
        expect(() => readBuildingFile(parse('<building>'))).toThrowError(/valid TBX/);
        expect(() => readBuildingFile(parse(nativeBuildingXml.replace('version="3"', 'version="99"')))).toThrowError(/Unsupported/);
        expect(() => readBuildingFile(parse(nativeBuildingXml.replace('version="3"', 'version="1.0"')))).toThrowError(/desktop BuildingEd/);
    });

    it('rejects dangling tile, room and zero-based furniture references', () => {
        expect(() => roundTrip(nativeBuildingXml.replace('Door="1"', 'Door="2"'))).toThrowError(/Door index/);
        expect(() => roundTrip(nativeBuildingXml.replace('FurnitureTiles="1"', 'FurnitureTiles="2"'))).toThrowError(/FurnitureTiles index/);
        expect(() => roundTrip(nativeBuildingXml.replace('1,0,\n0,1', '1,0,\n0,2'))).toThrowError(/room index/);
        expect(() => roundTrip(nativeBuildingXml.replace('1,0,0,', '2,0,0,'))).toThrowError(/user tile index/);
    });

    it('excludes runtime UIDs and does not mutate the source while exporting', () => {
        const building = readBuildingFile(parse(nativeBuildingXml));
        const before = JSON.stringify(building);
        const xml = writeBuildingFile(building);
        expect(xml.getElementsByTagName('object')[0].hasAttribute('uid')).toBeFalse();
        expect(JSON.stringify(building)).toBe(before);
    });
});

describe('TBX index grids', () => {
    it('reads native CSV independently of line breaks', () => {
        expect(readIndexGrid('1,0,0,1', 2, 2)).toEqual([[1, 0], [0, 1]]);
        expect(readIndexGrid('\r\n1,\r\n0,0,\r\n1\r\n', 2, 2)).toEqual([[1, 0], [0, 1]]);
        expect(writeIndexGrid(emptyIndexGrid(2, 2))).toBe('\n0,0,\n0,0\n');
    });

    it('rejects corrupt indices, cell counts, and occupied legacy borders', () => {
        expect(() => readIndexGrid('1,,0,1', 2, 2)).toThrowError();
        expect(() => readIndexGrid('1,0,0', 2, 2)).toThrowError(/expected 4/);
        expect(() => readIndexGrid('1,0\n-1,0', 2, 2)).toThrowError();
        expect(() => readIndexGrid('1,0,0\n0,1,0\n0,0,1', 2, 2, true)).toThrowError(/outside/);
    });
});
