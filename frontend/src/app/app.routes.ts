import { Routes } from '@angular/router';
import { ProjectsComponent } from './features/projects/projects.component';
import { ExecutionPageComponent } from './features/execution/execution-page.component';

export const routes: Routes = [
  { path: '', component: ProjectsComponent },
  { path: 'execution', component: ExecutionPageComponent },
  { path: '**', redirectTo: '' },
];
