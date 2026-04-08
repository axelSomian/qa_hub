import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SquashService, SquashProject } from '../../core/services/squash.service';
import { ExecutionService, ExecutionSession, Execution, SessionReport } from '../../core/services/execution.service';
import { SafeUrlPipe } from '../../core/pipes/safe-url.pipe';
import { environment } from '../../../environments/environment';

interface SquashTc {
  id: number;
  name: string;
  reference: string;
  importance: string;
  status: string;
  steps?: SquashStep[];
  loadingSteps?: boolean;
}

interface SquashStep {
  id: number;
  order: number;
  action: string;
  expected_result: string;
}

type ExecView = 'select' | 'running' | 'report';

@Component({
  selector: 'app-execution-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SafeUrlPipe],
  templateUrl: './execution-page.component.html',
  styleUrl: './execution-page.component.scss',
})
export class ExecutionPageComponent implements OnInit {
  private apiUrl = `${environment.apiUrl}/api/squash`;

  // ── Connexion Squash ──────────────────────────────
  squashConfigured = false;
  squashUrlInput = localStorage.getItem('squash_url') || '';
  squashTokenInput = localStorage.getItem('squash_token') || '';
  squashConnecting = false;
  squashConfigError = '';

  // ── Sélection projet + CTs ────────────────────────
  projects: SquashProject[] = [];
  projectsLoading = false;
  selectedProjectId: number | null = null;

  testCases: SquashTc[] = [];
  tcsLoading = false;
  tcsError = '';
  selectedTcIds = new Set<number>();

  searchTerm = '';

  get filteredTcs(): SquashTc[] {
    const term = this.searchTerm.toLowerCase();
    return term
      ? this.testCases.filter(tc => tc.name.toLowerCase().includes(term) || tc.reference.toLowerCase().includes(term))
      : this.testCases;
  }

  // ── Session d'exécution ───────────────────────────
  view: ExecView = 'select';
  execSession: ExecutionSession | null = null;
  execQueue: { tc: SquashTc; sessionExecId?: string }[] = [];
  execCurrentIdx = 0;
  execStepIdx = 0;
  execStepResults = new Map<number, { status: string; comment: string }>();
  execIframeUrl = 'about:blank';
  execCommentOpen = false;
  execPendingStatus: 'failed' | 'blocked' | null = null;
  execPendingComment = '';
  execLaunching = false;
  execReport: SessionReport | null = null;

  // Squash campaign tracking
  squashCampaignId: number | null = null;
  squashTpiMap = new Map<number, number>(); // tcId → testPlanItemId
  squashExecMap = new Map<number, number>(); // tcId → squashExecutionId

  get execCurrentTc(): SquashTc | null { return this.execQueue[this.execCurrentIdx]?.tc ?? null; }
  get execCurrentSteps(): SquashStep[] { return this.execCurrentTc?.steps ?? []; }
  get execCurrentStep(): SquashStep | null { return this.execCurrentSteps[this.execStepIdx] ?? null; }
  get execProgress(): number {
    return this.execQueue.length
      ? Math.round((this.execCurrentIdx / this.execQueue.length) * 100)
      : 0;
  }

  constructor(
    private router: Router,
    private http: HttpClient,
    private squashService: SquashService,
    private executionService: ExecutionService,
  ) {}

  ngOnInit(): void {
    this.squashConfigured = this.squashService.hasCredentials;
    if (this.squashConfigured) this.loadProjects();
  }

  private get squashHeaders() {
    return {
      'x-squash-url': localStorage.getItem('squash_url') || '',
      'x-squash-token': localStorage.getItem('squash_token') || '',
    };
  }

  // ── Connexion ─────────────────────────────────────
  configureSquash(): void {
    if (!this.squashUrlInput.trim() || !this.squashTokenInput.trim()) return;
    this.squashConnecting = true;
    this.squashConfigError = '';
    this.squashService.saveCredentials(this.squashUrlInput.trim(), this.squashTokenInput.trim());
    this.squashService.getProjects().subscribe({
      next: (projects) => {
        this.squashConfigured = true;
        this.squashConnecting = false;
        this.projects = projects;
      },
      error: (err: any) => {
        this.squashConnecting = false;
        this.squashConfigError = err?.error?.error || 'Connexion échouée';
        this.squashService.clearCredentials();
      },
    });
  }

