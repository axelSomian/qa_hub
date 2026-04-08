import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Project {
  id: number;
  name: string;
  identifier: string;
}

export interface UserStory {
  id: number;
  subject: string;
  description: string;
  status: string;
  priority: string;
  type: string;
  assignee: string | null;
}

@Injectable({ providedIn: 'root' })
export class OpenprojectService {
  private apiUrl = `${environment.apiUrl}/api/openproject`;

  constructor(private http: HttpClient) {}

  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'x-op-url': localStorage.getItem('op_url') || '',
      'x-op-token': localStorage.getItem('op_token') || '',
    });
  }

  testConnection(url: string, token: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/test`, {
      headers: new HttpHeaders({ 'x-op-url': url, 'x-op-token': token }),
    });
  }

  getProjects(): Observable<Project[]> {
    return this.http.get<Project[]>(`${this.apiUrl}/projects`, {
      headers: this.getHeaders(),
    });
  }

  getUserStories(projectId: number): Observable<UserStory[]> {
    return this.http.get<UserStory[]>(
      `${this.apiUrl}/projects/${projectId}/user-stories`,
      { headers: this.getHeaders() }
    );
  }

  addComment(workPackageId: number, comment: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(
      `${this.apiUrl}/work-packages/${workPackageId}/comment`,
      { comment },
      { headers: this.getHeaders() }
    );
  }
}