import { Injectable } from "@angular/core";
import { Building, FloorTiles, Furniture, FurnitureTileEntry, SvgObject, SvgTile, Tile, TileEntry } from "../models/app.models";
import { DbService } from "./db.service";
import { TileService } from "./tile.service";
import { FurnitureService } from "./furniture.service";
import { GridService } from "./grid.service";
import ToolDrawRoom from "../tools/tool-draw-room";
import { RoomService } from "./room.service";
import { Store } from "@ngrx/store";
import * as fromRoot from '../app.reducers';
import { SetBuilding } from "../app.actions";

@Injectable({
    providedIn: 'root',
  })
export class BuildingService {
    public building: Building;
    constructor(
        private db: DbService, 
        private tileService: TileService, 
        private gridService: GridService,
        private roomService: RoomService,
        private store: Store<fromRoot.State>,) { }

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
        this.gridService.objects = [];
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

            const roomToAdd = {
                Name: name!,
                InternalName: internamName!,
                Color: color!,
                InteriorWall: Number.parseInt(interiorWall!),
                InteriorWallTrim: Number.parseInt(interiorWallTrim!),
                Floor: Number.parseInt(floor!),
                GrimeFloor: Number.parseInt(grimeFloor!),
                GrimeWall: Number.parseInt(grimeWall!),
            }

            this.building.rooms.push(roomToAdd);

