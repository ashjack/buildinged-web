import { Component, EventEmitter, Input, Output } from '@angular/core';
import { WorldedCell } from '../../utils/worlded-world';

@Component({
  selector: 'app-worlded-cell-panel',
  templateUrl: './worlded-cell-panel.component.html',
  styleUrls: ['./worlded-cell-panel.component.scss'],
})
export class WorldedCellPanelComponent {
  @Input() cell?: WorldedCell;
  @Input() mapAvailable = false;
  @Input() busy = false;
  @Input() lotCount = 0;
  @Output() openCell = new EventEmitter<void>();
}
