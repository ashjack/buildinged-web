import { Injectable } from "@angular/core";
import { DbService } from "./db.service";
import { Furniture, SvgTile, TileEntry } from "../models/app.models";
import { BuildingService } from "./building.service";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { AddObject } from "../app.actions";
import { VisualFurniture } from "../models/furniture-window.models";
import { take } from "rxjs";
import { GridService } from "./grid.service";

@Injectable({
    providedIn: 'root',
  })
export class RoofService {
    constructor(private db: DbService, private buildingService: BuildingService, private gridService: GridService, private store: Store<fromRoot.State>) { }

    placeRoof(x: number, y: number, level: number, width: number, height: number, RoofType: string, CapTiles: number, SlopeTiles: number, TopTiles: number) {
        this.store.select(fromRoot.getBuilding).pipe(take(1)).subscribe(b => {
            if (!b)
                return;
        
            width = width + 1;
            height = height + 1;
           
            let Depth = this.calculateDepth(width, height, RoofType);

            console.log('placing roof at', x, y, width, height);
            const newRoof = {
                type: 'roof',
                width: width,
                height: height,
                RoofType: RoofType,
                Depth: Depth,
                cappedW: "true",
                cappedN: "true",
                cappedE: "true",
                cappedS: "true",
                CapTiles: CapTiles,
                SlopeTiles: SlopeTiles,
                TopTiles: TopTiles,
                x: x,
                y: y
            };
    
            this.store.dispatch(new AddObject(newRoof, level));
            this.buildingService.placeTile(newRoof, level);
        });
    }

    calculateDepth(width: number, height: number, RoofType: string){
        let Depth = "Point5"
            if(RoofType === 'PeakNS')
            {
                switch(width)
                {
                    case 2:
                        Depth = "One";
                        break;
                    case 3:
                        Depth = "OnePoint5"
                        break;
                    case 4:
                        Depth = "Two"
                        break;
                    case 5:
                        Depth = "TwoPoint5"
                        break;
                    default:
                        Depth = width > 1 ? "Three" : "Point5";
                        break;
                }
            }
            else if(RoofType === 'PeakWE')
            {
                switch(height)
                {
                    case 2:
                        Depth = "One";
                        break;
                    case 3:
                        Depth = "OnePoint5"
                        break;
                    case 4:
                        Depth = "Two"
                        break;
                    case 5:
                        Depth = "TwoPoint5"
                        break;
                    default:
                        Depth = height > 1 ? "Three" : "Point5";
                        break;
                }
            }
        return Depth;
    }

