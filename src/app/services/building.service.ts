import { Injectable } from "@angular/core";
import { Building, FloorTiles, Furniture, FurnitureTileEntry, Tile, TileEntry } from "../models/app.models";
import { DbService } from "./db.service";
import { TileService } from "./tile.service";
import { FurnitureService } from "./furniture.service";
import { GridService } from "./grid.service";
import ToolDrawRoom from "../tools/tool-draw-room";
import { RoomService } from "./room.service";

@Injectable({
    providedIn: 'root',
  })
export class BuildingService {
    building: Building;
    constructor(
        private db: DbService, 
        private tileService: TileService, 
        private furnitureService: FurnitureService, 
        private gridService: GridService,
        private roomService: RoomService) { }

    getBuilding(): Building {
        return this.building;
    }

    async createBuildingFromXml(xmlDoc: Document) {
        const bEl = xmlDoc.getElementsByTagName('building')[0];

        this.building = {
            version: this.getAttr('version', bEl),
            width: this.getAttr('width', bEl),
            height: this.getAttr('height', bEl),
            ExteriorWall: this.getAttr('ExteriorWall', bEl),
            ExteriorWallTrim: this.getAttr('ExteriorWallTrim', bEl),
            Door: this.getAttr('Door', bEl),
            DoorFrame: this.getAttr('DoorFrame', bEl),
            Window: this.getAttr('Window', bEl),
            Curtains: this.getAttr('Curtains', bEl),
            Shutters: this.getAttr('Shutters', bEl),
            Stairs: this.getAttr('Stairs', bEl),
            RoofCap: this.getAttr('RoofCap', bEl),
            RoofSlope: this.getAttr('RoofSlope', bEl),
            RoofTop: this.getAttr('RoofTop', bEl),
            GrimeWall: this.getAttr('GrimeWall', bEl),
            entries: [],
            furniture: [],
            user_tiles: [],
            used_tiles: '',
            used_furniture: '',
            rooms: [],
            floors: [],
        };

        const entries = bEl.getElementsByTagName('tile_entry');
        const furniture = bEl.getElementsByTagName('furniture');
        const user_tiles = bEl.getElementsByTagName('user_tiles')[0];
        const used_tiles = bEl.getElementsByTagName('used_tiles')[0];
        const used_furniture = bEl.getElementsByTagName('used_furniture')[0];
        const rooms = bEl.getElementsByTagName('room');
        const floors = bEl.getElementsByTagName('floor');

        // entries
        for(let i = 0; i < entries.length; i++)
        {
            const entry = entries[i];
            const category = entry.getAttribute('category')!;
            const tiles = entry.getElementsByTagName('tile');
            const tileObjects: Tile[] = [];

            for(let j = 0; j < tiles.length; j++)
            {
                const tile = tiles[j];
                const tileEnum = tile.getAttribute('enum');
                const tileOffset = tile.getAttribute('offset');

                const tileObject: Tile = {
                    tile: tile.getAttribute('tile') ?? '',
                };

                tileEnum != null && (tileObject.enum = tileEnum);
                tileOffset != null && (tileObject.offset = tileOffset);

                tileObjects.push(tileObject);
            }

            this.building.entries.push({
                category: category,
                tiles: tileObjects,
            });
        }

        // furniture
        for(let i = 0; i < furniture.length; i++)
        {
            const furn = furniture[i];
            const furnEnum = furn.getAttribute('layer');
            const entries = furn.getElementsByTagName('entry');
            const entryObjects: FurnitureTileEntry[] = [];

            for(let j = 0; j < entries.length; j++)
            {
                const orient = entries[j].getAttribute('orient');
                const tiles = entries[j].getElementsByTagName('tile');
                const tileObjects = [];

                for(let k = 0; k < tiles.length; k++)
                {
                    const tile = tiles[k];
                    const x = tile.getAttribute('x');
                    const y = tile.getAttribute('y');
                    const name = tile.getAttribute('name');

                    tileObjects.push({
                        x: Number.parseInt(x!),
                        y: Number.parseInt(y!),
                        name: name!,
                    });
                }

                entryObjects.push({
                    orient: orient!,
                    tiles: tileObjects,
                });
            }

            const furnitureObject: Furniture = {
                entries: entryObjects,
            };
            furnEnum != null && (furnitureObject.layer = furnEnum);

            this.building.furniture.push(furnitureObject);
        }

        // user_tiles
        for(let i = 0; i < user_tiles.children.length; i++)
        {
            const tile = user_tiles.children[i];
            const tileAttr = tile.getAttribute('tile');

            this.building.user_tiles.push({
                tile: tileAttr!,
            });
        }

        // used_tiles
        this.building.used_tiles = used_tiles.textContent!;

        // used_furniture
        this.building.used_furniture = used_furniture.textContent!;

        // rooms
        for(let i = 0; i < rooms.length; i++)
        {
            const room = rooms[i];
            const name = room.getAttribute('Name');
            const internamName = room.getAttribute('InternalName');
            const color = room.getAttribute('Color');
            const interiorWall = room.getAttribute('InteriorWall');
            const interiorWallTrim = room.getAttribute('InteriorWallTrim');
            const floor = room.getAttribute('Floor');
            const grimeFloor = room.getAttribute('GrimeFloor');
            const grimeWall = room.getAttribute('GrimeWall');

            this.building.rooms.push({
                Name: name!,
                InternalName: internamName!,
                Color: color!,
                InteriorWall: Number.parseInt(interiorWall!),
                InteriorWallTrim: Number.parseInt(interiorWallTrim!),
                Floor: Number.parseInt(floor!),
                GrimeFloor: Number.parseInt(grimeFloor!),
                GrimeWall: Number.parseInt(grimeWall!),
            });
        }

        // floors
        for(let i = 0; i < floors.length; i++)
        {
            const floor = floors[i];
            const objects = floor.getElementsByTagName('object');
            const objArray: any[] = [];

            const floorRooms = floor.getElementsByTagName('rooms')[0];

            const floorTiles = floor.getElementsByTagName('tiles');


            for(let j = 0; j < objects.length; j++)
            {
                const obj = objects[j];
                const objJson: any = {};

                //convert all attributes to json in "any" format
                for(let attr = 0; attr < obj.attributes.length; attr++)
                {
                    const attrName = obj.attributes[attr].name;
                    const attrValue = obj.attributes[attr].value;

                    objJson[attrName] = attrValue;
                }

                objArray.push(objJson);
            }

            if(floorTiles.length > 0)
            {
                this.building.floors.push({
                    objects: objArray,
                    rooms: floorRooms.textContent!,
                    tiles: {
                        layer: floorTiles[0].getAttribute('layer')!,
                        tiles: floorTiles[0].textContent!,
                    }
                });
            }
            else
            {
                this.building.floors.push({
                    objects: objArray,
                    rooms: floorRooms.textContent!,
                });
            }
        }


        console.log(this.building);
        await this.drawBuilding();
        this.roomService.drawRoom(this.roomService.rooms[this.roomService.rooms.length - 1]);
        this.gridService.redrawTiles();
    }

    async drawBuilding()
    {
        const drawRoomTool = new ToolDrawRoom(this.roomService, this.gridService);

        this.building.floors.forEach(floor => {
            let x = 0;
            floor.rooms.split(/\r?\n/).forEach(room => {
                if(room != '')
                {
                    let y = 0;
                    const roomTiles = room.split(',');
                    roomTiles.forEach(tile => {
                        const tileNum: number = Number.parseInt(tile);
                        if(tileNum > 0)
                        {
                            const roomToDraw = this.building.rooms[tileNum - 1];
                            //this.gridService.addToRoom(roomToDraw.Name, x, y);
                            drawRoomTool.setRoom(x, y, false);
                        }
                        y++;
                    });
                    x++;
                }
            });
        });
    }

    private getAttr(attr: string, elem: Element): number
    {
        return Number.parseInt(elem.getAttribute(attr)!) ?? 0;
    }
}