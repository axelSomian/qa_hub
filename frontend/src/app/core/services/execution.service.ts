import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ExecutionSession {
  id: string;
  name: string;
  started_at: string;
  ended_at?: string;
  status: 'in_progress' | 'completed' | 'aborted';
  squash_campaign_id?: string;
  notes?: string;
}

export interface ExecutionStep {
  id: string;
  execution_id: string;
  step_id: string;
  status: 'passed' | 'failed' | 'blocked' | null;
  comment?: string;
  executed_at?: string;
}

export interface Execution {
  id: string;
  session_id: string;
  test_case_id: string;
  global_status: 'pending' | 'passed' | 'failed' | 'blocked';
  started_at?: string;
  ended_at?: string;
  squash_execution_id?: string;
  squash_test_plan_item_id?: string;
  tc?: any;
  tc_title?: string;
  priority?: string;
  execution_steps?: ExecutionStep[];
}

export interface SessionReport {
  session: ExecutionSession;
  executions: Execution[];
  report: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    pending: number;
    duration: number;
  };
}

@Injectable({ providedIn: 'root' })
export class ExecutionService {
  private apiUrl = `${environment.apiUrl}/api/executions`;

  constructor(private http: HttpClient) {}

  private get squashHeaders(): Record<string, string> {
    const url = localStorage.getItem('squash_url') || '';
    const token = localStorage.getItem('squash_token') || '';
    return url && token ? { 'x-squash-url': url, 'x-squash-token': token } : {};
  }

  createSession(tcIds: string[], sessionName: string, squashProjectId?: number): Observable<{ session: ExecutionSession; executions: Execution[] }> {
    return this.http.post<any>(`${this.apiUrl}/sessions`, { tcIds, sessionName, squashProjectId }, { headers: this.squashHeaders });
  }

  getSession(sessionId: string): Observable<{ session: ExecutionSession; executions: Execution[] }> {
    return this.http.get<any>(`${this.apiUrl}/sessions/${sessionId}`);
  }

  updateStep(executionId: string, stepId: string, status: 'passed' | 'failed' | 'blocked', comment?: string): Observable<ExecutionStep> {
    return this.http.patch<ExecutionStep>(`${this.apiUrl}/${executionId}/steps/${stepId}`, { status, comment }, { headers: this.squashHeaders });
  }

  completeExecution(executionId: string, globalStatus: string, notes?: string): Observable<Execution> {
    return this.http.patch<Execution>(`${this.apiUrl}/${executionId}/complete`, { global_status: globalStatus, notes }, { headers: this.squashHeaders });
  }

  completeSession(sessionId: string, notes?: string): Observable<SessionReport> {
    return this.http.patch<SessionReport>(`${this.apiUrl}/sessions/${sessionId}/complete`, { notes });
  }

  getReport(sessionId: string): Observable<SessionReport> {
    return this.http.get<SessionReport>(`${this.apiUrl}/sessions/${sessionId}/report`);
  }
}