    calculateRoofTiles(x: number, y: number, level: number, width: number, height: number, RoofType: string, CapTiles: number, SlopeTiles: number, TopTiles: number) {
        const roofObjectTiles: SvgTile[] = [];
        let depth = this.calculateDepth(width, height, RoofType);
        const cappedN = true;
        const cappedW = true;
        const cappedE = true;
        const cappedS = true;

        const building = this.buildingService.getBuilding();
        
        const capTilesIndex = CapTiles;
        const slopeTilesIndex = SlopeTiles;
        const topTilesIndex = TopTiles;
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

                        const tileToPlace = {
                            name: slopeTile.tile + '.png',
                            url: slopeTile.tile + '.png',
                            x: x,
                            y: y + i,
                            offsetX: slopeTile.offset ? Number.parseInt(slopeTile.offset) : 0,
                            offsetY: slopeTile.offset ? Number.parseInt(slopeTile.offset) : 0,
                            layer: roofTileExists ? 'Roof2' : "Roof",
                            level: level,
                        }

                        roofObjectTiles.push(tileToPlace);
                    }
                    else
                    {
                        const roofTileExists = gridService.tileExists(x + i, y, level, "Roof");

                        const tileToPlace = {
                            name: slopeTile.tile + '.png',
                            url: slopeTile.tile + '.png',
                            x: x + i,
                            y: y ,
                            offsetX: slopeTile.offset ? Number.parseInt(slopeTile.offset) : 0,
                            offsetY: slopeTile.offset ? Number.parseInt(slopeTile.offset) : 0,
                            layer: roofTileExists ? 'Roof2' : "Roof",
                            level: level
                        }

                        roofObjectTiles.push(tileToPlace);
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
                            const tileToPlace = {
                                name: capTile.tile + '.png',
                                url: capTile.tile + '.png',
                                x: x,
                                y: y + i,
                                layer: 'RoofCap',
                                level: level
                            };

                            roofObjectTiles.push(tileToPlace);
                        }
                        else
                        {
                            const tileToPlace = {
                                name: capTile.tile + '.png',
                                url: capTile.tile + '.png',
                                x: x + i,
                                y: y,
                                layer: 'RoofCap',
                                level: level
                            }
                            roofObjectTiles.push(tileToPlace);
                        }
                    }
                }
            }
        }

        if(RoofType == 'PeakNS')
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

            else if(RoofType == 'PeakWE')
            {
                //Place cap tiles
                if(cappedW)
                {
                    if(depth === 'Point5')
                    {
                        const capTile = capTiles.find(tile => tile.enum === 'PeakPt5E');
                        placeCapTile(this.gridService, capTile, x, y, width, 1);
                    }

                    else if(depth === 'One')
                    {
                        const leftCap = capTiles.find(tile => tile.enum === 'CapFallE1');
                        const rightCap = capTiles.find(tile => tile.enum === 'CapRiseE1');
                
                        placeCapTile(this.gridService, leftCap, x, y, width, 1);
                        placeCapTile(this.gridService, rightCap, x, y + 1, width, 1);
                    }

                    else if (depth === 'OnePoint5') {
                        const leftCap = capTiles.find(tile => tile.enum === 'CapFallE1');
                        const middleCap = capTiles.find(tile => tile.enum === 'PeakOnePt5E');
                        const rightCap = capTiles.find(tile => tile.enum === 'CapRiseE1');
                
                        placeCapTile(this.gridService, leftCap, x, y, width, 1);
                        placeCapTile(this.gridService, middleCap, x, y + 1, width, 1);
                        placeCapTile(this.gridService, rightCap, x, y + 2, width, 1);
                    }

                    else if (depth === 'Two') {
                        const leftCap1 = capTiles.find(tile => tile.enum === 'CapFallE1');
                        const leftCap2 = capTiles.find(tile => tile.enum === 'CapFallE2');
                        const rightCap1 = capTiles.find(tile => tile.enum === 'CapRiseE2');
                        const rightCap2 = capTiles.find(tile => tile.enum === 'CapRiseE1');
                
                        placeCapTile(this.gridService, leftCap1, x, y, width, 1);
                        placeCapTile(this.gridService, leftCap2, x, y + 1, width, 1);
                        placeCapTile(this.gridService, rightCap1, x, y + 2, width, 1);
                        placeCapTile(this.gridService, rightCap2, x, y + 3, width, 1);
                    }

                    else if (depth === 'TwoPoint5') {
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

                    else if (depth === 'Three') {
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

                else if (depth === 'One' || depth === 'OnePoint5') {
                    const slopeTile1 = slopeTiles.find(tile => tile.enum === 'SlopeS1');
                    placeSlopeTile(this.gridService, slopeTile1, x, y + height - 1, width, 1);

                    if (depth === 'OnePoint5') {
                        const halfSlopeTile = slopeTiles.find(tile => tile.enum === 'SlopeOnePt5S');
                        placeSlopeTile(this.gridService, halfSlopeTile, x, y + 1, width, 1);
                    }
                }

                else if(depth === 'Two' || depth === 'TwoPoint5') {
                    const slopeTile1 = slopeTiles.find(tile => tile.enum === 'SlopeS1');
                    const slopeTile2 = slopeTiles.find(tile => tile.enum === 'SlopeS2');
                    placeSlopeTile(this.gridService, slopeTile1, x, y + height - 1, width, 1);
                    placeSlopeTile(this.gridService, slopeTile2, x, y + height - 2, width, 1);

                    if (depth === 'TwoPoint5') {
                        const halfSlopeTile = slopeTiles.find(tile => tile.enum === 'SlopeTwoPt5S');
                        placeSlopeTile(this.gridService, halfSlopeTile, x, y + height - 3, width, 1);
                    }
                }

                else if(depth === 'Three') {
                    for(let i = 1; i <= 3; i++)
                    {
                        const slopeTile = slopeTiles.find(tile => tile.enum === `SlopeS${i}`);
                        placeSlopeTile(this.gridService, slopeTile, x, y + height - i, width, 1);
                    }
                }
            }

            else if(RoofType == 'FlatTop')
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

        return roofObjectTiles;
    }
    
//     calculateRoofTiles(x: number, y: number, level: number, width: number, height: number, RoofType: string, CapTiles: number, SlopeTiles: number, TopTiles: number) {
//     const roofObjectTiles: SvgTile[] = [];
//     const depth = this.calculateDepth(width, height, RoofType);
//     const capped = { N: true, W: true, E: true, S: true };

//     const building = this.buildingService.getBuilding();

//     type TileMap = { [key: string]: any };

//     const capTiles: TileMap = building.entries[CapTiles - 1].tiles.reduce((map: TileMap, tile) => {
//         if (tile.enum) map[tile.enum] = tile;
//         return map;
//     }, {});

//     const slopeTiles: TileMap = building.entries[SlopeTiles - 1].tiles.reduce((map: TileMap, tile) => {
//         if (tile.enum) map[tile.enum] = tile;
//         return map;
//     }, {});

//     const topTiles: TileMap = building.entries[TopTiles - 1].tiles.reduce((map: TileMap, tile) => {
//         if (tile.enum) map[tile.enum] = tile;
//         return map;
//     }, {});

//     // Helper function for placing tiles
//     const placeTile = (tile: any, x: number, y: number, layer: string, direction = 0) => {
//         if (!tile) return;
//         roofObjectTiles.push({
//             name: `${tile.tile}.png`,
//             url: `${tile.tile}.png`,
//             x: direction === 0 ? x : x + direction,
//             y: direction === 0 ? y + direction : y,
//             offsetX: tile.offset ? Number.parseInt(tile.offset) : 0,
//             offsetY: tile.offset ? Number.parseInt(tile.offset) : 0,
//             layer,
//             level,
//         });
//     };

//     const placeSlopeTile = (slopeTile: any, x: number, y: number, height: number, direction: number) => {
//         if (!slopeTile) return;
//         for (let i = 0; i < height; i++) {
//             const dx = direction === 0 ? x : x + i;
//             const dy = direction === 0 ? y + i : y;
//             const layer = this.gridService.tileExists(dx, dy, level, "Roof") ? 'Roof2' : 'Roof';
//             placeTile(slopeTile, dx, dy, layer, direction);
//         }
//     };

//     const placeCapTile = (capTile: any, x: number, y: number, height: number, direction: number) => {
//         if (!capTile) return;
//         for (let i = 0; i <= height; i++) {
//             if (i === 0 || i === height) {
//                 placeTile(capTile, x, y, 'RoofCap', direction);
//             }
//         }
//     };

//     interface DepthConfig {
//         cap: string[];
//         slope: string[];
//     }

//     const depthConfig: { [key: string]: DepthConfig } = {
//         'Point5': { cap: ['PeakPt5S'], slope: ['SlopePt5E'] },
//         'One': { cap: ['CapRiseS1', 'CapFallS1'], slope: ['SlopeE1'] },
//         'OnePoint5': { cap: ['CapRiseS1', 'PeakOnePt5S', 'CapFallS1'], slope: ['SlopeE1', 'SlopeOnePt5E'] },
//         'Two': { cap: ['CapRiseS1', 'CapRiseS2', 'CapFallS2', 'CapFallS1'], slope: ['SlopeE1', 'SlopeE2'] },
//         'TwoPoint5': { cap: ['CapRiseS1', 'CapRiseS2', 'PeakTwoPt5S', 'CapFallS2', 'CapFallS1'], slope: ['SlopeE1', 'SlopeE2', 'SlopeTwoPt5E'] },
//         'Three': { cap: ['CapRiseS1', 'CapRiseS2', 'CapRiseS3', 'CapFallS3', 'CapFallS2', 'CapFallS1'], slope: ['SlopeE1', 'SlopeE2', 'SlopeE3'] },
//     };

//     const handleDepth = (depthConfig: DepthConfig, direction: number) => {
//         const { cap, slope } = depthConfig;

//         cap.forEach((capEnum, i) => {
//             if (capEnum) {
//                 const capTile = capTiles[capEnum];
//                 placeCapTile(capTile, x + (direction === 0 ? i : 0), y + (direction === 1 ? i : 0), height, direction);
//             }
//         });

//         slope.forEach((slopeEnum, i) => {
//             if (slopeEnum) {
//                 const slopeTile = slopeTiles[slopeEnum];
//                 placeSlopeTile(slopeTile, x + (direction === 0 ? width - 1 - i : 0), y + (direction === 1 ? height - 1 - i : 0), height, direction);
//             }
//         });

//         // Additional logic for roofs wider than 6
//         if (width > 6 && direction === 0) {
//             const middleCap = capTiles['CapGapS3'];
//             if (middleCap) {
//                 for (let j = 3; j < width - 3; j++) {
//                     placeCapTile(middleCap, x + j, y, height, direction);
//                 }
//             }
//         } else if (height > 6 && direction === 1) {
//             const middleCap = capTiles['CapGapE3'];
//             if (middleCap) {
//                 for (let j = 3; j < height - 3; j++) {
//                     placeCapTile(middleCap, x, y + j, height, direction);
//                 }
//             }
//         }
//     };

//     if (RoofType === 'PeakNS' && depthConfig[depth]) {
//         handleDepth(depthConfig[depth], 0);
//     } else if (RoofType === 'PeakWE' && depthConfig[depth]) {
//         handleDepth(depthConfig[depth], 1);
//     } else if (RoofType === 'FlatTop') {
//         const flatRoofTile = topTiles['West3'];
//         if (flatRoofTile) {
//             for (let i = 0; i < height; i++) {
//                 for (let j = 0; j < width; j++) {
//                     const roofTileExists = this.gridService.tileExists(x + j, y + i, level, "Floor");
//                     const layer = roofTileExists ? 'FloorOverlay' : 'Floor';
//                     placeTile(flatRoofTile, x + j, y + i, layer);
//                 }
//             }
//         }
//     }

//     return roofObjectTiles;
// }

    
    


    
}