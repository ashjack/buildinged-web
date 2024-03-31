import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SvgTile } from '../../models/app.models';
import { DbService } from '../../services/db.service';
import { liveQuery } from 'dexie';
import * as fromRoot from '../../app.reducers';
import { Store } from "@ngrx/store";
import { HttpClient } from '@angular/common/http';
import { BEntry, BEntryItem, BFurniture, BFurnitureGroup, VisualFurniture, VisualFurnitureEntry } from 'src/app/models/furniture-window.models';
import { SetSelectedFurniture } from 'src/app/app.actions';


@Component({
  selector: 'app-furniture-selection-menu',
  templateUrl: './furniture-selection-menu.component.html',
  styleUrls: ['./furniture-selection-menu.component.scss']
})
export class FurnitureSelectionMenuComponent implements OnInit{
  constructor(private sanitizer: DomSanitizer, private db: DbService, private http: HttpClient, private store: Store<fromRoot.State>,) { }

  selectedTileset: string = 'walls_exterior_house_01';
  selectedFurnitureGroup: string = 'Advertising';

  tilesets: string[] = [];
  tiles: SvgTile[] = [];

  furnitureGroups: BFurnitureGroup[] = [];
  furnitureTiles: VisualFurniture[] = [];

  selectedFurniture: VisualFurniture | undefined;
  selectedFurnitureOrient: string;

  ngOnInit(): void {
    this.http.get('assets/BuildingFurniture.txt', { responseType: 'text' }).subscribe((data: any) => {
      console.log(data);
      this.furnitureGroups = this.parseCustomFile(data);
    });

    this.getTilesets();
    this.furnitureGroups.find(x => x.label == this.getSelectedFurnitureGroup())
    this.getIndividualTiles(this.furnitureGroups[this.furnitureGroups.findIndex(x => x.label == this.getSelectedFurnitureGroup())]);
  }

  parseCustomFile(content: string): any {
    const lines = content.split('\n');
    const data: BFurnitureGroup[] = [];
    let currentGroup: BFurnitureGroup | undefined;
    let currentFurniture: BFurniture | undefined;
    let currentEntry: BEntry | undefined;
    let prevLine = ""

    for (let line of lines) {
      line = line.trim();
      if (line === '' || line.startsWith('//')) continue;
  
      if(line === '{')
      {
        if(prevLine === 'group') //Add new furniture group
        {
          currentGroup = { label: '', furniture: [] }
        }
        else if(prevLine === 'furniture') //Add new furniture item to group
        {
          currentFurniture = { entries: [] }
        }
        else if(prevLine === 'entry')
        {
          currentEntry = { orient: '', items: [] }
        }
      }

      else if(line.includes('='))
      {
        const key = line.split('=')[0].trim();
        const value = line.split('=')[1].trim();
        if(key === 'label' && currentGroup)
        {
          currentGroup.label = value;
        }
        else if(key === 'orient' && currentEntry)
        {
          currentEntry.orient = value;
        }
        else if(key.includes(',') && currentEntry)
        {
          currentEntry.items.push({ pos: key, tile: value })
        }
      }

      else if(line.includes('}'))
      {
        if (currentEntry) 
        {
          currentFurniture?.entries.push({ ...currentEntry }); // Pushing a clone of currentEntry
          currentEntry = undefined;
        } 
        else if (currentFurniture) 
        {
          currentGroup?.furniture.push({ ...currentFurniture }); // Pushing a clone of currentFurniture
          currentFurniture = undefined;
        } 
        else if (currentGroup) 
        {
          data.push({ ...currentGroup }); // Pushing a clone of currentGroup
          currentGroup = undefined;
        }
      }

      prevLine = line;
    }
    
    console.log(data)
    return data;
  }

  retTiles: SvgTile[] = [];
  
  // getFurnitureTiles(groupName: string): VisualFurniture[] {
  //   const group = this.furnitureGroups.find(x => x.label == groupName);
  //   this.retTiles = [];
  //   if(!group)
  //   {
  //     return [];
  //   }

  //   const ret: VisualFurniture[] = [];

  //   group.furniture.forEach((furniture) => {
  //     furniture.entries.forEach((entry) => {
  //       entry.items.forEach((item) => {
  //         console.log('checking', item.tile + ".png")
  //         console.log(this.tiles)
  //         const tile = this.tiles.find(x => x.name === item.tile + ".png");
  //         this.tiles.forEach((t) => {
  //           if(t.name === item.tile + ".png")
  //           {
  //             console.log('Matched', t.name, item.tile + ".png")
  //           }
  //           else
  //           {
  //             console.log('DID NOT MATCH', t.name, item.tile + ".png")
  //           }
  //         })
  //         if(tile)
  //         {
  //           console.log('Found', tile.name)
  //           this.retTiles.push({
  //             x: Number.parseInt(item.pos.split(',')[0]),
  //             y: Number.parseInt(item.pos.split(',')[1]),
  //             url: tile.url,
  //             layer: 'Furniture',
  //             level: 0
  //           })
  //         }
  //       })

