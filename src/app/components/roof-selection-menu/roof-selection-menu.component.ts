import { Component, OnInit } from '@angular/core';
import { RoofService } from 'src/app/services/roof.service';

@Component({
  selector: 'app-roof-selection-menu',
  templateUrl: './roof-selection-menu.component.html',
  styleUrls: ['./roof-selection-menu.component.scss']
})
export class RoofSelectionMenuComponent implements OnInit {
  constructor(public roofService: RoofService) { }

  roofOptions = this.roofService.roofOptions;
  selectedRoofOptionId: string;

  ngOnInit(): void {
    this.selectedRoofOptionId = this.roofService.getSelectedRoofOptionId();
  }

  selectRoofOption(optionId: string): void {
    this.selectedRoofOptionId = optionId;
    this.roofService.setSelectedRoofOptionId(optionId);
  }

  isSelected(optionId: string): boolean {
    return this.selectedRoofOptionId === optionId;
  }
}
