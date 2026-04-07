import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface TestStep {
  id?: string;
  step_order?: number;
  action: string;
  expected_result: string;
  expected?: string;
}

export interface TestCase {
  id?: string;
  title: string;
  preconditions: string;
  priority: 'low' | 'medium' | 'high';
  status?: string;
  squash_id?: string;
  steps: TestStep[];
}

export interface GenerateRequest {
  usId: number;
  usTitle: string;
  usDescription: string;
  specificCriteria?: string;
}

export interface GenerateResponse {
  testCases: TestCase[];
  mode: 'full' | 'specific';
}

@Injectable({ providedIn: 'root' })
export class AiService {
  private apiUrl = `${environment.apiUrl}/api/ai`;

  constructor(private http: HttpClient) {}

  generate(payload: GenerateRequest): Observable<GenerateResponse> {
    return this.http.post<GenerateResponse>(`${this.apiUrl}/generate`, payload);
  }

  createManualTestCase(usId: number, usTitle: string): Observable<TestCase> {
    return this.http.post<TestCase>(`${this.apiUrl}/test-cases`, { usId, usTitle });
  }

  getTestCases(usId: number): Observable<TestCase[]> {
    return this.http.get<TestCase[]>(`${this.apiUrl}/test-cases/${usId}`);
  }

  updateTestCase(id: string, fields: { title?: string; preconditions?: string; priority?: string }): Observable<TestCase> {
    return this.http.patch<TestCase>(`${this.apiUrl}/test-cases/${id}`, fields);
  }

  updateStatus(id: string, status: string): Observable<TestCase> {
    return this.http.patch<TestCase>(`${this.apiUrl}/test-cases/${id}/status`, { status });
  }

  deleteTestCase(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/test-cases/${id}`);
  }

  updateStep(id: string, fields: { action?: string; expected_result?: string }): Observable<TestStep> {
    return this.http.patch<TestStep>(`${this.apiUrl}/test-steps/${id}`, fields);
  }

  addStep(tcId: string, stepOrder: number): Observable<TestStep> {
    return this.http.post<TestStep>(`${this.apiUrl}/test-cases/${tcId}/steps`, { step_order: stepOrder });
  }

  deleteStep(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/test-steps/${id}`);
  }
}