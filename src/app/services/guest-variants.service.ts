import { Injectable } from '@angular/core';
import { ProjectApiService } from './project-api.service';
import { AuthService } from './auth.service';
import { Contribution, ProjectTask, VariantDocument } from '../models/project.models';
import { THAMES_VALLEY_PROJECT_ID } from '../utils/default-project';

export interface GuestVariant extends VariantDocument { localId: string; requestId: string; }

@Injectable({ providedIn: 'root' })
export class GuestVariantsService {
  recoveryWarning = '';
  constructor(private api: ProjectApiService, private auth: AuthService) { }
  private get prefix(): string { return `buildinged:guest:${encodeURIComponent(this.auth.apiBaseUrl)}:`; }
  private metaKey(id: string): string { return `${this.prefix}${id}:metadata`; }
  cacheTarget(id: string): { key: string; revision: number } { return { key: `${this.prefix}${id}:xml`, revision: 1 }; }
  async create(task: ProjectTask, name: string): Promise<GuestVariant> {
    const source = await this.api.request<{ task: ProjectTask; xml: string }>('GET', `/guest/tasks/${encodeURIComponent(task.id)}/source`);
    if (source.task.projectId !== THAMES_VALLEY_PROJECT_ID || source.task.id !== task.id || source.task.type !== 'furnish') throw new Error('This building task is not available.');
    const requestId = crypto.randomUUID(), localId = `guest-${requestId}`;
    const draft: GuestVariant = { localId, requestId, xml: source.xml, contribution: {
      id: localId, projectId: source.task.projectId, taskId: task.id, originalBuildId: source.task.sourceBuildId,
      sourceRevisionId: source.task.sourceRevisionId, createdBy: 'guest', guest: true, name: name.trim(), status: 'draft',
      revision: 1, deliverableUrl: '', reviewNote: '', submitterName: '',
    } };
    this.persist(draft); return draft;
  }
  persist(draft: GuestVariant): void {
    const { xml, ...metadata } = draft;
    localStorage.setItem(this.cacheTarget(draft.localId).key, JSON.stringify({ xml, revision: 1 }));
    localStorage.setItem(this.metaKey(draft.localId), JSON.stringify(metadata));
  }
  read(id: string): GuestVariant {
    const metadata = localStorage.getItem(this.metaKey(id)), document = localStorage.getItem(this.cacheTarget(id).key);
    if (!metadata || !document) throw new Error('This browser has no saved copy of that variant. Return to the task to start one.');
    try {
      const draft = JSON.parse(metadata), cached = JSON.parse(document);
      if (draft.localId !== id || !id.startsWith('guest-') || draft.contribution?.projectId !== THAMES_VALLEY_PROJECT_ID ||
          !draft.requestId || typeof cached.xml !== 'string' || cached.revision !== 1) throw new Error();
      return { ...draft, xml: cached.xml };
    } catch { throw new Error('The local variant could not be read. Your browser copy has been kept.'); }
  }
  forTask(taskId: string): GuestVariant[] {
    const drafts: GuestVariant[] = [];
    this.recoveryWarning = '';
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)!;
      if (!key.startsWith(this.prefix) || !key.endsWith(':metadata')) continue;
      const id = key.slice(this.prefix.length, -':metadata'.length);
      try {
        const draft = this.read(id);
        if (draft.contribution.taskId === taskId && draft.contribution.status === 'draft') drafts.push(draft);
      } catch { this.recoveryWarning = 'Some local variants could not be read. Their browser data has been kept.'; }
    }
    return drafts;
  }
  submit(draft: GuestVariant, submitterName: string): Promise<Contribution> {
    return this.api.request('POST', `/guest/tasks/${encodeURIComponent(draft.contribution.taskId)}/submit`, {
      xml: draft.xml, name: draft.contribution.name, sourceRevisionId: draft.contribution.sourceRevisionId,
      requestId: draft.requestId, submitterName,
    });
  }
}
