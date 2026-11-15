import { Component, OnInit } from '@angular/core';
import { RoofDimension, RoofService } from 'src/app/services/roof.service';

@Component({
  selector: 'app-roof-selection-menu',
  templateUrl: './roof-selection-menu.component.html',
  styleUrls: ['./roof-selection-menu.component.scss']
})
export class RoofSelectionMenuComponent implements OnInit {
  constructor(public roofService: RoofService) { }

  roofOptions = this.roofService.roofOptions;
  selectedRoofOptionId: string;
  readonly wings: { label: string; fields: { key: RoofDimension; label: string; name: string }[] }[] = [
    { label: 'Main wing', fields: [{ key: 'mainLength', label: 'Length', name: 'Main wing length' }, { key: 'mainWidth', label: 'Width', name: 'Main wing width' }] },
    { label: 'Return wing', fields: [{ key: 'returnLength', label: 'Length', name: 'Return wing length' }, { key: 'returnWidth', label: 'Width', name: 'Return wing width' }] },
  ];

  dimensionMax(key: RoofDimension): number { return key.endsWith('Width') ? this.roofService.compoundMaxWidth : 256; }
  stepDimension(key: RoofDimension, amount: number): void {
    this.roofService.configureDimension(key, this.roofService.compoundDimensions[key] + amount);
  }
  enterDimension(key: RoofDimension, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value.trim()) this.roofService.configureDimension(key, input.valueAsNumber);
    input.value = String(this.roofService.compoundDimensions[key]);
  }
  stepRotation(amount: number): void {
    this.roofService.configureCompound('RoofRotation', Math.min(3, Math.max(0, this.roofService.compoundRotation + amount)));
  }
  enterRotation(event: Event): void {
    const input = event.target as HTMLInputElement, degrees = input.valueAsNumber;
    if (Number.isFinite(degrees) && degrees % 90 === 0 && degrees >= 0 && degrees <= 270) this.roofService.configureCompound('RoofRotation', degrees / 90);
    input.value = String(this.roofService.compoundRotation * 90);
  }

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
