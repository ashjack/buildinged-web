import { Component } from "@angular/core";
import { Observable } from "rxjs";
import { Tilepack } from "src/app/models/app.models";
import { TileService } from "src/app/services/tile.service";
import * as fromRoot from '../../app.reducers';
import { Store } from '@ngrx/store';
import { TogglePopup } from "src/app/app.actions";
import { isTilepackRequired, isTilepackSelected } from '../../utils/tilepack-manifest';

@Component({
    selector: 'app-tileset-list-window',
    templateUrl: './tileset-list-window.component.html',
    styleUrls: ['./tileset-list-window.component.scss']
  })
  export class TilesetListWindowComponent {
    constructor(private tileService: TileService, private store: Store<fromRoot.State>) {
        this.isOpen$ = this.store.select(fromRoot.isPopupOpen('tileset-list'));
    }

    get tilepacks(): Tilepack[] {
        return this.tileService.tilepacks.filter(pack => !pack.disabled);
    }
    isOpen$: Observable<boolean>;
    readonly isRequired = isTilepackRequired;
    readonly isEnabled = isTilepackSelected;

    close()
    {
        this.store.dispatch(new TogglePopup('tileset-list', false))
    }

    downloadPack(name: string, redownload = false) {
        const selectedPack = this.tileService.tilepacks.find(x => x.name == name);
        if (!selectedPack || selectedPack.disabled || (!redownload && isTilepackRequired(selectedPack))) return;

        selectedPack.enabled = redownload || !isTilepackSelected(selectedPack);
        localStorage.setItem(name, selectedPack.enabled ? '1' : '0');
        if (redownload) {
            void this.tileService.redownloadTilepack(selectedPack);
        } else if (selectedPack.enabled) {
            void this.tileService.processTilepacks([selectedPack], 0);
        }
    }
  }
