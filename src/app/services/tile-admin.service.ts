import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { FurnitureDocument } from '../models/furniture-window.models';

export interface AdminTilepack {
  id: string | null;
  name: string;
  url: string;
  format: 'zip' | 'json';
  exists: boolean;
  size: number | null;
  updatedAt: string | null;
}

export interface TilepackTarget { packId: string; create: boolean; name?: string; }
export interface PublishedTilepack { id: string; sheets: number; size: number; updatedAt: string; }

@Injectable({ providedIn: 'root' })
export class TileAdminService {
  constructor(private http: HttpClient, private auth: AuthService) { }

  private async request<T>(method: string, path: string, body?: object): Promise<T> {
    const token = await this.auth.token();
    try {
      return await firstValueFrom(this.http.request<T>(method, `${this.auth.adminApiBaseUrl}${path}`, {
        body, headers: { Authorization: `Bearer ${token}` }
      }));
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        const payload: unknown = error.error;
        throw new Error(typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
          ? payload.error : `Admin request failed (${error.status}).`);
      }
      throw error;
    }
  }

  async list(): Promise<AdminTilepack[]> {
    return (await this.request<{ packs: AdminTilepack[] }>('GET', '/tilepacks')).packs;
  }

  /** The published furniture file, or null text before the first save. */
  getFurniture(): Promise<{ text: string | null; generation: number }> {
    return this.request('GET', '/furniture');
  }

  /** Saves only if nobody else saved since `generation` was read; the server rejects stale saves with an error. */
  saveFurniture(document: FurnitureDocument, generation: number): Promise<{ generation: number; revision: number }> {
    return this.request('PUT', '/furniture', { document, generation });
  }

  /** Uploads straight to Cloud Storage through a one-object session, then asks the server to validate and publish it. */
  async upload(target: TilepackTarget, file: File, onProgress: (fraction: number) => void): Promise<PublishedTilepack> {
    const { uploadId, uploadUrl } = await this.request<{ uploadId: string; uploadUrl: string }>(
      'POST', '/tilepacks/uploads', { ...target, size: file.size });
    await new Promise<void>((resolve, reject) => {
      this.http.put(uploadUrl, file.slice(0, file.size, 'application/zip'), { reportProgress: true, observe: 'events', responseType: 'text' })
        .subscribe({
          next: event => { if (event.type === HttpEventType.UploadProgress && event.total) onProgress(event.loaded / event.total); },
          error: () => reject(new Error('Uploading the zip to storage failed. Check your connection and try again.')),
          complete: () => resolve(),
        });
    });
    onProgress(1);
    return this.request<PublishedTilepack>('POST', '/tilepacks/publish', { ...target, uploadId });
  }
}
