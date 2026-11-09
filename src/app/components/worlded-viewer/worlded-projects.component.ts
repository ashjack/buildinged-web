import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Project } from '../../models/project.models';
import { AuthService } from '../../services/auth.service';
import { ProjectApiService } from '../../services/project-api.service';

@Component({
  selector: 'app-worlded-projects',
  templateUrl: './worlded-projects.component.html',
  styleUrls: ['./project-world.component.scss'],
})
export class WorldedProjectsComponent implements OnInit, OnDestroy {
  projects: Project[] = [];
  loading = false;
  error = '';
  private generation = 0;
  private authChanges?: Subscription;

  constructor(private api: ProjectApiService, private auth: AuthService, private router: Router) { }

  ngOnInit(): void {
    this.authChanges = this.auth.user$.subscribe(user => {
      this.generation++;
      this.projects = [];
      this.error = '';
      this.loading = false;
      if (user) void this.load();
    });
  }
  ngOnDestroy(): void { this.generation++; this.authChanges?.unsubscribe(); }

  async load(): Promise<void> {
    const uid = this.auth.user?.uid;
    if (!uid) return;
    const generation = ++this.generation;
    this.loading = true;
    this.error = '';
    try {
      const projects = await this.api.projects();
      if (generation !== this.generation || uid !== this.auth.user?.uid) return;
      this.projects = projects;
      if (projects.length === 1) {
        const opened = await this.router.navigate(['/worlded/project', projects[0].id], { replaceUrl: true });
        if (!opened && generation === this.generation) this.error = 'Could not open the project world. Choose the project below to try again.';
      }
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
}