  disconnectSquash(): void {
    this.squashService.clearCredentials();
    this.squashConfigured = false;
    this.projects = [];
    this.testCases = [];
    this.selectedProjectId = null;
    this.selectedTcIds = new Set();
  }

  // ── Chargement ────────────────────────────────────
  loadProjects(): void {
    this.projectsLoading = true;
    this.squashService.getProjects().subscribe({
      next: (p) => { this.projects = p; this.projectsLoading = false; },
      error: () => { this.projectsLoading = false; },
    });
  }

  selectProject(id: number): void {
    this.selectedProjectId = id;
    this.testCases = [];
    this.selectedTcIds = new Set();
    this.tcsLoading = true;
    this.tcsError = '';
    this.http.get<SquashTc[]>(`${this.apiUrl}/projects/${id}/test-cases`, { headers: this.squashHeaders }).subscribe({
      next: (tcs) => { this.testCases = tcs; this.tcsLoading = false; },
      error: (err: any) => { this.tcsError = err?.error?.error || 'Erreur chargement'; this.tcsLoading = false; },
    });
  }

  toggleTc(id: number): void {
    const s = new Set(this.selectedTcIds);
    s.has(id) ? s.delete(id) : s.add(id);
    this.selectedTcIds = s;
  }

  toggleAll(): void {
    if (this.selectedTcIds.size === this.filteredTcs.length) {
      this.selectedTcIds = new Set();
    } else {
      this.selectedTcIds = new Set(this.filteredTcs.map(tc => tc.id));
    }
  }

  importanceClass(imp: string): string {
    return imp === 'HIGH' ? 'high' : imp === 'LOW' ? 'low' : 'medium';
  }

  // ── Lancement session ─────────────────────────────
  launchExecution(): void {
    if (this.selectedTcIds.size === 0) return;
    this.execLaunching = true;

    const selectedTcs = this.testCases.filter(tc => this.selectedTcIds.has(tc.id));

    // Charger les steps de chaque TC sélectionné
    let loaded = 0;
    const total = selectedTcs.length;

    selectedTcs.forEach(tc => {
      this.http.get<SquashTc>(`${this.apiUrl}/test-cases/${tc.id}`, { headers: this.squashHeaders }).subscribe({
        next: (detail) => {
          tc.steps = detail.steps || [];
          loaded++;
          if (loaded === total) this.startSession(selectedTcs);
        },
        error: () => {
          tc.steps = [];
          loaded++;
          if (loaded === total) this.startSession(selectedTcs);
        },
      });
    });
  }