  //       console.log('pushing', group.label)
  //       ret.push({
  //         orient: entry.orient,
  //         tiles: this.retTiles
  //       })
  //     })
  //   })

  //   console.log(ret)
  //   return ret;
  // }

  async getTilesets() {
    const ret =  await this.db.getTilesets();
    ret.forEach((tileset) => {
      this.tilesets.push(tileset.name);
    });
    return ret;
  }

  async getIndividualTiles(furnitureGroup: BFurnitureGroup) {
    this.tiles = [];
    this.furnitureTiles = [];
  
    for (const furniture of furnitureGroup.furniture) {
      
      let retEntry: VisualFurnitureEntry[] = [];
      let maxX = 0;
      let maxY = 0;
  
      for (const entry of furniture.entries) {
        let retTiles: SvgTile[] = [];
        maxX = 0;
        maxY = 0;
        for (const item of entry.items) {
          try {
            const tile = await this.db.getTile(item.tile + ".png");
            if (tile) {
              const x = Number.parseInt(item.pos.split(',')[0]);
              const y = Number.parseInt(item.pos.split(',')[1]);

              maxX = (x > maxX) ? x : maxX;
              maxY = (y > maxY) ? y : maxY;

              const newTile = {
                name: tile.name,
                url: this.sanitizer.bypassSecurityTrustResourceUrl(tile.url),
                x: x,
                y: y,
                layer: this.getSelectedLayer(),
                level: this.getSelectedLevel(),
              };
              this.tiles.push(newTile);
              retTiles.push(newTile);
            }
          } catch (error) {
            // Handle error fetching tile
            console.error("Error fetching tile:", error);
          }
        }

        retEntry.push({
          orient: entry.orient,
          tiles: [...retTiles],
          xSize: maxX,
          ySize: maxY
          // tiles: [...retTiles].sort((a, b) => {
          //   if (entry.orient === 'W' || entry.orient === 'E') {
          //     // If orient is 'W' or 'E', sort by reverse x and then by y
          //     if (a.x === b.x) {
          //       return a.y - b.y; // Compare by y if x values are equal
          //     }
          //     return b.x - a.x; // Compare by reverse x
          //   } else {
          //     // For other orientations, sort by x and then by y
          //     if (a.x === b.x) {
          //       return a.y - b.y; // Compare by y if x values are equal
          //     }
          //     return a.x - b.x; // Compare by x
          //   }
          // })
        });
      }
      // Push retTiles for each entry
      this.furnitureTiles.push({
        entries: retEntry
      });
    }
  
    console.log(this.tiles);
  }
  
  

  setSelectedTile(tileName: string) {
    console.log(tileName);
    localStorage.setItem('selectedTile', tileName);
  }

  getSelectedTile(): string {
    return localStorage.getItem('selectedTile') || 'walls_exterior_house_01_0.png';
  }

  setSelectedLayer(layer: string) {
    console.log(layer);
    localStorage.setItem('selectedLayer', layer);
  }

  getSelectedLayer(): string {
    return localStorage.getItem('selectedLayer') || 'Walls';
  }

  setSelectedLevel(level: number) {
    console.log(level);
    localStorage.setItem('selectedLevel', level.toString());
  }

  getSelectedLevel(): number {
    return parseInt(localStorage.getItem('selectedLevel') || '0');
  }

  setSelectedTileset(tileset: string) {
    console.log(tileset);
    localStorage.setItem('selectedTileset', tileset);
    this.selectedTileset = tileset;
    //this.getIndividualTiles(tileset);
  }

  getSelectedTileset(): string {
    return localStorage.getItem('selectedTileset') || 'walls_exterior_house_01';
  }

  setSelectedFurnitureGroup(group: string) {
    localStorage.setItem('selectedFurnitureGroup', group);
    this.selectedFurnitureGroup = group;

    const fGroup = this.furnitureGroups.find(x => x.label == group);

    if(fGroup)
    {
      this.getIndividualTiles(fGroup)//.then(() => {
        //this.furnitureTiles = this.getFurnitureTiles(group);
      //});
    }
  }

  getSelectedFurnitureGroup(): string {
    return localStorage.getItem('selectedFurnitureGroup') || 'Advertising';
  }

  setSelectedFurniture(group: VisualFurniture, orient: string) {
    this.selectedFurniture = group;
    this.selectedFurnitureOrient = orient;
    this.store.dispatch(new SetSelectedFurniture(group, orient));
  }

  //Helper functions
  abs(a: number): number {
    return Math.abs(a);
  }
}
