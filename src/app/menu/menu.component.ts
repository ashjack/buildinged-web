import { Component } from '@angular/core';
import * as fromRoot from '../app.reducers';
import { Store } from '@ngrx/store';
import { SetCurrentTool } from '../app.actions';
import { BuildingService } from '../services/building.service';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss']
})
export class MenuComponent {
  constructor(
    private store: Store<fromRoot.State>,
    private buildingService: BuildingService,
  ) { }

  setTool(tool: string)
  {
    this.store.dispatch(new SetCurrentTool(tool));
  }

  openFileUpload(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
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

    

  }
}
