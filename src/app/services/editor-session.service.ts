import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Contribution, VariantDocument } from '../models/project.models';
import { Building } from '../models/app.models';
import * as fromRoot from '../app.reducers';
import { AuthService } from './auth.service';
import { ProjectApiService } from './project-api.service';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { SetDocumentLocked } from '../app.actions';

export interface DocumentCacheTarget {
  key: string;
  revision?: number;
}

@Injectable({ providedIn: 'root' })
export class EditorSessionService {
  contribution?: Contribution;
  savedXml = '';
  message = '';
  error = '';
  busy = false;
  private building?: Building;
  private checkedBuilding?: Building;
  private checkedSavedXml = '';
  private checkedDirty = false;
  private epoch = 0;

  constructor(private store: Store<fromRoot.State>, private auth: AuthService, private api: ProjectApiService) {
    this.store.select(fromRoot.getBuilding).subscribe(building => this.building = building);
  }

  get editable(): boolean {
    return !!this.contribution && this.contribution.createdBy === this.auth.user?.uid &&
      ['draft', 'changes_requested'].includes(this.contribution.status);
  }
  get cacheTarget(): DocumentCacheTarget {
    const item = this.contribution;
    return item && this.auth.user ? {
      key: `buildinged:draft:${this.auth.user.uid}:${item.projectId}:${item.id}`,
      revision: item.revision
    } : { key: 'buildingXml' };
  }
  get dirty(): boolean {
    if (!this.contribution || !this.building || !this.editable) return false;
    if (this.checkedBuilding !== this.building || this.checkedSavedXml !== this.savedXml) {
      this.checkedBuilding = this.building;
      this.checkedSavedXml = this.savedXml;
      this.checkedDirty = this.serialize() !== this.savedXml;
    }
    return this.checkedDirty;
  }
  serialize(): string {
    if (!this.building) throw new Error('No building is open.');
    return new XMLSerializer().serializeToString(writeBuildingFile(this.building));
  }

  begin(document: VariantDocument, recover = true): string {
    this.epoch++;
    this.busy = false;
    this.contribution = document.contribution;
    this.savedXml = new XMLSerializer().serializeToString(writeBuildingFile(
      readBuildingFile(new DOMParser().parseFromString(document.xml, 'text/xml'))));
    this.error = '';
    this.message = '';
    this.checkedBuilding = undefined;
    if (!recover || !this.editable) return document.xml;
    const raw = localStorage.getItem(this.cacheTarget.key);
    if (!raw) return document.xml;
    let cache: unknown;
    try { cache = JSON.parse(raw); } catch (error) {
      this.error = 'The local recovery copy is unreadable. The cloud document was loaded instead.';
      console.error(this.error, error);
      return document.xml;
    }
    if (typeof cache !== 'object' || !cache || !('xml' in cache) || typeof cache.xml !== 'string' ||
        !('revision' in cache) || typeof cache.revision !== 'number' || !Number.isSafeInteger(cache.revision)) {
      this.error = 'The local recovery copy is invalid. The cloud document was loaded instead.';
      return document.xml;
    }
    if (cache.xml === this.savedXml) return document.xml;
    this.contribution = { ...document.contribution, revision: cache.revision };
    this.message = cache.revision === document.contribution.revision
      ? 'Recovered your local unsaved draft.'
      : 'Recovered a local draft based on an older cloud revision. Export it before reloading the latest cloud copy.';
    return cache.xml;
  }

  async save(): Promise<boolean> {
    if (!this.editable || !this.contribution || this.busy) return false;
    this.busy = true;
    this.store.dispatch(new SetDocumentLocked(true));
    this.error = '';
    this.message = 'Saving draft...';
    const item = this.contribution;
    const epoch = this.epoch;
    try {
      const xml = this.serialize();
      const updated = await this.api.save(item.id, xml, item.revision);
      if (epoch !== this.epoch) return false;
      this.contribution = updated;
      this.savedXml = xml;
      this.message = 'Draft saved to the project.';
      this.cacheCurrent();
      return true;
    } catch (error) {
      if (epoch !== this.epoch) return false;
      this.error = error instanceof Error ? error.message : String(error);
      this.message = 'Save failed. Your local draft has not been discarded.';
      return false;
    } finally {
      if (epoch === this.epoch) {
        this.busy = false;
        this.store.dispatch(new SetDocumentLocked(!!this.contribution && !this.editable));
      }
    }
  }

  async submit(): Promise<void> {
    if (!this.contribution || !this.editable || this.busy) return;
    if (!(await this.save())) return;
    if (this.dirty) {
      this.error = 'Your document changed while saving. Save the latest edits before submitting.';
      return;
    }
    this.busy = true;
    this.store.dispatch(new SetDocumentLocked(true));
    const epoch = this.epoch;
    const item = this.contribution;
    try {
      const updated = await this.api.submit(item.id, item.revision);
      if (epoch !== this.epoch) return;
      this.contribution = updated;
      this.message = 'Submitted for review. The original build is unchanged.';
    } catch (error) {
      if (epoch === this.epoch) this.error = error instanceof Error ? error.message : String(error);
    }
    finally {
      if (epoch === this.epoch) {
        this.busy = false;
        this.store.dispatch(new SetDocumentLocked(!!this.contribution && !this.editable));
      }
    }
  }

  cacheCurrent(): void {
    if (!this.editable) return;
    try {
      localStorage.setItem(this.cacheTarget.key, JSON.stringify({ xml: this.serialize(), revision: this.contribution!.revision }));
    } catch (error) {
      this.error = 'Could not save a local recovery copy. Export your draft before leaving.';
      console.error(this.error, error);
    }
  }
  end(): void {
    this.epoch++;
    this.busy = false;
    this.store.dispatch(new SetDocumentLocked(false));
    this.contribution = undefined;
    this.savedXml = '';
    this.message = this.error = '';
  }
  canLeave(): boolean {
    if (this.busy) {
      window.alert('Wait for the project save or submission to finish.');
      return false;
    }
    if (!this.dirty) return true;
    this.cacheCurrent();
    return window.confirm('Leave with unsaved project changes? A local recovery copy will be kept on this browser.');
  }
}