  private startSession(tcs: SquashTc[]): void {
    const sessionName = `Exécution Squash — ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

    // Créer la session + campagne Squash
    this.http.post<{ session: ExecutionSession; executions: Execution[]; squashCampaignId?: number }>(
      `${environment.apiUrl}/api/executions/sessions`,
      {
        tcIds: [],  // pas de DB tc_ids ici, on crée quand même une session pour le suivi
        sessionName,
        squashProjectId: this.selectedProjectId,
        squashTcIds: tcs.map(tc => tc.id),
      },
      { headers: this.squashHeaders }
    ).subscribe({
      next: (res) => {
        this.execSession = res.session;
        this.squashCampaignId = res.squashCampaignId ?? null;
        this.execQueue = tcs.map(tc => ({ tc }));
        this.execCurrentIdx = 0;
        this.execStepIdx = 0;
        this.execStepResults = new Map();
        this.execIframeUrl = 'about:blank';
        this.execCommentOpen = false;
        this.execPendingStatus = null;
        this.execPendingComment = '';
        this.execLaunching = false;
        this.view = 'running';
      },
      error: () => {
        // Démarrer quand même sans session DB
        this.execSession = null;
        this.execQueue = tcs.map(tc => ({ tc }));
        this.execCurrentIdx = 0;
        this.execStepIdx = 0;
        this.execStepResults = new Map();
        this.execIframeUrl = 'about:blank';
        this.execLaunching = false;
        this.view = 'running';
      },
    });
  }

  // ── Navigation iframe ─────────────────────────────
  execNavigateIframe(url: string): void {
    this.execIframeUrl = url.startsWith('http') ? url : 'https://' + url;
  }

  execResetIframe(): void {
    this.execIframeUrl = 'about:blank';
  }

  // ── Gestion steps ─────────────────────────────────
  execHandleStep(status: 'passed' | 'failed' | 'blocked'): void {
    if (!this.execCurrentStep) return;
    if ((status === 'failed' || status === 'blocked') && !this.execCommentOpen) {
      this.execPendingStatus = status;
      this.execCommentOpen = true;
      return;
    }
    this.execSubmitStep(status, this.execPendingComment);
  }

  execSubmitStep(status: 'passed' | 'failed' | 'blocked', comment?: string): void {
    const step = this.execCurrentStep!;
    this.execCommentOpen = false;
    this.execPendingStatus = null;
    this.execStepResults.set(step.id, { status, comment: comment || '' });
    this.execPendingComment = '';

    // Màj Squash step (non bloquant)
    const tc = this.execCurrentTc!;
    const squashExecId = this.squashExecMap.get(tc.id);
    if (squashExecId) {
      const squashStatus = status === 'passed' ? 'SUCCESS' : status === 'failed' ? 'FAILURE' : 'BLOCKED';
      this.http.patch(
        `${this.apiUrl}/execution-steps/${step.id}`,
        { status: squashStatus, comment, squashExecId },
        { headers: this.squashHeaders }
      ).subscribe({ error: () => {} });
    }

    this.execAdvance();
  }

  private execAdvance(): void {
    const steps = this.execCurrentSteps;
    if (this.execStepIdx < steps.length - 1) {
      this.execStepIdx++;
      return;
    }
    // Fin du TC — calculer statut global
    const results = steps.map(s => this.execStepResults.get(s.id)?.status || 'pending');
    const globalStatus = results.includes('failed') ? 'failed'
      : results.includes('blocked') ? 'blocked' : 'passed';

    // Màj Squash execution
    const tc = this.execCurrentTc!;
    const squashExecId = this.squashExecMap.get(tc.id);
    if (squashExecId) {
      const sq = globalStatus === 'passed' ? 'SUCCESS' : globalStatus === 'failed' ? 'FAILURE' : 'BLOCKED';
      this.http.patch(`${this.apiUrl}/executions/${squashExecId}`, { status: sq }, { headers: this.squashHeaders })
        .subscribe({ error: () => {} });
    }

    this.execNextTc(globalStatus);
  }

  private execNextTc(globalStatus: string): void {
    // Enregistrer le résultat du TC courant
    const item = this.execQueue[this.execCurrentIdx];
    (item as any).globalStatus = globalStatus;

    if (this.execCurrentIdx < this.execQueue.length - 1) {
      this.execCurrentIdx++;
      this.execStepIdx = 0;
      this.execStepResults = new Map();
      this.execResetIframe();
    } else {
      this.finishSession();
    }
  }

  private finishSession(): void {
    const executions = this.execQueue.map((item: any) => ({
      tc_title: item.tc.name,
      priority: item.tc.importance || 'MEDIUM',
      global_status: item.globalStatus || 'pending',
    }));

    const passed = executions.filter(e => e.global_status === 'passed').length;
    const failed = executions.filter(e => e.global_status === 'failed').length;
    const blocked = executions.filter(e => e.global_status === 'blocked').length;

    this.execReport = {
      session: this.execSession || { id: '', name: 'Session', started_at: new Date().toISOString(), status: 'completed' },
      executions: executions as any,
      report: { total: executions.length, passed, failed, blocked, pending: 0, duration: 0 },
    };
    this.view = 'report';
  }

  execAbort(): void {
    this.view = 'select';
    this.execQueue = [];
    this.execStepResults = new Map();
    this.execResetIframe();
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  priorityClass(p: string): string {
    if (!p) return '';
    const lp = p.toLowerCase();
    return lp === 'high' || lp === 'urgent' ? 'high' : lp === 'low' ? 'low' : 'medium';
  }
}
