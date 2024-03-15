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

        //Clear current data
        this.roomService.rooms = [];
        this.gridService.roomTiles = [];
        this.gridService.userTiles = [];
        this.gridService.tiles = [];
        this.gridService.hiddenTiles = [];
        this.gridService.fetchedTiles = [];
        this.gridService.fetchingTiles = [];
        this.gridService.setSelectedLevel(0);

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

        console.log( this.building.furniture)

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

            this.roomService.rooms.push({
                name: name!,
                tiles: [],
                placedTiles: [],
                placedInteriorTiles: []
            });

        }

        this.roomService.selectedRoom = this.building.rooms[0];
        //console.log(this.roomService.selectedRoom)

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
                const tileLayers: FloorTiles[] = [];
                for(let j = 0; j < floorTiles.length; j++)
                {
                    tileLayers.push({
                        layer: floorTiles[j].getAttribute('layer')!,
                        tiles: floorTiles[j].textContent!,
                    });
                }

                this.building.floors.push({
                    objects: objArray,
                    rooms: floorRooms.textContent!,
                    tileLayers: tileLayers
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
        // this.roomService.rooms.forEach(room => {
        //     this.roomService.drawRoom(room);
        // });
        //this.roomService.drawRoom(this.roomService.rooms[this.roomService.rooms.length - 1]);
        this.gridService.redrawTiles();
    }

    async drawBuilding()
    {
        const drawRoomTool = new ToolDrawRoom(this.roomService, this.gridService, this);

        //TODO REMOVE FLOOR COUNT
        let floorCount = -1;

        //Rooms
        this.building.floors.forEach(floor => {
            floorCount++;
            let x = 0;
            floor.rooms.split(/\r?\n/).forEach(room => {
                if(room != '' )//&& floorCount == 0)
                {
                    let y = 0;
                    const roomTiles = room.split(',');
                    roomTiles.forEach(tile => {
                        const tileNum: number = Number.parseInt(tile);
                        if(tileNum > 0)
                        {
                            const roomToDraw = this.building.rooms[tileNum - 1];
                            //this.roomService.selectedRoomObject = roomToDraw;
                            this.roomService.selectedRoom = roomToDraw;
                            //this.gridService.addToRoom(roomToDraw.Name, x, y);
                            drawRoomTool.setRoom(y, x, floorCount, false);
                            
                        }
                        y++;
                    });
                    x++;
                }
            });
            drawRoomTool.drawRooms();
        });

        //Tiles
        floorCount = -1
        this.building.floors.forEach(floor => {
            floorCount++;
            //floor.tileLayers?.forEach?.tiles.split(/\r?\n/).forEach(tile => {
            floor.tileLayers?.forEach?.(tileLayer => {
                const layer = tileLayer.layer;
                const tiles = tileLayer.tiles;

                let x = 0;
                tiles.split(/\r?\n/).forEach(tileRow => {
                    if(tileRow != '')
                    {
                        let y = 0;
                        tileRow.split(',').forEach(tile => {
                            const tileNum: number = Number.parseInt(tile);
                            if(tileNum > 0)
                            {
                                const tileToDraw = this.building.user_tiles[tileNum - 1];
                                console.log(tileToDraw);
                                const tileToPlace = {
                                name: tileToDraw.tile + '.png',
                                url: tileToDraw.tile + '.png',
                                    x: y,
                                    y: x,
                                    layer: layer,
                                    level: floorCount
                                };
                                this.gridService.placeTile2(tileToPlace, false);
                            }
                            y++;
                        });
                        x++;
                    }
                });
            });

            console.log(this.gridService.userTiles);
        });

        //Objects
        this.placeTiles();
    }

    placeTiles()
    {
        let floorCount = -1
        this.building.floors.forEach(floor => {
            floorCount++;
            console.log("FLOOR OBJECTS GOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO")
            console.log(floor.objects)
            floor.objects.forEach(obj => {
                if(obj.type == 'roof')
                {
                    const width = Number.parseInt(obj.width);
                    const height = Number.parseInt(obj.height);
                    const x = Number.parseInt(obj.x);
                    const y = Number.parseInt(obj.y);
                    const roofType = obj.RoofType;
                    const depth = obj.Depth;
                    const cappedN = obj.cappedN === 'true';
                    const cappedS = obj.cappedW === 'true';
                    const cappedE = obj.cappedE === 'true';
                    const cappedW = obj.cappedS === 'true';
                    const capTilesIndex = obj.CapTiles;
                    const slopeTilesIndex = obj.SlopeTiles;
                    const topTilesIndex = obj.TopTiles;
                    const capTiles = this.building.entries[capTilesIndex - 1].tiles;
                    const slopeTiles = this.building.entries[slopeTilesIndex - 1].tiles;
                    const topTiles = this.building.entries[topTilesIndex - 1].tiles;

                    //Placement functions
                    function placeSlopeTile(gridService: GridService, slopeTile: any, x: number, y: number, height: number, direction: number) {
                        if (slopeTile) {
                            for (let i = 0; i < height; i++) {
                                if(direction === 0)
                                {
                                    const roofTileExists = gridService.tileExists(x, y + i, floorCount, "Roof");
                                    const manualRoofTile = gridService.isUserTile(x, y + i, floorCount, "Roof");

                                    console.log("ROOFTILEEXISTS1: " + roofTileExists);
                                    console.log("MANUALROOFTILE1: " + manualRoofTile);

                                    if(roofTileExists && !manualRoofTile)
                                    {
                                       // alert("Caught an already existing roof tile")
                                    }

                                    gridService.placeTile2({
                                        name: slopeTile.tile + '.png',
                                        url: slopeTile.tile + '.png',
                                        x: x,
                                        y: y + i,
                                        offsetX: slopeTile.offset ? Number.parseInt(slopeTile.offset) : 0,
                                        offsetY: slopeTile.offset ? Number.parseInt(slopeTile.offset) : 0,
                                        layer: roofTileExists && !manualRoofTile ? 'Roof2' : "Roof",
                                        level: floorCount,
                                    }, true);
                                }
                                else
                                {
                                    const roofTileExists = gridService.tileExists(x + i, y, floorCount, "Roof");
                                    const manualRoofTile = gridService.isUserTile(x + i, y, floorCount, "Roof");

                                    console.log("ROOFTILEEXISTS2: " + roofTileExists);
                                    console.log("MANUALROOFTILE2: " + manualRoofTile);

                                    if(roofTileExists && !manualRoofTile)
                                    {
                                        //alert("Caught an already existing roof tile")
                                    }

                                    gridService.placeTile2({
                                        name: slopeTile.tile + '.png',
                                        url: slopeTile.tile + '.png',
                                        x: x + i,
                                        y: y ,
                                        offsetX: slopeTile.offset ? Number.parseInt(slopeTile.offset) : 0,
                                        offsetY: slopeTile.offset ? Number.parseInt(slopeTile.offset) : 0,
                                        layer: roofTileExists && !manualRoofTile ? 'Roof2' : "Roof",
                                        level: floorCount
                                    }, true);
                                }
                            }
                        }
                    }

                    function placeCapTile(gridService: GridService, capTile: any, x: number, y: number, height: number, direction: number) {
                        if (capTile) {
                            for (let i = 0; i < height + 1; i++) {
                                console.log("placing cap at " + x + ", " + y + ", level: " + floorCount)
                                if(i === 0 || i === height) 
                                {
                                    if(direction === 0)
                                    {
                                        gridService.placeTile2({
                                            name: capTile.tile + '.png',
                                            url: capTile.tile + '.png',
                                            x: x,
                                            y: y + i,
                                            layer: 'RoofCap',
                                            level: floorCount
                                        }, false);
                                    }
                                    else
                                    {
                                        gridService.placeTile2({
                                            name: capTile.tile + '.png',
                                            url: capTile.tile + '.png',
                                            x: x + i,
                                            y: y,
                                            layer: 'RoofCap',
                                            level: floorCount
                                        }, false);
                                    }
                                }
                            }
                        }
                    }

                    if(roofType == 'PeakNS')
                    {
                        //Place cap tiles
                        if(cappedN)
                        {
                            if (depth === 'Point5') {
                                const capTile = capTiles.find(tile => tile.enum === 'PeakPt5S');
                                placeCapTile(this.gridService, capTile, x, y, height, 0);
                            }

                            if(depth === 'One')
                            {
                                const leftCap = capTiles.find(tile => tile.enum === 'CapRiseS1');
                                const rightCap = capTiles.find(tile => tile.enum === 'CapFallS1');
                        
                                placeCapTile(this.gridService, leftCap, x, y, height, 0);
                                placeCapTile(this.gridService, rightCap, x + 1, y, height, 0);
                            }
                        
                            if (depth === 'OnePoint5') {
                                const leftCap = capTiles.find(tile => tile.enum === 'CapRiseS1');
                                const middleCap = capTiles.find(tile => tile.enum === 'PeakOnePt5S');
                                const rightCap = capTiles.find(tile => tile.enum === 'CapFallS1');
                        
                                placeCapTile(this.gridService, leftCap, x, y, height, 0);
                                placeCapTile(this.gridService, middleCap, x + 1, y, height, 0);
                                placeCapTile(this.gridService, rightCap, x + 2, y, height, 0);
                            }
                        
                            if (depth === 'Two') {
                                const leftCap1 = capTiles.find(tile => tile.enum === 'CapRiseS1');
                                const leftCap2 = capTiles.find(tile => tile.enum === 'CapRiseS2');
                                const rightCap1 = capTiles.find(tile => tile.enum === 'CapFallS2');
                                const rightCap2 = capTiles.find(tile => tile.enum === 'CapFallS1');
                        
                                placeCapTile(this.gridService, leftCap1, x, y, height, 0);
                                placeCapTile(this.gridService, leftCap2, x + 1, y, height, 0);
                                placeCapTile(this.gridService, rightCap1, x + 2, y, height, 0);
                                placeCapTile(this.gridService, rightCap2, x + 3, y, height, 0);
                            }

                            if (depth === 'TwoPoint5') {
                                const leftCap1 = capTiles.find(tile => tile.enum === 'CapRiseS1');
                                const leftCap2 = capTiles.find(tile => tile.enum === 'CapRiseS2');
                                const middleCap = capTiles.find(tile => tile.enum === 'PeakTwoPt5S');
                                const rightCap1 = capTiles.find(tile => tile.enum === 'CapFallS2');
                                const rightCap2 = capTiles.find(tile => tile.enum === 'CapFallS1');

                                placeCapTile(this.gridService, leftCap1, x, y, height, 0);
                                placeCapTile(this.gridService, leftCap2, x + 1, y, height, 0);
                                placeCapTile(this.gridService, middleCap, x + 2, y, height, 0);
                                placeCapTile(this.gridService, rightCap1, x + 3, y, height, 0);
                                placeCapTile(this.gridService, rightCap2, x + 4, y, height, 0);
                            }
                        
                            if (depth === 'Three') {
                                for (let i = 1; i <= 3; i++) {
                                    const rightCap = capTiles.find(tile => tile.enum === `CapFallS${i}`);
                                    const leftCap = capTiles.find(tile => tile.enum === `CapRiseS${i}`);
                                    placeCapTile(this.gridService, leftCap, x + i - 1, y, height, 0);
                                    placeCapTile(this.gridService, rightCap, x + width - i, y, height, 0);

                                    if(width > 6)
                                    {
                                        const middleCap = capTiles.find(tile => tile.enum === 'CapGapS3');
                                        for(let j = 3; j < width - 3; j++)
                                        {
                                            placeCapTile(this.gridService, middleCap, x + j, y, height, 0);
                                        }
                                    }
                                }
                            }
                        }

                        // Place slope tiles
                        if (depth === 'Point5') {
                            const slopeTile = slopeTiles.find(tile => tile.enum === 'SlopePt5E');
                            placeSlopeTile(this.gridService, slopeTile, x, y, height, 0);
                        }

                        if (depth === 'One' || depth === 'OnePoint5') {
                            const slopeTile1 = slopeTiles.find(tile => tile.enum === 'SlopeE1');
                            placeSlopeTile(this.gridService, slopeTile1, x + width - 1, y, height, 0);

                            if (depth === 'OnePoint5') {
                                const halfSlopeTile = slopeTiles.find(tile => tile.enum === 'SlopeOnePt5E');
                                placeSlopeTile(this.gridService, halfSlopeTile, x + 1, y, height, 0);
                            }
                        }

                        if (depth === 'Two' || depth === 'TwoPoint5') {
                            const slopeTile1 = slopeTiles.find(tile => tile.enum === 'SlopeE1');
                            const slopeTile2 = slopeTiles.find(tile => tile.enum === 'SlopeE2');
                            placeSlopeTile(this.gridService, slopeTile1, x + width - 1, y, height, 0);
                            placeSlopeTile(this.gridService, slopeTile2, x + width - 2, y, height, 0);

                            if (depth === 'TwoPoint5') {
                                const halfSlopeTile = slopeTiles.find(tile => tile.enum === 'SlopeTwoPt5E');
                                placeSlopeTile(this.gridService, halfSlopeTile, x + width - 3, y, height, 0);
                            }
                        }

                        if (depth === 'Three') {
                            for (let i = 1; i <= 3; i++) {
                                const slopeTile = slopeTiles.find(tile => tile.enum === `SlopeE${i}`);
                                placeSlopeTile(this.gridService, slopeTile, x + width - i, y, height, 0);
                            }
                        }
                    }

                    else if(roofType == 'PeakWE')
                    {
                        //Place cap tiles
                        if(cappedW)
                        {
                            if(depth === 'Point5')
                            {
                                const capTile = capTiles.find(tile => tile.enum === 'PeakPt5E');
                                placeCapTile(this.gridService, capTile, x, y, width, 1);
                            }

                            if(depth === 'One')
                            {
                                const leftCap = capTiles.find(tile => tile.enum === 'CapFallE1');
                                const rightCap = capTiles.find(tile => tile.enum === 'CapRiseE1');
                        
                                placeCapTile(this.gridService, leftCap, x, y, width, 1);
                                placeCapTile(this.gridService, rightCap, x, y + 1, width, 1);
                            }

                            if (depth === 'OnePoint5') {
                                const leftCap = capTiles.find(tile => tile.enum === 'CapFallE1');
                                const middleCap = capTiles.find(tile => tile.enum === 'PeakOnePt5E');
                                const rightCap = capTiles.find(tile => tile.enum === 'CapRiseE1');
                        
                                placeCapTile(this.gridService, leftCap, x, y, width, 1);
                                placeCapTile(this.gridService, middleCap, x, y + 1, width, 1);
                                placeCapTile(this.gridService, rightCap, x, y + 2, width, 1);
                            }

                            if (depth === 'Two') {
                                const leftCap1 = capTiles.find(tile => tile.enum === 'CapFallE1');
                                const leftCap2 = capTiles.find(tile => tile.enum === 'CapFallE2');
                                const rightCap1 = capTiles.find(tile => tile.enum === 'CapRiseE2');
                                const rightCap2 = capTiles.find(tile => tile.enum === 'CapRiseE1');
                        
                                placeCapTile(this.gridService, leftCap1, x, y, width, 1);
                                placeCapTile(this.gridService, leftCap2, x, y + 1, width, 1);
                                placeCapTile(this.gridService, rightCap1, x, y + 2, width, 1);
                                placeCapTile(this.gridService, rightCap2, x, y + 3, width, 1);
                            }

                            if (depth === 'TwoPoint5') {
                                const leftCap1 = capTiles.find(tile => tile.enum === 'CapFallE1');
                                const leftCap2 = capTiles.find(tile => tile.enum === 'CapFallE2');
                                const middleCap = capTiles.find(tile => tile.enum === 'PeakTwoPt5E');
                                const rightCap1 = capTiles.find(tile => tile.enum === 'CapRiseE2');
                                const rightCap2 = capTiles.find(tile => tile.enum === 'CapRiseE1');

                                placeCapTile(this.gridService, leftCap1, x, y, width, 1);
                                placeCapTile(this.gridService, leftCap2, x, y + 1, width, 1);
                                placeCapTile(this.gridService, middleCap, x, y + 2, width, 1);
                                placeCapTile(this.gridService, rightCap1, x, y + 3, width, 1);
                                placeCapTile(this.gridService, rightCap2, x, y + 4, width, 1);
                            }

                            if (depth === 'Three') {
                                for (let i = 1; i <= 3; i++) {
                                    const rightCap = capTiles.find(tile => tile.enum === `CapRiseE${i}`);
                                    const leftCap = capTiles.find(tile => tile.enum === `CapFallE${i}`);
                                    placeCapTile(this.gridService, leftCap, x, y + i - 1, width, 1);
                                    placeCapTile(this.gridService, rightCap, x, y + height - i, width, 1);

                                    if(height > 6)
                                    {
                                        const middleCap = capTiles.find(tile => tile.enum === 'CapGapE3');
                                        for(let j = 3; j < height - 3; j++)
                                        {
                                            placeCapTile(this.gridService, middleCap, x, y + j, width, 1);
                                        }
                                    }
                                }
                            }
                        }

                        //Place Slope Tiles
                        if (depth === 'Point5') {
                            const slopeTile = slopeTiles.find(tile => tile.enum === 'SlopePt5S');
                            placeSlopeTile(this.gridService, slopeTile, x, y, width, 1);
                        }

                        if (depth === 'One' || depth === 'OnePoint5') {
                            const slopeTile1 = slopeTiles.find(tile => tile.enum === 'SlopeS1');
                            placeSlopeTile(this.gridService, slopeTile1, x, y + height - 1, width, 1);

                            if (depth === 'OnePoint5') {
                                const halfSlopeTile = slopeTiles.find(tile => tile.enum === 'SlopeOnePt5S');
                                placeSlopeTile(this.gridService, halfSlopeTile, x, y + 1, width, 1);
                            }
                        }

                        if(depth === 'Two' || depth === 'TwoPoint5') {
                            const slopeTile1 = slopeTiles.find(tile => tile.enum === 'SlopeS1');
                            const slopeTile2 = slopeTiles.find(tile => tile.enum === 'SlopeS2');
                            placeSlopeTile(this.gridService, slopeTile1, x, y + height - 1, width, 1);
                            placeSlopeTile(this.gridService, slopeTile2, x, y + height - 2, width, 1);

                            if (depth === 'TwoPoint5') {
                                const halfSlopeTile = slopeTiles.find(tile => tile.enum === 'SlopeTwoPt5S');
                                placeSlopeTile(this.gridService, halfSlopeTile, x, y + height - 3, width, 1);
                            }
                        }

                        if(depth === 'Three') {
                            for(let i = 1; i <= 3; i++)
                            {
                                const slopeTile = slopeTiles.find(tile => tile.enum === `SlopeS${i}`);
                                placeSlopeTile(this.gridService, slopeTile, x, y + height - i, width, 1);
                            }
                        }

                        // if (depth === 'Two') {
                        //     const slopeTile1 = slopeTiles.find(tile => tile.enum === 'SlopeE1');
                        //     const slopeTile2 = slopeTiles.find(tile => tile.enum === 'SlopeE2');
                        //     placeSlopeTile(this.gridService, slopeTile1, x + width - 1, y, height, 1);
                        //     placeSlopeTile(this.gridService, slopeTile2, x + width - 2, y, height, 1);
                        // }

                        // if (depth === 'Three') {
                        //     for (let i = 1; i <= 3; i++) {
                        //         const slopeTile = slopeTiles.find(tile => tile.enum === `SlopeE${i}`);
                        //         placeSlopeTile(this.gridService, slopeTile, x + width - i, y, height, 1);
                        //     }
                        // }
                    }

                    else if(roofType == 'FlatTop')
                    {
                        console.log(topTiles)
                        const flatRoofTile = topTiles.find(tile => tile.enum === 'West3');

                        if(flatRoofTile)
                        {
                            for(let i = 0; i < height; i++)
                            {
                                for(let j = 0; j < width; j++)
                                {
                                    const roofTileExists = this.gridService.tileExists(x + j, y + i, floorCount, "Roof");
                                    const manualRoofTile = this.gridService.isUserTile(x + j, y + i, floorCount, "Roof");

                                    this.gridService.placeTile2({
                                        name: flatRoofTile.tile + '.png',
                                        url: flatRoofTile.tile + '.png',
                                        x: x + j,
                                        y: y + i,
                                        offsetX: flatRoofTile.offset ? Number.parseInt(flatRoofTile.offset) : 0,
                                        offsetY: flatRoofTile.offset ? Number.parseInt(flatRoofTile.offset) : 0,
                                        layer: roofTileExists && !manualRoofTile ? 'Roof2' : "Roof",
                                        level: floorCount
                                    }, true);
                                }
                            }
                        }
                    }
                }

                if(obj.type == 'furniture')
                {
                    const FurnitureTilesNum = Number.parseInt(obj.FurnitureTiles);
                    const furnitureIndex = this.building.used_furniture.split(' ')[FurnitureTilesNum];
                    const furniture = this.building.furniture[Number.parseInt(furnitureIndex)];
                    let orient: string = obj.orient;
                    const x = Number.parseInt(obj.x);
                    const y = Number.parseInt(obj.y);

                    //const furnitureName = furniture.entries.find(entry => entry.orient === orient)?.tiles[0].name + '.png';

                    const test = this.building.furniture[FurnitureTilesNum].entries.find(entry => entry.orient === orient);
                    if(!test)
                    {
                        if(orient == 'E')
                        {
                            orient = 'W';
                        }
                        else if(orient == 'S')
                        {
                            orient = 'N'
                        }
                    }

                    this.building.furniture[FurnitureTilesNum].entries.find(entry => entry.orient === orient)?.tiles.forEach(tile => {

                        if(this.building.furniture[FurnitureTilesNum].layer == 'Walls')
                        {

                            const newX = x + tile.x + ((orient == 'S' || orient == 'N') ? 0 : 1);
                            const newY = y + tile.y + ((orient == 'E' || orient == 'W') ? 0 : 1);

                            const tileToPlace = {
                                name: tile.name + '.png',
                                url: tile.name + '.png',
                                x: newX,
                                y: newY,
                                layer: 'Walls',
                                level: floorCount
                            };

                            const wallTile = this.gridService.roomTiles.find(t => t.x == newX + tile.x && t.y == newY && (t.layer == 'Walls' || t.layer == "Walls2") && t.level == floorCount);
                            
                            console.log(wallTile)

                            if(wallTile && !this.gridService.isUserTile(newX, newY, floorCount, "Walls") && !this.gridService.isUserTile(newX, newY, floorCount, "Walls2"))
                            {
                                const wallType = wallTile.layer;
                                const wallEntry = this.building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]));
                                const selectedEntry = this.building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]))?.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]);
                                const replacementTile = wallEntry?.tiles.find(tile => tile.enum == 'West');

                                if(selectedEntry?.enum?.includes('NorthWest'))
                                {
                                    const fullDir = this.getFullDir(orient)
                                    const oppositeDir = (fullDir == 'North' || fullDir == 'South') ? 'West' : 'North';
                                    const cornerTile = {
                                        name: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
                                        url: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
                                        x: newX,
                                        y: newY,
                                        layer: 'Walls2',
                                        level: floorCount
                                    };
                                    console.log('cornerTile', cornerTile);
                                    this.gridService.placeTile2(cornerTile, true);
                                }
                                else if(selectedEntry?.enum?.includes('NorthEast'))
                                {}
                            }

                            console.log(tileToPlace);

                            this.gridService.placeTile2(tileToPlace, false);
                        }
                        else if(this.building.furniture[FurnitureTilesNum].layer == 'WallFurniture')
                        {
                            const tileToPlace = {
                                name: tile.name + '.png',
                                url: tile.name + '.png',
                                x: x + tile.x,
                                y: y + tile.y,
                                layer: 'WallFurniture',
                                level: floorCount
                            };

                            this.gridService.placeTile2(tileToPlace, false);
                        }

                        else if(this.building.furniture[FurnitureTilesNum].layer == 'Frames')
                        {
                            const tileToPlace = {
                                name: tile.name + '.png',
                                url: tile.name + '.png',
                                x: x + tile.x,
                                y: y + tile.y,
                                layer: 'Frames',
                                level: floorCount
                            };

                            this.gridService.placeTile2(tileToPlace, false);
                        }

                        else if(!this.building.furniture[FurnitureTilesNum].layer || this.building.furniture[FurnitureTilesNum].layer == undefined)
                        {
                            const tileToPlace = {
                                name: tile.name + '.png',
                                url: tile.name + '.png',
                                x: x + tile.x,
                                y: y + tile.y,
                                layer: 'Furniture',
                                level: floorCount
                            };

                            if(this.gridService.getTileAt(x + tile.x, y + tile.y, floorCount, "Furniture") != undefined)
                            {
                                tileToPlace.layer = "Furniture2"
                                //this.building.furniture[FurnitureTilesNum].layer = "Furniture2"
                            }

                            if(this.gridService.getTileAt(x + tile.x, y + tile.y, floorCount, "Furniture2") != undefined)
                            {
                                tileToPlace.layer = "Furniture3"
                                //this.building.furniture[FurnitureTilesNum].layer = "Furniture3"
                            }

                            if(this.gridService.getTileAt(x + tile.x, y + tile.y, floorCount, "Furniture3") != undefined)
                            {
                                tileToPlace.layer = "Furniture4"
                                //this.building.furniture[FurnitureTilesNum].layer = "Furniture4"
                            }

                            this.gridService.placeTile2(tileToPlace, false);
                            console.log(tileToPlace);
                        }
                    });
                }

                if(obj.type == 'wall')
                {
                    const length = Number.parseInt(obj.length);
                    const interiorTile = Number.parseInt(obj.InteriorTile);
                    const exteriorTrim = Number.parseInt(obj.ExteriorTrim);
                    const interiorTrim = Number.parseInt(obj.InteriorTrim);
                    const Tile = Number.parseInt(obj.Tile);
                    const x = Number.parseInt(obj.x);
                    const y = Number.parseInt(obj.y);
                    const dir = obj.dir;
                    const wallDir = (obj.dir == 'E' || obj.dir == 'W') ? 'N' : 'W';
                    const dirFullName = this.getFullDir(wallDir);
                    
                    const tile = this.building.entries[Tile - 1]?.tiles.find(tile => tile.enum === dirFullName);
                    const intTile = this.building.entries[interiorTile - 1]?.tiles.find(tile => tile.enum === dirFullName);

                    
                    // Place wall tiles for the entire length
                    for (let i = 0; i < length; i++) {

                        //Set temp variables
                        const newX = dir === 'E' || dir === 'W' ? x + i : x;
                        const newY = dir === 'N' || dir === 'S' ? y + i : y;
                        let newLayer = this.gridService.getTileAt(newX, newY, floorCount, "Walls") ? "Walls2" : "Walls";
                        const isInRoom = this.roomService.getRoomFromTile(newX, newY, floorCount) != null;

                        if(isInRoom)
                        {
                            if(intTile)
                            {
                                console.log(intTile);
                                const tileToPlace = {
                                    name: intTile.tile + '.png',
                                    url: intTile.tile + '.png',
                                    x: newX, // Increment x position for horizontal walls
                                    y: newY, // Increment y position for vertical walls
                                    layer: newLayer,
                                    level: floorCount
                                };
                                this.gridService.placeTile2(tileToPlace, true);
                                //this.gridService.roomTiles.push(tileToPlace);
                            }
                            else if(!this.gridService.isUserTile(newX, newY, floorCount, "Walls") && !this.gridService.isUserTile(newX, newY, floorCount, "Walls2"))
                            {
                                //alert("Excluding a tile")
                                this.gridService.excludeTile(newX, newY, floorCount, "Walls");
                                this.gridService.excludeTile(newX, newY, floorCount, "Walls2");
                            }
                        }
                        else
                        {
                            if(tile)
                            {
                                const tileToPlace = {
                                    name: tile.tile + '.png',
                                    url: tile.tile + '.png',
                                    x: newX, // Increment x position for horizontal walls
                                    y: newY, // Increment y position for vertical walls
                                    layer: newLayer,
                                    level: floorCount
                                };
                                this.gridService.placeTile2(tileToPlace, true);
                                //this.gridService.roomTiles.push(tileToPlace);
                            }
                            else if(!this.gridService.isUserTile(newX, newY, floorCount, "Walls") && !this.gridService.isUserTile(newX, newY, floorCount, "Walls2"))
                            {
                                //alert("Excluding a tile")
                                this.gridService.excludeTile(newX, newY, floorCount, "Walls");
                                this.gridService.excludeTile(newX, newY, floorCount, "Walls2");
                            }
                        }
                        
                    }
                    

                    console.log("PLACING WALL AT " + tile)
                }

                if(obj.type == 'door')
                {
                    const FrameTile = Number.parseInt(obj.FrameTile);
                    const Tile = Number.parseInt(obj.Tile);
                    const dir = obj.dir;
                    const dirFullName = this.getFullDir(dir);
                    const x = Number.parseInt(obj.x);
                    const y = Number.parseInt(obj.y);

                    const frameTile = this.building.entries[FrameTile - 1]?.tiles.find(tile => tile.enum === dirFullName);
                    const tile = this.building.entries[Tile - 1]?.tiles.find(tile => tile.enum === dirFullName);

                    const tileToPlace = {
                        name: tile?.tile + '.png',
                        url: tile?.tile + '.png',
                        x: x,
                        y: y,
                        layer: 'Doors',
                        level: floorCount
                    };

                    const frameTileToPlace = {
                        name: frameTile?.tile + '.png',
                        url: frameTile?.tile + '.png',
                        x: x,
                        y: y,
                        layer: 'Frames',
                        level: floorCount
                    };

                    const wallTile = this.gridService.roomTiles.find(tile => tile.x == x && tile.y == y && (tile.layer == 'Walls' || tile.layer == "Walls2") && tile.level == floorCount);
                    if(wallTile && !this.gridService.isUserTile(x, y, floorCount, "Walls") && !this.gridService.isUserTile(x, y, floorCount, "Walls2"))
                    {
                        const wallType = wallTile.layer;
                        const wallEntry = this.building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]));
                        const selectedEntry = this.building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]))?.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]);
                        const doorwayTile = wallEntry?.tiles.find(tile => tile.enum == dirFullName + "Door");

                        console.log('wallTile', wallTile);
                        console.log('selectedEntry', selectedEntry);
                        console.log('wallEntry', wallEntry);
                        console.log('doorwayTile', doorwayTile);
                        const doorWallTile = {
                            name: doorwayTile?.tile + '.png',
                            url: doorwayTile?.tile + '.png',
                            x: x,
                            y: y,
                            layer: wallType,
                            level: floorCount
                        };
                        this.gridService.placeTile2(doorWallTile, true);

                        if(selectedEntry?.enum?.includes('NorthWest'))
                        {
                            const oppositeDir = dirFullName == 'North' ? 'West' : 'North';
                            const cornerTile = {
                                name: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
                                url: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
                                x: x,
                                y: y,
                                layer: 'Walls2',
                                level: floorCount
                            };
                            console.log('cornerTile', cornerTile);
                            this.gridService.placeTile2(cornerTile, true);
                        }
                        else if(selectedEntry?.enum?.includes('NorthEast'))
                        {}
                    }

                    console.log("PLACING DOOR AT ");
                    console.log(frameTileToPlace)

                    if(Tile != 0)
                    {
                        this.gridService.placeTile2(tileToPlace, true);
                    }
                    if(FrameTile != 0)
                    {
                        this.gridService.placeTile2(frameTileToPlace, true);
                    }
                }

                if(obj.type == 'window')
                {
                    const CurtainsTile = Number.parseInt(obj.CurtainsTile);
                    const ShuttersTile = Number.parseInt(obj.ShuttersTile);
                    const Tile = Number.parseInt(obj.Tile);
                    const dir = obj.dir;
                    const dirFullName = this.getFullDir(dir);
                    const x = Number.parseInt(obj.x);
                    const y = Number.parseInt(obj.y);
                    const windowInside = this.roomService.getRoomFromTile(x, y, floorCount) != null

                    const curtainsTile = this.building.entries[CurtainsTile - 1]?.tiles.find(tile => tile.enum === dirFullName);
                    const shuttersTile = this.building.entries[ShuttersTile - 1]?.tiles.find(tile => tile.enum === dirFullName);
                    const tile = this.building.entries[Tile - 1]?.tiles.find(tile => tile.enum === dirFullName);

                    const tileToPlace = {
                        name: tile?.tile + '.png',
                        url: tile?.tile + '.png',
                        x: x,
                        y: y,
                        layer: 'Windows',
                        level: floorCount
                    };

                    const curtainTileToPlace = {
                        name: curtainsTile?.tile + '.png',
                        url: curtainsTile?.tile + '.png',
                        x: x,
                        y: y,
                        layer: 'Curtains',
                        level: floorCount
                    };

                    if(!windowInside)
                    {
                        if(dir === 'N')
                        {
                            curtainTileToPlace.y -= 1;
                            const newCurtainsTile = this.building.entries[CurtainsTile - 1]?.tiles.find(tile => tile.enum === this.getFullDir("S"));
                            curtainTileToPlace.name = newCurtainsTile?.tile + ".png";
                            curtainTileToPlace.url = newCurtainsTile?.tile + ".png";
                            curtainTileToPlace.layer = "Curtains2"
                        }
                        else {
                            curtainTileToPlace.x -= 1;
                            const newCurtainsTile = this.building.entries[CurtainsTile - 1]?.tiles.find(tile => tile.enum === this.getFullDir("E"));
                            curtainTileToPlace.name = newCurtainsTile?.tile + ".png";
                            curtainTileToPlace.url = newCurtainsTile?.tile + ".png";
                            curtainTileToPlace.layer = "Curtains2"
                        }
                    }

                    const shuttersTileToPlace = {
                        name: curtainsTile?.tile + '.png',
                        url: curtainsTile?.tile + '.png',
                        x: x,
                        y: y,
                        layer: 'Curtains',
                        level: floorCount
                    }

                    const wallTile = this.gridService.roomTiles.find(tile => tile.x == x && tile.y == y && (tile.layer == 'Walls' || tile.layer == "Walls2") && tile.level == floorCount);
                    if(wallTile && !this.gridService.isUserTile(x, y, floorCount, "Walls") && !this.gridService.isUserTile(x, y, floorCount, "Walls2"))
                    {
                        const wallType = wallTile.layer;
                        const wallEntry = this.building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]));
                        const selectedEntry = this.building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]))?.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]);
                        const openingTile = wallEntry?.tiles.find(tile => tile.enum == dirFullName + "Window");

                        const doorWallTile = {
                            name: openingTile?.tile + '.png',
                            url: openingTile?.tile + '.png',
                            x: x,
                            y: y,
                            layer: wallType,
                            level: floorCount
                        };
                        this.gridService.placeTile2(doorWallTile, true);

                        if(selectedEntry?.enum?.includes('NorthWest'))
                        {
                            const oppositeDir = dirFullName == 'North' ? 'West' : 'North';
                            const cornerTile = {
                                name: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
                                url: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
                                x: x,
                                y: y,
                                layer: 'Walls2',
                                level: floorCount
                            };
                            console.log('cornerTile', cornerTile);
                            this.gridService.placeTile2(cornerTile, true);
                        }
                        else if(selectedEntry?.enum?.includes('NorthEast'))
                        {}
                    }

                    console.log("PLACING WINDOW AT ");
                    console.log(curtainTileToPlace)

                    if(Tile != 0)
                    {
                        this.gridService.placeTile2(tileToPlace, true);
                    }
                    if(CurtainsTile != 0)
                    {
                        this.gridService.placeTile2(curtainTileToPlace, true);
                    }
                }
            });
        });
    }

    private getAttr(attr: string, elem: Element): number
    {
        return Number.parseInt(elem.getAttribute(attr)!) ?? 0;
    }

    private getFullDir(dir: string): string
    {
        switch(dir)
        {
            case 'N':
                return 'North';
            case 'S':
                return 'South';
            case 'E':
                return 'East';
            case 'W':
                return 'West';
            case 'NE':
                return 'NorthEast';
            case 'NW':
                return 'NorthWest';
            case 'SE':
                return 'SouthEast';
            case 'SW':
                return 'SouthWest';
            default:
                return '';
        }
    }
}