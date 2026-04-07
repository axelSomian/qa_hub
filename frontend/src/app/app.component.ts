import { Component } from '@angular/core';
import { ProjectsComponent } from './features/projects/projects.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ProjectsComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {}