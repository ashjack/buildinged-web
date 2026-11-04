import { Component, OnInit } from '@angular/core';
import { AdminTilepack, TileAdminService, TilepackTarget } from '../../services/tile-admin.service';
import { AuthService } from '../../services/auth.service';

const MAX_ZIP_BYTES = 1024 ** 3;
const NEW_PACK = '__new__';

@Component({
  selector: 'app-tile-admin',
  templateUrl: './tile-admin.component.html',
  styleUrls: ['./tile-admin.component.scss']
})
export class TileAdminComponent implements OnInit {
  packs: AdminTilepack[] = [];
  loading = false;
  error = '';
  notice = '';
  uploadingKey: string | null = null;
  progress = 0;

  showCreate = false;
  newName = '';
  newId = '';
  newFile: File | null = null;
  private idEdited = false;
  readonly newPackKey = NEW_PACK;

  constructor(private tileAdmin: TileAdminService, public auth: AuthService) { }

  ngOnInit() { void this.load(); }

  async load() {
    this.loading = true;
    this.error = '';
    try { this.packs = await this.tileAdmin.list(); }
    catch (error) { this.error = this.message(error); }
    finally { this.loading = false; }
  }

  onNameChange(name: string) {
    this.newName = name;
    if (!this.idEdited) this.newId = TileAdminComponent.slugify(name);
  }

  onIdChange(id: string) {
    this.newId = id;
    this.idEdited = !!id;
  }

  onNewFile(input: HTMLInputElement) { this.newFile = input.files?.[0] ?? null; }

  get newIdValid(): boolean { return /^[a-z0-9][a-z0-9_-]{0,47}$/.test(this.newId); }

  async createPack() {
    if (!this.newFile || !this.newName.trim() || !this.newIdValid) return;
    const name = this.newName.trim();
    if (await this.upload(NEW_PACK, { packId: this.newId, create: true, name }, this.newFile)) {
      this.cancelCreate();
    }
  }

  cancelCreate() {
    this.showCreate = false;
    this.newName = this.newId = '';
    this.newFile = null;
    this.idEdited = false;
  }

  async replace(pack: AdminTilepack, input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !pack.id) return;
    if (!confirm(`Replace "${pack.name}" with ${file.name}? Users will re-download the pack the next time they open the editor.`)) return;
    await this.upload(pack.id, { packId: pack.id, create: false }, file);
  }

  private async upload(key: string, target: TilepackTarget, file: File): Promise<boolean> {
    if (this.uploadingKey) return false;
    this.error = this.notice = '';
    if (!/\.zip$/i.test(file.name)) { this.error = 'Choose a .zip file.'; return false; }
    if (file.size > MAX_ZIP_BYTES) { this.error = 'Zips must be 1 GB or smaller.'; return false; }
    this.uploadingKey = key;
    this.progress = 0;
    try {
      const result = await this.tileAdmin.upload(target, file, fraction => this.progress = fraction);
      this.notice = `Published ${target.name || target.packId} (${result.sheets} tilesheets).`;
      await this.load();
      return true;
    } catch (error) {
      this.error = this.message(error);
      return false;
    } finally {
      this.uploadingKey = null;
    }
  }

  formatSize(bytes: number | null): string {
    if (bytes == null) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(unit && value < 10 ? 1 : 0)} ${units[unit]}`;
  }

  static slugify(name: string): string {
    return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong.';
  }
}
