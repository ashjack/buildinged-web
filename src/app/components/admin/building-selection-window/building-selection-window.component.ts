
import { Component, OnInit } from '@angular/core';
import * as fromRoot from '../../../app.reducers';
import { Store } from "@ngrx/store";
import { BuildingService } from 'src/app/services/building.service';
import { ApiService } from 'src/app/services/api.service';
import { Observable } from 'rxjs';
import { Building } from 'src/app/models/app.models';
import { TogglePopup } from 'src/app/app.actions';

@Component({
    selector: 'app-building-selection-window',
    templateUrl: './building-selection-window.component.html',
    styleUrls: ['./building-selection-window.component.scss']
  })
  export class BuildingSelectionWindowComponent implements OnInit{

    openBuilding$: Observable<Building | undefined>;

    buildings: any[] = [];
    listBuildings: boolean;
    showWindow: boolean = true;
    forceShowWindow$: Observable<boolean>;
    templateNames: string[] = [];
    selectedTemplateName: string = '';
    showTemplatePicker: boolean = false;

    constructor(private buildingService: BuildingService, private store: Store<fromRoot.State>,
                private apiService: ApiService) { 
                  this.forceShowWindow$ = this.store.select(fromRoot.isPopupOpen('main-menu'));
                } 

    async ngOnInit(): Promise<void> {
      this.getBuildingsByProjectName('ThamesValley');
      this.openBuilding$ = this.store.select(fromRoot.getBuilding);

      this.templateNames = await this.buildingService.getTemplateNames();
      if (this.templateNames.length > 0) {
        this.selectedTemplateName = this.templateNames[0];
      }

      this.openBuilding$.subscribe((building) => {
        if(building) {
          this.closeWindow();
        }
      });
    }

    async getBuildingsByProjectName(projectName: string) {
      const buildings = await this.apiService.getBuildingsByProjectName(projectName);
      console.log(buildings);
      this.buildings = buildings;
    }

    createXml(): void {
        this.buildingService.saveBuildingToXml();
      }

      openTemplatePicker(): void {
        this.showTemplatePicker = true;
      }

      cancelTemplatePicker(): void {
        this.showTemplatePicker = false;
      }

      async createNewBuilding(): Promise<void> {
        await this.buildingService.createNewBuilding(this.selectedTemplateName);
        this.showTemplatePicker = false;
        this.closeWindow();
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
        this.store.dispatch(new TogglePopup('main-menu', false));
      }
  }