            this.roomService.rooms.push({
                name: name!,
                room: roomToAdd!,
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

        this.store.dispatch(new SetBuilding(this.building));

        await this.drawBuilding();
        // this.roomService.rooms.forEach(room => {
        //     this.roomService.drawRoom(room);
        // });
        //this.roomService.drawRoom(this.roomService.rooms[this.roomService.rooms.length - 1]);
        this.gridService.redrawTiles();

        //Autosave
        localStorage.setItem('buildingXml', new XMLSerializer().serializeToString(xmlDoc));
    }

    async saveBuildingToXml() {
        this.store.select(fromRoot.getBuilding).subscribe(b => {
            if(!b)
            {
                return null;
            }

            var doc: XMLDocument = document.implementation.createDocument("", "", null);

            var buildingEl = doc.createElement('building');
            buildingEl.setAttribute('version', b.version.toString());
            buildingEl.setAttribute('width', b.width.toString());
            buildingEl.setAttribute('height', b.height.toString());
            buildingEl.setAttribute('ExteriorWall', b.ExteriorWall.toString());
            buildingEl.setAttribute('ExteriorWallTrim', b.ExteriorWallTrim.toString());
            buildingEl.setAttribute('Door', b.Door.toString());
            buildingEl.setAttribute('DoorFrame', b.DoorFrame.toString());
            buildingEl.setAttribute('Window', b.Window.toString());
            buildingEl.setAttribute('Curtains', b.Curtains.toString());
            buildingEl.setAttribute('Shutters', b.Shutters.toString());
            buildingEl.setAttribute('Stairs', b.Stairs.toString());
            buildingEl.setAttribute('RoofCap', b.RoofCap.toString());
            buildingEl.setAttribute('RoofSlope', b.RoofSlope.toString());
            buildingEl.setAttribute('RoofTop', b.RoofTop.toString());
            buildingEl.setAttribute('GrimeWall', b.GrimeWall.toString());
            
            //tile_entry
            b.entries.forEach((entry) => {
                var entryEl = doc.createElement('tile_entry');
                entryEl.setAttribute('category', entry.category)

                entry.tiles.forEach((tile) => {
                    var tileEl = doc.createElement('tile');

                    if(tile.enum)
                        tileEl.setAttribute('enum', tile.enum);

                    tileEl.setAttribute('tile', tile.tile);

                    if(tile.offset)
                        tileEl.setAttribute('offset', tile.offset);

                    entryEl.appendChild(tileEl);
                })

                buildingEl.appendChild(entryEl);
            });

            //furniture
            b.furniture.forEach((furniture) => {
                var furnitureEl = doc.createElement('furniture')

                if(furniture.layer)
                    furnitureEl.setAttribute('layer', furniture.layer)
                
                furniture.entries.forEach((entry) => {
                    var entryEl = doc.createElement('entry');

                    entryEl.setAttribute('orient', entry.orient);

                    entry.tiles.forEach((tile) => {
                        var tileEl = doc.createElement('tile');
                        tileEl.setAttribute('x', tile.x.toString());
                        tileEl.setAttribute('y', tile.y.toString());
                        tileEl.setAttribute('name', tile.name);

                        entryEl.appendChild(tileEl);
                    })

                    furnitureEl.appendChild(entryEl);
                })

                buildingEl.appendChild(furnitureEl);
            })

            //user_tiles
            var userTilesEl = doc.createElement('user_tiles');
            b.user_tiles.forEach((tile) => {
                var tileEl = doc.createElement('tile');

                if(tile.enum)
                    tileEl.setAttribute('enum', tile.enum);
                if(tile.offset)
                    tileEl.setAttribute('offset', tile.offset);

                tileEl.setAttribute('tile', tile.tile)

                userTilesEl.appendChild(tileEl);
            })

            buildingEl.appendChild(userTilesEl);

            //used_tiles
            var usedTilesEl = doc.createElement('used_tiles');
            usedTilesEl.innerHTML = b.used_tiles;
            buildingEl.appendChild(usedTilesEl);

            //used_furniture
            var usedFurnitureEl = doc.createElement('used_furniture');
            usedFurnitureEl.innerHTML = b.used_furniture;
            buildingEl.appendChild(usedFurnitureEl);

            //rooms
            b.rooms.forEach((room) => {
                var roomEl = doc.createElement('room');
                roomEl.setAttribute('Name', room.Name)
                roomEl.setAttribute('InternalName', room.InternalName)
                roomEl.setAttribute('Color', room.Color)
                roomEl.setAttribute('InteriorWall', room.InteriorWall.toString())
                roomEl.setAttribute('InteriorWallTrim', room.InteriorWallTrim.toString())
                roomEl.setAttribute('Floor', room.Floor.toString())
                roomEl.setAttribute('GrimeFloor', room.GrimeFloor.toString())
                roomEl.setAttribute('GrimeWall', room.GrimeWall.toString())
                
                buildingEl.appendChild(roomEl);
            })

            //floors
            b.floors.forEach((floor) => {
                var floorEl = doc.createElement('floor');
                floor.objects.forEach((object) => {
                    var objectEl = doc.createElement('object');
                    Object.getOwnPropertyNames(object).forEach((attr) => {
                        objectEl.setAttribute(attr, object[attr]);
                    })

                    floorEl.appendChild(objectEl);
                })

                var roomsEl = doc.createElement('rooms');
                roomsEl.innerHTML = floor.rooms;
                floorEl.appendChild(roomsEl);

                floor.tileLayers?.forEach((tileLayer) => {
                    var tileLayerEl = doc.createElement('tiles')
                    tileLayerEl.setAttribute('layer', tileLayer.layer);
                    tileLayerEl.innerHTML = tileLayer.tiles;

                    floorEl.appendChild(tileLayerEl);
                })

                buildingEl.appendChild(floorEl);
            })
            
            doc.appendChild(buildingEl);
            console.log(doc);

            // Convert XML document to string
            var serializer = new XMLSerializer();
            var xmlString = serializer.serializeToString(doc);
            xmlString = `<?xml version="1.0" encoding="UTF-8"?>` + xmlString;

            // Create Blob
            var blob = new Blob([xmlString], { type: "text/xml" });

            // Prompt user to save file
            var link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'building.tbx';
            link.style.display = 'none';

            // Add event listener to clean up after downloading
            link.addEventListener('click', function () {
                document.body.removeChild(link);
            });

            document.body.appendChild(link);
            link.click();

            return doc;
        })
    }

    async drawBuilding()
    {
        const drawRoomTool = new ToolDrawRoom(this.roomService, this.gridService, this, this.store);

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

    loadObjects()
    {
        this.gridService.objects = [];

        let floorCount = -1
        this.building.floors.forEach(floor => {
            floorCount++;
        });
    }

    placeTile(obj: any, level: number)
    {
        let building = this.building;
        this.store.select(fromRoot.getBuilding).subscribe(b => {
            if (b) {
                building = b;
            }
        });

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
            const capTiles = building.entries[capTilesIndex - 1].tiles;
            const slopeTiles = building.entries[slopeTilesIndex - 1].tiles;
            const topTiles = building.entries[topTilesIndex - 1].tiles;

            //Placement functions
            function placeSlopeTile(gridService: GridService, slopeTile: any, x: number, y: number, height: number, direction: number) {
                if (slopeTile) {
                    for (let i = 0; i < height; i++) {
                        if(direction === 0)
                        {
                            const roofTileExists = gridService.tileExists(x, y + i, level, "Roof");
                            const manualRoofTile = gridService.isUserTile(x, y + i, level, "Roof");

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
                                level: level,
                            }, true);
                        }
                        else
                        {
                            const roofTileExists = gridService.tileExists(x + i, y, level, "Roof");
                            const manualRoofTile = gridService.isUserTile(x + i, y, level, "Roof");

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
                                level: level
                            }, true);
                        }
                    }
                }
            }

            function placeCapTile(gridService: GridService, capTile: any, x: number, y: number, height: number, direction: number) {
                if (capTile) {
                    for (let i = 0; i < height + 1; i++) {
                        console.log("placing cap at " + x + ", " + y + ", level: " + level)
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
                                    level: level
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
                                    level: level
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
                            const roofTileExists = this.gridService.tileExists(x + j, y + i, level, "Floor");
                            const manualRoofTile = this.gridService.isUserTile(x + j, y + i, level, "Floor");

                            this.gridService.placeTile2({
                                name: flatRoofTile.tile + '.png',
                                url: flatRoofTile.tile + '.png',
                                x: x + j,
                                y: y + i,
                                offsetX: flatRoofTile.offset ? Number.parseInt(flatRoofTile.offset) : 0,
                                offsetY: flatRoofTile.offset ? Number.parseInt(flatRoofTile.offset) : 0,
                                layer: roofTileExists && !manualRoofTile ? 'FloorOverlay' : "Floor",
                                level: level
                            }, true);
                        }
                    }
                }
            }
        }

        if(obj.type == 'furniture')
                {
                    const FurnitureTilesNum = Number.parseInt(obj.FurnitureTiles);
                    const furnitureIndex = building.used_furniture.split(' ')[FurnitureTilesNum];
                    const furniture = building.furniture[Number.parseInt(furnitureIndex)];
                    let orient: string = obj.orient;
                    const correctedOrient = (orient === 'E') ? 'W' : (orient === 'S' ? 'N' : orient);
                    const x = Number.parseInt(obj.x);
                    const y = Number.parseInt(obj.y);

                    const furnitureObjectTiles: SvgTile[] = [];
                    const furnitureObject = {
                        tiles: furnitureObjectTiles,
                        x: x + (orient == 'E' ? 1 : 0),
                        y: y + (orient == 'S' ? 1 : 0),
                        level: level,
                        width: 0,
                        length: 0,
                        orient: correctedOrient,
                        type: ''
                    }

                    //const furnitureName = furniture.entries.find(entry => entry.orient === orient)?.tiles[0].name + '.png';

                    const containsOrient = building.furniture[FurnitureTilesNum].entries.find(entry => entry.orient === orient);
                    if(!containsOrient)
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

                    building.furniture[FurnitureTilesNum].entries.find(entry => entry.orient === orient)?.tiles.forEach(tile => {

                        if(building.furniture[FurnitureTilesNum].layer == 'Walls')
                        {
                            furnitureObject.type = 'Wall';

                            let newX = x + tile.x + (obj.orient == 'E' ? 1 : 0)// + ((orient == 'S' || orient == 'N') ? 0 : 1);
                            let newY = y + tile.y + (obj.orient == 'S' ? 1 : 0)// + ((orient == 'E' || orient == 'W') ? 0 : 1);

                            const tileToPlace = {
                                name: tile.name + '.png',
                                url: tile.name + '.png',
                                x: newX,
                                y: newY,
                                layer: 'Walls',
                                level: level
                            };

                            const wallTile = this.gridService.roomTiles.find(t => t.x == newX + tile.x && t.y == newY && (t.layer == 'Walls' || t.layer == "Walls2") && t.level == level);
                            
                            console.log(wallTile)

                            if(wallTile && !this.gridService.isUserTile(newX, newY, level, "Walls") && !this.gridService.isUserTile(newX, newY, level, "Walls2"))
                            {
                                const wallType = wallTile.layer;
                                const wallEntry = building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]));
                                const selectedEntry = building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]))?.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]);
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
                                        level: level
                                    };
                                    console.log('cornerTile', cornerTile);
                                    this.gridService.placeTile2(cornerTile, true);
                                }
                                else if(selectedEntry?.enum?.includes('NorthEast'))
                                {}
                            }

                            console.log(tileToPlace);

                            this.gridService.placeTile2(tileToPlace, false);

                            furnitureObject.tiles.push(tileToPlace);
                            if(tile.x > furnitureObject.length)
                            {
                                furnitureObject.length = tile.x;
                            }
                            if(tile.y > furnitureObject.width)
                            {
                                furnitureObject.width = tile.y;
                            }
                        }
                        else if(building.furniture[FurnitureTilesNum].layer == 'WallFurniture')
                        {
                            furnitureObject.type = 'WallFurniture';

                            const tileToPlace = {
                                name: tile.name + '.png',
                                url: tile.name + '.png',
                                x: x + tile.x,
                                y: y + tile.y,
                                layer: 'WallFurniture',
                                level: level
                            };

                            this.gridService.placeTile2(tileToPlace, false);

                            furnitureObject.tiles.push(tileToPlace);
                            if(tile.x > furnitureObject.length)
                            {
                                furnitureObject.length = tile.x;
                            }
                            if(tile.y > furnitureObject.width)
                            {
                                furnitureObject.width = tile.y;
                            }
                        }

                        else if(building.furniture[FurnitureTilesNum].layer == 'Frames')
                        {
                            const tileToPlace = {
                                name: tile.name + '.png',
                                url: tile.name + '.png',
                                x: x + tile.x,
                                y: y + tile.y,
                                layer: 'Frames',
                                level: level
                            };

                            this.gridService.placeTile2(tileToPlace, false);
                        }

                        else if(!building.furniture[FurnitureTilesNum].layer || building.furniture[FurnitureTilesNum].layer == undefined)
                        {
                            const tileToPlace = {
                                name: tile.name + '.png',
                                url: tile.name + '.png',
                                x: x + tile.x,
                                y: y + tile.y,
                                layer: 'Furniture',
                                level: level
                            };

                            if(this.gridService.getTileAt(x + tile.x, y + tile.y, level, "Furniture") != undefined)
                            {
                                tileToPlace.layer = "Furniture2"
                                //this.building.furniture[FurnitureTilesNum].layer = "Furniture2"
                            }

                            if(this.gridService.getTileAt(x + tile.x, y + tile.y, level, "Furniture2") != undefined)
                            {
                                tileToPlace.layer = "Furniture3"
                                //this.building.furniture[FurnitureTilesNum].layer = "Furniture3"
                            }

                            if(this.gridService.getTileAt(x + tile.x, y + tile.y, level, "Furniture3") != undefined)
                            {
                                tileToPlace.layer = "Furniture4"
                                //this.building.furniture[FurnitureTilesNum].layer = "Furniture4"
                            }

                            this.gridService.placeTile2(tileToPlace, false);

                            furnitureObject.tiles.push(tileToPlace);
                            if(tile.x > furnitureObject.length)
                            {
                                furnitureObject.length = tile.x;
                            }
                            if(tile.y > furnitureObject.width)
                            {
                                furnitureObject.width = tile.y;
                            }
                        }
                    });

                    console.log(furnitureObject);
                    this.gridService.addObject(furnitureObject);
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
            
            const tile = building.entries[Tile - 1]?.tiles.find(tile => tile.enum === dirFullName);
            const intTile = building.entries[interiorTile - 1]?.tiles.find(tile => tile.enum === dirFullName);

            const wallObjectTiles: SvgTile[] = [];
            const wallObject = {
                tiles: wallObjectTiles,
                x: x,
                y: y,
                level: level,
                width: 0,
                length: 0,
                orient: wallDir,
                type: 'Wall'
            }

            
            // Place wall tiles for the entire length
            for (let i = 0; i < length; i++) {

                //Set temp variables
                const newX = dir === 'E' || dir === 'W' ? x + i : x;
                const newY = dir === 'N' || dir === 'S' ? y + i : y;
                let newLayer = this.gridService.getTileAt(newX, newY, level, "Walls") ? "Walls2" : "Walls";
                const isInRoom = this.roomService.getRoomFromTile(newX, newY, level) != null;

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
                            level: level
                        };
                        this.gridService.placeTile2(tileToPlace, true);

                        wallObject.tiles.push(tileToPlace);

                        //this.gridService.roomTiles.push(tileToPlace);
                    }
                    else if(!this.gridService.isUserTile(newX, newY, level, "Walls") && !this.gridService.isUserTile(newX, newY, level, "Walls2"))
                    {
                        //alert("Excluding a tile")
                        this.gridService.excludeTile(newX, newY, level, "Walls");
                        this.gridService.excludeTile(newX, newY, level, "Walls2");
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
                            level: level
                        };
                        this.gridService.placeTile2(tileToPlace, true);

                        wallObject.tiles.push(tileToPlace);

                        //this.gridService.roomTiles.push(tileToPlace);
                    }
                    else if(!this.gridService.isUserTile(newX, newY, level, "Walls") && !this.gridService.isUserTile(newX, newY, level, "Walls2"))
                    {
                        //alert("Excluding a tile")
                        this.gridService.excludeTile(newX, newY, level, "Walls");
                        this.gridService.excludeTile(newX, newY, level, "Walls2");
                    }
                }
                
            }
            
            if(wallDir == 'N')
            {
                wallObject.length = length - 1;
            }
            if(wallDir == 'W')
            {
                wallObject.width = length - 1;
            }

            this.gridService.addObject(wallObject);
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
            const room = this.roomService.getRoomFromTile(obj.x, obj.y, level)

            const frameTile = building.entries[FrameTile - 1]?.tiles.find(tile => tile.enum === dirFullName);
            const tile = building.entries[Tile - 1]?.tiles.find(tile => tile.enum === dirFullName);

            const doorObjectTiles: SvgTile[] = [];
            const doorObject = {
                tiles: doorObjectTiles,
                x: x,
                y: y,
                level: level,
                width: 0,
                length: 0,
                orient: dir,
                type: 'Door'
            }

            this.gridService.addObject(doorObject);

            const tileToPlace = {
                name: tile?.tile + '.png',
                url: tile?.tile + '.png',
                x: x,
                y: y,
                layer: 'Doors',
                level: level,
                object: true
            };

            const frameTileToPlace = {
                name: frameTile?.tile + '.png',
                url: frameTile?.tile + '.png',
                x: x,
                y: y,
                layer: 'Frames',
                level: level,
                object: true
            };

            doorObject.tiles.push(tileToPlace);
            doorObject.tiles.push(frameTileToPlace);

            console.log(doorObject);

            const wallTile = this.gridService.roomTiles.find(tile => tile.x == x && tile.y == y && (tile.layer == 'Walls' || tile.layer == "Walls2") && tile.level == level);
            if(wallTile && !this.gridService.isUserTile(x, y, level, "Walls") && !this.gridService.isUserTile(x, y, level, "Walls2"))
            {
                const wallType = wallTile.layer;
                const wallEntry = building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]));
                const selectedEntry = building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]))?.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]);
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
                    level: level,
                    object: true
                };
                this.gridService.placeTile2(doorWallTile, room != null);
                doorObject.tiles.push(doorWallTile);

                if(selectedEntry?.enum?.includes('NorthWest'))
                {
                    const oppositeDir = dirFullName == 'North' ? 'West' : 'North';
                    const cornerTile = {
                        name: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
                        url: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
                        x: x,
                        y: y,
                        layer: 'Walls2',
                        level: level,
                        object: true
                    };
                    console.log('cornerTile', cornerTile);
                    this.gridService.placeTile2(cornerTile, room != null);
                    doorObject.tiles.push(cornerTile);
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
            const windowInside = this.roomService.getRoomFromTile(obj.x, obj.y, level) != null

            const curtainsTile = building.entries[CurtainsTile - 1]?.tiles.find(tile => tile.enum === dirFullName);
            const shuttersTile = building.entries[ShuttersTile - 1]?.tiles.find(tile => tile.enum === dirFullName);
            const tile = building.entries[Tile - 1]?.tiles.find(tile => tile.enum === dirFullName);

            const windowObjectTiles: SvgTile[] = [];
            const windowObject = {
                tiles: windowObjectTiles,
                x: x,
                y: y,
                level: level,
                width: 0,
                length: 0,
                orient: dir,
                type: 'Window'
            }

            this.gridService.addObject(windowObject);

            const tileToPlace = {
                name: tile?.tile + '.png',
                url: tile?.tile + '.png',
                x: x,
                y: y,
                layer: 'Windows',
                level: level,
                object: true
            };

            const curtainTileToPlace = {
                name: curtainsTile?.tile + '.png',
                url: curtainsTile?.tile + '.png',
                x: x,
                y: y,
                layer: 'Curtains',
                level: level,
                object: true
            };

            windowObject.tiles.push(tileToPlace);
            windowObject.tiles.push(curtainTileToPlace);

            if(!windowInside)
            {
                if(dir === 'N')
                {
                    curtainTileToPlace.y -= 1;
                    const newCurtainsTile = building.entries[CurtainsTile - 1]?.tiles.find(tile => tile.enum === this.getFullDir("S"));
                    curtainTileToPlace.name = newCurtainsTile?.tile + ".png";
                    curtainTileToPlace.url = newCurtainsTile?.tile + ".png";
                    curtainTileToPlace.layer = "Curtains2"
                }
                else {
                    curtainTileToPlace.x -= 1;
                    const newCurtainsTile = building.entries[CurtainsTile - 1]?.tiles.find(tile => tile.enum === this.getFullDir("E"));
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
                level: level,
                object: true
            }

            const wallTile = this.gridService.roomTiles.find(tile => tile.x == x && tile.y == y && (tile.layer == 'Walls' || tile.layer == "Walls2") && tile.level == level);
            if(wallTile && !this.gridService.isUserTile(x, y, level, "Walls") && !this.gridService.isUserTile(x, y, level, "Walls2"))
            {
                const wallType = wallTile.layer;
                const wallEntry = building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]));
                const selectedEntry = building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]))?.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]);
                const openingTile = wallEntry?.tiles.find(tile => tile.enum == dirFullName + "Window");

                const doorWallTile = {
                    name: openingTile?.tile + '.png',
                    url: openingTile?.tile + '.png',
                    x: x,
                    y: y,
                    layer: wallType,
                    level: level,
                    object: true
                };
                this.gridService.placeTile2(doorWallTile, windowInside);
                windowObject.tiles.push(doorWallTile);

                if(selectedEntry?.enum?.includes('NorthWest'))
                {
                    const oppositeDir = dirFullName == 'North' ? 'West' : 'North';
                    const cornerTile = {
                        name: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
                        url: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
                        x: x,
                        y: y,
                        layer: 'Walls2',
                        level: level,
                        object: true
                    };
                    console.log('cornerTile', cornerTile);
                    this.gridService.placeTile2(cornerTile, windowInside);
                    windowObject.tiles.push(cornerTile);
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

        if(obj.type == 'stairs') {
            const StairsTiles = Number.parseInt(obj.Tile);
            const dir = obj.dir;
            const dirFullName = this.getFullDir(dir);
            const x = Number.parseInt(obj.x);
            const y = Number.parseInt(obj.y);
            const stairsTile1 = building.entries[StairsTiles - 1]?.tiles.find(tile => tile.enum === dirFullName + "1");
            const stairsTile2 = building.entries[StairsTiles - 1]?.tiles.find(tile => tile.enum === dirFullName + "2");
            const stairsTile3 = building.entries[StairsTiles - 1]?.tiles.find(tile => tile.enum === dirFullName + "3");

            const stairObjectTiles: SvgTile[] = [];
            const stairObject = {
                tiles: stairObjectTiles,
                x: x,
                y: y,
                level: level,
                width: (dir == 'N' ? 4 : 0),
                length: (dir == 'W' ? 4 : 0),
                orient: dir,
                type: 'Stairs'
            }

            this.gridService.addObject(stairObject);

            const tile1 = {
                name: stairsTile1?.tile + '.png',
                url: stairsTile1?.tile + '.png',
                x: x + (dir == 'W' ? 3 : 0),
                y: y + (dir == 'N' ? 3 : 0),
                layer: 'Furniture',
                level: level,
                object: true
            };

            const tile2 = {
                name: stairsTile2?.tile + '.png',
                url: stairsTile2?.tile + '.png',
                x: x + (dir == 'W' ? 2 : 0),
                y: y + (dir == 'N' ? 2 : 0),
                layer: 'Furniture',
                level: level,
                object: true
            };

            const tile3 = {
                name: stairsTile3?.tile + '.png',
                url: stairsTile3?.tile + '.png',
                x: x + (dir == 'W' ? 1 : 0),
                y: y + (dir == 'N' ? 1 : 0),
                layer: 'Furniture',
                level: level,
                object: true
            };

            stairObject.tiles.push(tile1);
            stairObject.tiles.push(tile2);
            stairObject.tiles.push(tile3);

            this.gridService.placeTile2(tile1, true);
            this.gridService.placeTile2(tile2, true);
            this.gridService.placeTile2(tile3, true);
        }
    }

    placeTiles()
    {
        let building = this.building;
        this.store.select(fromRoot.getBuilding).subscribe(b => {
            if (b) {
                building = b;
                // Do something with the building
                // For example, you can store it locally or perform other operations
            }
        });

        //this.gridService.roomTiles = [];
        //this.gridService.userTiles = [];
        this.gridService.objects = [];

        let floorCount = -1
        building.floors.forEach(floor => {
            floorCount++;
            floor.objects.forEach(obj => {
                this.placeTile(obj, floorCount);
            });
        });

        new ToolDrawRoom(this.roomService, this.gridService, this, this.store).drawRooms();
    }

    removeTile(obj: SvgObject, level: number)
    {
        //alert('removing tile at ' + obj.x + ", " + obj.y)
        let building = this.building;
        this.store.select(fromRoot.getBuilding).subscribe(b => {
            if (b) {
                building = b;
            }
        });

        //if (obj.type == 'Door') {
            // Reverse the actions for removing tiles on the grid
            obj.tiles.forEach(tile => {
                this.gridService.roomTiles = this.gridService.roomTiles.filter(t => t.x !== tile.x || t.y !== tile.y || t.level !== tile.level || t.layer !== tile.layer || t.object !== tile.object)
                this.gridService.userTiles = this.gridService.userTiles.filter(t => t.x !== tile.x || t.y !== tile.y || t.level !== tile.level || t.layer !== tile.layer || t.object !== tile.object)
                //this.gridService.removeTile(tile.x, tile.y, obj.level, tile.layer);
            });
        
            // Reverse the actions for adding the object to the grid service
            this.gridService.removeObject(obj, level);
        
            //console.log('Door removed:', obj);
        //}

        // if(obj.type == 'window')
        // {
        //     const CurtainsTile = Number.parseInt(obj.CurtainsTile);
        //     const ShuttersTile = Number.parseInt(obj.ShuttersTile);
        //     const Tile = Number.parseInt(obj.Tile);
        //     const dir = obj.dir;
        //     const dirFullName = this.getFullDir(dir);
        //     const x = Number.parseInt(obj.x);
        //     const y = Number.parseInt(obj.y);
        //     const windowInside = this.roomService.getRoomFromTile(x, y, level) != null

        //     const curtainsTile = building.entries[CurtainsTile - 1]?.tiles.find(tile => tile.enum === dirFullName);
        //     const shuttersTile = building.entries[ShuttersTile - 1]?.tiles.find(tile => tile.enum === dirFullName);
        //     const tile = building.entries[Tile - 1]?.tiles.find(tile => tile.enum === dirFullName);

        //     const windowObjectTiles: SvgTile[] = [];
        //     const windowObject = {
        //         tiles: windowObjectTiles,
        //         x: x,
        //         y: y,
        //         level: level,
        //         width: 0,
        //         length: 0,
        //         orient: dir,
        //         type: 'Window'
        //     }

        //     this.gridService.removeObject(windowObject, level);
        //     this.gridService.removeTile(x, y, level, 'Windows');

        //     const curtainTileToPlace = {
        //         name: curtainsTile?.tile + '.png',
        //         url: curtainsTile?.tile + '.png',
        //         x: x,
        //         y: y,
        //         layer: 'Curtains',
        //         level: level
        //     };

        //     if(!windowInside)
        //     {
        //         if(dir === 'N')
        //         {
        //             curtainTileToPlace.y -= 1;
        //             const newCurtainsTile = building.entries[CurtainsTile - 1]?.tiles.find(tile => tile.enum === this.getFullDir("S"));
        //             curtainTileToPlace.name = newCurtainsTile?.tile + ".png";
        //             curtainTileToPlace.url = newCurtainsTile?.tile + ".png";
        //             curtainTileToPlace.layer = "Curtains2"
        //         }
        //         else {
        //             curtainTileToPlace.x -= 1;
        //             const newCurtainsTile = building.entries[CurtainsTile - 1]?.tiles.find(tile => tile.enum === this.getFullDir("E"));
        //             curtainTileToPlace.name = newCurtainsTile?.tile + ".png";
        //             curtainTileToPlace.url = newCurtainsTile?.tile + ".png";
        //             curtainTileToPlace.layer = "Curtains2"
        //         }
        //     }

        //     this.gridService.removeTile(curtainTileToPlace.x, curtainTileToPlace.y, curtainTileToPlace.level, curtainTileToPlace.layer);

        //     const shuttersTileToPlace = {
        //         name: curtainsTile?.tile + '.png',
        //         url: curtainsTile?.tile + '.png',
        //         x: x,
        //         y: y,
        //         layer: 'Curtains',
        //         level: level
        //     }

        //     const wallTile = this.gridService.roomTiles.find(tile => tile.x == x && tile.y == y && (tile.layer == 'Walls' || tile.layer == "Walls2") && tile.level == level);
        //     if(wallTile && !this.gridService.isUserTile(x, y, level, "Walls") && !this.gridService.isUserTile(x, y, level, "Walls2"))
        //     {
        //         const wallType = wallTile.layer;
        //         const wallEntry = building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]));
        //         const selectedEntry = building.entries.find(entry => entry.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]))?.tiles.find(tile => tile.tile == wallTile.name?.split('.')[0]);
        //         const openingTile = wallEntry?.tiles.find(tile => tile.enum == dirFullName);

        //         const doorWallTile = {
        //             name: openingTile?.tile + '.png',
        //             url: openingTile?.tile + '.png',
        //             x: x,
        //             y: y,
        //             layer: wallType,
        //             level: level
        //         };
        //         this.gridService.placeTile2(doorWallTile, true);

        //         if(selectedEntry?.enum?.includes('NorthWest'))
        //         {
        //             const oppositeDir = dirFullName == 'North' ? 'West' : 'North';
        //             const cornerTile = {
        //                 name: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
        //                 url: wallEntry?.tiles.find(tile => tile.enum == oppositeDir)?.tile + '.png',
        //                 x: x,
        //                 y: y,
        //                 layer: 'Walls2',
        //                 level: level
        //             };
        //             console.log('cornerTile', cornerTile);
        //             this.gridService.placeTile2(cornerTile, true);
        //         }
        //         else if(selectedEntry?.enum?.includes('NorthEast'))
        //         {}
        //     }
        // }
    }

    getEntry(id: number): TileEntry
    {
        return this.building.entries[id - 1];
    }

    private getAttr(attr: string, elem: Element): number
    {
        return Number.parseInt(elem.getAttribute(attr)!) ?? 0;
    }

    public getFullDir(dir: string): string
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