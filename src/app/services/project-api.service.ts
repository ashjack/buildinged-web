import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { Contribution, Project, ProjectBuild, ProjectMember, ProjectTask, VariantDocument, WorldBuildingDocument } from '../models/project.models';

export class ProjectRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

@Injectable({ providedIn: 'root' })
export class ProjectApiService {
  constructor(private http: HttpClient, private auth: AuthService) { }

  async request<T>(method: string, path: string, body?: object): Promise<T> {
    const token = await this.auth.token();
    try {
      return await firstValueFrom(this.http.request<T>(method, `${this.auth.apiBaseUrl}${path}`, {
        body, headers: { Authorization: `Bearer ${token}` }
      }));
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        const payload: unknown = error.error;
        const message = typeof payload === 'object' && payload !== null && 'error' in payload &&
          typeof payload.error === 'string' ? payload.error : `Project request failed (${error.status}).`;
        throw new ProjectRequestError(message, error.status);
      }
      throw error;
    }
  }

  projects(): Promise<Project[]> { return this.request('GET', '/projects'); }
  project(id: string): Promise<Project> { return this.request('GET', `/projects/${encodeURIComponent(id)}`); }
  builds(id: string): Promise<ProjectBuild[]> { return this.request('GET', `/projects/${encodeURIComponent(id)}/builds`); }
  tasks(id: string): Promise<ProjectTask[]> { return this.request('GET', `/projects/${encodeURIComponent(id)}/tasks`); }
  task(id: string): Promise<ProjectTask> { return this.request('GET', `/tasks/${encodeURIComponent(id)}`); }
  contributions(taskId: string): Promise<Contribution[]> {
    return this.request('GET', `/tasks/${encodeURIComponent(taskId)}/contributions`);
  }
  members(projectId: string): Promise<ProjectMember[]> {
    return this.request('GET', `/projects/${encodeURIComponent(projectId)}/members`);
  }
  variant(id: string): Promise<VariantDocument> { return this.request('GET', `/contributions/${encodeURIComponent(id)}/document`); }
  worldBuilding(projectId: string, path: string): Promise<WorldBuildingDocument> {
    return this.request('GET', `/projects/${encodeURIComponent(projectId)}/world-building?path=${encodeURIComponent(path)}`);
  }
  saveWorldBuilding(projectId: string, path: string, xml: string, revision: number): Promise<Omit<WorldBuildingDocument, 'xml'>> {
    return this.request('PUT', `/projects/${encodeURIComponent(projectId)}/world-building`, { path, xml, revision });
  }
  start(taskId: string, name: string, requestId: string): Promise<Contribution> {
    return this.request('POST', `/tasks/${encodeURIComponent(taskId)}/contributions`, { name, requestId });
  }
  save(id: string, xml: string, revision: number): Promise<Contribution> {
    return this.request('PUT', `/contributions/${encodeURIComponent(id)}/document`, { xml, revision });
  }
  submit(id: string, revision: number, deliverableUrl = ''): Promise<Contribution> {
    return this.request('POST', `/contributions/${encodeURIComponent(id)}/submit`, { revision, deliverableUrl });
  }
}
