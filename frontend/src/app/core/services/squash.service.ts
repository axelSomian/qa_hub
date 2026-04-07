import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface SquashProject {
  id: number;
  name: string;
}

export interface PushResultItem {
  id: string;
  title: string;
  squashId?: number | string;
}

export interface PushResponse {
  success: boolean;
  pushed: PushResultItem[];
  blocked: PushResultItem[];
}

@Injectable({ providedIn: 'root' })
export class SquashService {
  private apiUrl = `${environment.apiUrl}/api/squash`;

  constructor(private http: HttpClient) {}

  get squashUrl(): string { return localStorage.getItem('squash_url') || ''; }
  get squashToken(): string { return localStorage.getItem('squash_token') || ''; }
  get hasCredentials(): boolean { return !!(this.squashUrl && this.squashToken); }

  saveCredentials(url: string, token: string): void {
    localStorage.setItem('squash_url', url.trim());
    localStorage.setItem('squash_token', token.trim());
  }

  clearCredentials(): void {
    localStorage.removeItem('squash_url');
    localStorage.removeItem('squash_token');
  }

  private get headers(): Record<string, string> {
    if (!this.squashUrl || !this.squashToken) return {};
    return { 'x-squash-url': this.squashUrl, 'x-squash-token': this.squashToken };
  }

  getProjects(): Observable<SquashProject[]> {
    return this.http.get<SquashProject[]>(`${this.apiUrl}/projects`, { headers: this.headers });
  }

  push(tcIds: string[], projectId: number, folderName?: string): Observable<PushResponse> {
    return this.http.post<PushResponse>(`${this.apiUrl}/push`, { tcIds, projectId, folderName }, { headers: this.headers });
  }
}
