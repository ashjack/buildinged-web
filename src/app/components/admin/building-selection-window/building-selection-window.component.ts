
import { Component, OnInit } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { TileService } from 'src/app/services/tile.service';
import * as fromRoot from '../../../app.reducers';
import { Store } from "@ngrx/store";
import { BuildingService } from 'src/app/services/building.service';
import { ApiService } from 'src/app/services/api.service';

@Component({
    selector: 'app-building-selection-window',
    templateUrl: './building-selection-window.component.html',
    styleUrls: ['./building-selection-window.component.scss']
  })
  export class BuildingSelectionWindowComponent implements OnInit{

    buildings: any[] = [];
    listBuildings: boolean;
    showWindow: boolean = true;

    constructor(private sanitizer: DomSanitizer, private buildingService: BuildingService, private store: Store<fromRoot.State>,
                private apiService: ApiService) { } 

    ngOnInit(): void {
      this.getBuildingsByProjectName('ThamesValley');
    }

    async getBuildingsByProjectName(projectName: string) {
      const buildings = await this.apiService.getBuildingsByProjectName(projectName);
      console.log(buildings);
      this.buildings = buildings;
    }

    createXml(): void {
        this.buildingService.saveBuildingToXml();
      }
    
      openFileUpload(): void {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.tbx';
        fileInput.addEventListener('change', this.handleFileSelect.bind(this));
        fileInput.click();
      }
    
      handleFileSelect(event: Event): void {
        const inputElement = event.target as HTMLInputElement;
        const fileList = inputElement.files;
        console.log(fileList)
    
        if(!fileList || fileList.length === 0)
        {
          return;
        }
    
        const file = fileList[0];
        const reader = new FileReader();
        reader.onload = (e) => {
          const contents = e.target?.result;
          const constentsString = contents as string;
    
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(constentsString,"text/xml");
          this.buildingService.createBuildingFromXml(xmlDoc);
          console.log(xmlDoc);
        }
        reader.readAsText(file);
        this.showWindow = false;
      }

      openBuildingList(): void {
        this.listBuildings = true;
      }

      loadBuilding(xml: string): void {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml,"text/xml");
        this.buildingService.createBuildingFromXml(xmlDoc);
        this.showWindow = false;
      }

      closeWindow(): void {
        this.showWindow = false;
      }
  }