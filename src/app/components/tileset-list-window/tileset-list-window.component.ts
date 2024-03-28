import { Component, OnInit } from "@angular/core";
import { DomSanitizer } from "@angular/platform-browser";
import { Observable, interval } from "rxjs";
import { Tilepack } from "src/app/models/app.models";
import { DbService } from "src/app/services/db.service";
import { TileService } from "src/app/services/tile.service";
import * as fromRoot from '../../app.reducers';
import { Store } from '@ngrx/store';
import { TogglePopup } from "src/app/app.actions";

@Component({
    selector: 'app-tileset-list-window',
    templateUrl: './tileset-list-window.component.html',
    styleUrls: ['./tileset-list-window.component.scss']
  })
  export class TilesetListWindowComponent implements OnInit{
    constructor(private sanitizer: DomSanitizer, private db: DbService, private tileService: TileService, private store: Store<fromRoot.State>) { 
        this.isOpen$ = this.store.select(fromRoot.isPopupOpen('tileset-list'));
    }

    tilepacks: Tilepack[] = [];
    isOpen$: Observable<boolean>;



    ngOnInit(): void {
        interval(1000).subscribe(() => {
            this.tilepacks = this.tileService.tilepacks

            this.tilepacks.forEach((pack) => {
                if(localStorage.getItem(pack.name) == '1')
                {
                    pack.enabled = true;
                }
                else
                {
                    pack.enabled = false;
                }
            })
        });
    }

    close()
    {
        this.store.dispatch(new TogglePopup('tileset-list', false))
    }

    downloadPack(name: string) {
        if(localStorage.getItem(name) == '1')
        {
            localStorage.setItem(name, '0');
            return;   
        }
        else if(localStorage.getItem(name) == '0')
        {
            localStorage.setItem(name, '1');
            return;   
        }

        localStorage.setItem(name, '1');
        const packIndex = this.tileService.tilepacks.findIndex(x => x.name == name);
        this.tileService.processTilepacks(this.tileService.tilepacks, packIndex);
    }
  }