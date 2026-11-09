import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { SiteDataService } from '../../services/site-data.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnDestroy {
  clearing = false;
  error = '';
  private readonly progress: Subscription;

  constructor(readonly siteData: SiteDataService, private readonly changeDetector: ChangeDetectorRef) {
    this.progress = siteData.downloadProgress$.subscribe(() => changeDetector.markForCheck());
  }

  ngOnDestroy(): void { this.progress.unsubscribe(); }

  async clearData(): Promise<void> {
    if (this.clearing || !confirm('Clear all saved site data? Downloaded tiles will be downloaded again when needed, ' +
      'cached world files will download again, and local TileZed files will need to be selected again. Project worlds on the server will be kept.')) return;
    this.clearing = true;
    this.error = '';
    this.changeDetector.markForCheck();
    try {
      await this.siteData.clear();
      // Services hold in-memory copies of the cleared data; start fresh.
      this.reload();
    } catch (error) {
      this.error = `Could not clear saved data: ${error instanceof Error ? error.message : String(error)}`;
      this.clearing = false;
      this.changeDetector.markForCheck();
    }
  }

  reload(): void { location.reload(); }
}
