import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { SiteDataService } from '../../services/site-data.service';
import { SettingsComponent } from './settings.component';

describe('SettingsComponent', () => {
  let fixture: ComponentFixture<SettingsComponent>;
  let component: SettingsComponent;
  let siteData: jasmine.SpyObj<SiteDataService> & { downloading: boolean; downloadProgress$: Subject<void> };
  const button = () => fixture.nativeElement.querySelector('button.danger') as HTMLButtonElement;

  beforeEach(() => {
    siteData = Object.assign(jasmine.createSpyObj<SiteDataService>('SiteDataService', ['clear']),
      { downloading: false, downloadProgress$: new Subject<void>() });
    siteData.clear.and.resolveTo();
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [SettingsComponent],
      providers: [{ provide: SiteDataService, useValue: siteData }],
    });
    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    spyOn(component, 'reload');
    fixture.detectChanges();
  });

  it('clears data and reloads only after confirmation', async () => {
    const confirm = spyOn(window, 'confirm').and.returnValue(false);
    button().click();
    await fixture.whenStable();
    expect(siteData.clear).not.toHaveBeenCalled();

    confirm.and.returnValue(true);
    button().click();
    await fixture.whenStable();
    expect(siteData.clear).toHaveBeenCalledTimes(1);
    expect(component.reload).toHaveBeenCalled();
  });

  it('shows a failure without reloading', async () => {
    spyOn(window, 'confirm').and.returnValue(true);
    siteData.clear.and.rejectWith(new Error('Blocked'));
    await component.clearData();
    fixture.detectChanges();
    expect(component.reload).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Blocked');
    expect(button().disabled).toBeFalse();
  });

  it('disables the button while tiles are downloading and re-enables it when they finish', () => {
    siteData.downloading = true;
    siteData.downloadProgress$.next();
    fixture.detectChanges();
    expect(button().disabled).toBeTrue();

    siteData.downloading = false;
    siteData.downloadProgress$.next();
    fixture.detectChanges();
    expect(button().disabled).toBeFalse();
  });
});
