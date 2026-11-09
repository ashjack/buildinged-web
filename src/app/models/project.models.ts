export type ProjectRole = 'owner' | 'reviewer' | 'contributor';
export type TaskStatus = 'available' | 'review_pending' | 'completed' | 'cancelled';
export type ContributionStatus = 'draft' | 'submitted' | 'approved' | 'changes_requested' | 'rejected';

export interface Project {
  id: string;
  name: string;
  description: string;
  visibility: 'private' | 'public';
  role: ProjectRole;
}

export interface ProjectMember {
  id: string;
  userId: string;
  role: ProjectRole;
}

export interface ProjectBuild {
  id: string;
  projectId: string;
  name: string;
  revisionId: string;
  worldFileId?: string;
  worldPath?: string;
}

export interface TaskReference {
  imageUrl: string;
  sourceUrl: string;
  caption: string;
  alt: string;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  type: 'furnish' | 'tile';
  description: string;
  requirements: string;
  priority: 'low' | 'normal' | 'high';
  status: TaskStatus;
  sourceBuildId: string | null;
  sourceRevisionId: string | null;
  references: TaskReference[];
  revision: number;
}

export interface Contribution {
  id: string;
  projectId: string;
  taskId: string;
  originalBuildId: string | null;
  sourceRevisionId: string | null;
  createdBy: string;
  name: string;
  status: ContributionStatus;
  revision: number;
  deliverableUrl: string;
  reviewNote: string;
}

export interface VariantDocument {
  contribution: Contribution;
  xml: string;
}

export interface WorldBuildingDocument {
  projectId: string;
  path: string;
  revision: number;
  xml: string;
}
