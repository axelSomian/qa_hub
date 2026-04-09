import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SquashService, SquashProject } from '../../core/services/squash.service';
import { ExecutionService, ExecutionSession, Execution, SessionReport } from '../../core/services/execution.service';
import { SafeUrlPipe } from '../../core/pipes/safe-url.pipe';
import { environment } from '../../../environments/environment';

export interface TreeNode {
  type: 'folder' | 'tc';
  id: number;
  name: string;
  reference?: string;
  importance?: string;
  status?: string;
  // Folder state
  children?: TreeNode[];
  loading?: boolean;
  expanded?: boolean;
  loaded?: boolean;
  // TC state (chargé pour exécution)
  steps?: SquashStep[];
}

interface SquashStep {
  id: number;
  order: number;
  action: string;
  expected_result: string;
}

type ExecView = 'select' | 'running' | 'report' | 'history' | 'history-detail';

@Component({
  selector: 'app-execution-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SafeUrlPipe, RouterLink, RouterLinkActive],
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

  // ── Sélection projet ──────────────────────────────
  projects: SquashProject[] = [];
  projectsLoading = false;
  projectsError = '';
  selectedProjectId: number | null = null;

  // ── Arbre de dossiers / TCs ───────────────────────
  treeRoots: TreeNode[] = [];
  treeLoading = false;
  treeError = '';
  selectedTcIds = new Set<number>();
  searchTerm = '';

  // TCs plats pour recherche
  get allTcs(): TreeNode[] {
    const collect = (nodes: TreeNode[]): TreeNode[] =>
      nodes.flatMap(n => n.type === 'tc' ? [n] : collect(n.children || []));
    return collect(this.treeRoots);
  }

  get filteredTcs(): TreeNode[] {
    const term = this.searchTerm.toLowerCase();
    if (!term) return [];
    return this.allTcs.filter(tc =>
      tc.name.toLowerCase().includes(term) ||
      (tc.reference || '').toLowerCase().includes(term)
    );
  }

  get selectedCount(): number { return this.selectedTcIds.size; }

  // ── Session d'exécution ───────────────────────────
  view: ExecView = 'select';
  execSession: ExecutionSession | null = null;
  execQueue: { tc: TreeNode }[] = [];
  execCurrentIdx = 0;
  execStepIdx = 0;
  execStepResults = new Map<number, { status: string; comment: string }>();
  execIframeUrl = 'about:blank';
  execIframeBlocked = false;
  execCommentOpen = false;
  execPendingStatus: 'failed' | 'blocked' | null = null;
  execPendingComment = '';
  execLaunching = false;
  execReport: SessionReport | null = null;

  squashCampaignId: number | null = null;
  squashExecMap = new Map<number, number>();

  // ── Historique ────────────────────────────────────
  historySessions: any[] = [];
  historyLoading = false;
  historyDetail: any = null;
  historyDetailLoading = false;
  aiAnalysis: any = null;
  aiAnalyzing = false;
  aiError = '';

  get execCurrentTc(): TreeNode | null { return this.execQueue[this.execCurrentIdx]?.tc ?? null; }
  get execCurrentSteps(): SquashStep[] { return (this.execCurrentTc?.steps as SquashStep[]) ?? []; }
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
    this.treeRoots = [];
    this.selectedProjectId = null;
    this.selectedTcIds = new Set();
  }

  // ── Chargement ────────────────────────────────────
  loadProjects(): void {
    this.projectsLoading = true;
    this.projectsError = '';
    this.squashService.getProjects().subscribe({
      next: (p) => { this.projects = p; this.projectsLoading = false; },
      error: (err: any) => {
        this.projectsError = err?.error?.error || 'Erreur chargement des projets';
        this.projectsLoading = false;
      },
    });
  }

  selectProject(id: number): void {
    if (this.selectedProjectId === id) return;
    this.selectedProjectId = id;
    this.treeRoots = [];
    this.selectedTcIds = new Set();
    this.searchTerm = '';
    this.treeLoading = true;
    this.treeError = '';
    this.http.get<TreeNode[]>(`${this.apiUrl}/projects/${id}/library`, { headers: this.squashHeaders }).subscribe({
      next: (nodes) => { this.treeRoots = nodes; this.treeLoading = false; },
      error: (err: any) => { this.treeError = err?.error?.error || 'Erreur chargement'; this.treeLoading = false; },
    });
  }

  // ── Arbre — expand/collapse ───────────────────────
  toggleFolder(node: TreeNode): void {
    if (node.type !== 'folder') return;
    if (node.expanded) { node.expanded = false; return; }
    node.expanded = true;
    if (node.loaded) return;
    node.loading = true;
    this.http.get<TreeNode[]>(`${this.apiUrl}/folders/${node.id}/content`, { headers: this.squashHeaders }).subscribe({
      next: (children) => { node.children = children; node.loading = false; node.loaded = true; },
      error: () => { node.loading = false; node.loaded = true; node.children = []; },
    });
  }

  // ── Sélection ─────────────────────────────────────
  toggleTc(id: number): void {
    const s = new Set(this.selectedTcIds);
    s.has(id) ? s.delete(id) : s.add(id);
    this.selectedTcIds = s;
  }

  toggleFolder_select(node: TreeNode): void {
    const tcs = this.collectTcs(node);
    const allSelected = tcs.every(tc => this.selectedTcIds.has(tc.id));
    const s = new Set(this.selectedTcIds);
    if (allSelected) tcs.forEach(tc => s.delete(tc.id));
    else tcs.forEach(tc => s.add(tc.id));
    this.selectedTcIds = s;
  }

  folderSelectionState(node: TreeNode): 'all' | 'some' | 'none' {
    const tcs = this.collectTcs(node);
    if (tcs.length === 0) return 'none';
    const sel = tcs.filter(tc => this.selectedTcIds.has(tc.id)).length;
    return sel === tcs.length ? 'all' : sel > 0 ? 'some' : 'none';
  }

  private collectTcs(node: TreeNode): TreeNode[] {
    if (node.type === 'tc') return [node];
    return (node.children || []).flatMap(c => this.collectTcs(c));
  }

  importanceClass(imp?: string): string {
    return imp === 'HIGH' ? 'high' : imp === 'LOW' ? 'low' : 'medium';
  }

  // ── Lancement session ─────────────────────────────
  launchExecution(): void {
    if (this.selectedTcIds.size === 0) return;
    this.execLaunching = true;

    const selectedTcs = this.allTcs.filter(tc => this.selectedTcIds.has(tc.id));
    let loaded = 0;

    selectedTcs.forEach(tc => {
      this.http.get<any>(`${this.apiUrl}/test-cases/${tc.id}`, { headers: this.squashHeaders }).subscribe({
        next: (detail) => {
          tc.steps = detail.steps || [];
          if (++loaded === selectedTcs.length) this.startSession(selectedTcs);
        },
        error: () => {
          tc.steps = [];
          if (++loaded === selectedTcs.length) this.startSession(selectedTcs);
        },
      });
    });
  }

  private startSession(tcs: TreeNode[]): void {
    const sessionName = `Exécution Squash — ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const projectName = this.projects.find(p => p.id === this.selectedProjectId)?.name || '';

    this.http.post<{ session: ExecutionSession; executions: Execution[]; squashCampaignId?: number }>(
      `${environment.apiUrl}/api/executions/sessions`,
      {
        sessionName,
        squashProjectId: this.selectedProjectId,
        squashProjectName: projectName,
        squashTcs: tcs.map(tc => ({ id: tc.id, name: tc.name, importance: tc.importance || 'MEDIUM' })),
      },
      { headers: this.squashHeaders }
    ).subscribe({
      next: (res) => {
        this.execSession = res.session;
        this.squashCampaignId = res.squashCampaignId ?? null;
        this.execQueue = tcs.map(tc => ({ tc }));
        this.resetExecState();
        this.execLaunching = false;
        this.view = 'running';
      },
      error: () => {
        this.execSession = null;
        this.execQueue = tcs.map(tc => ({ tc }));
        this.resetExecState();
        this.execLaunching = false;
        this.view = 'running';
      },
    });
  }

  private resetExecState(): void {
    this.execCurrentIdx = 0;
    this.execStepIdx = 0;
    this.execStepResults = new Map();
    this.execIframeUrl = 'about:blank';
    this.execCommentOpen = false;
    this.execPendingStatus = null;
    this.execPendingComment = '';
  }

  // ── Navigation iframe ─────────────────────────────
  execNavigateIframe(url: string): void {
    this.execIframeUrl = url.startsWith('http') ? url : 'https://' + url;
    this.execIframeBlocked = false;
  }

  execResetIframe(): void {
    this.execIframeUrl = 'about:blank';
    this.execIframeBlocked = false;
  }

  onIframeLoad(event: Event): void {
    if (this.execIframeUrl === 'about:blank') return;
    try {
      const iframe = event.target as HTMLIFrameElement;
      // Si le document est accessible, le site n'est pas bloqué
      void iframe.contentDocument?.title;
      this.execIframeBlocked = false;
    } catch {
      // SecurityError = cross-origin, mais ça veut dire que ça a chargé
      this.execIframeBlocked = false;
    }
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

    const tc = this.execCurrentTc!;
    const squashExecId = this.squashExecMap.get(tc.id);
    if (squashExecId) {
      const sq = status === 'passed' ? 'SUCCESS' : status === 'failed' ? 'FAILURE' : 'BLOCKED';
      this.http.patch(
        `${this.apiUrl}/execution-steps/${step.id}`,
        { status: sq, comment, squashExecId },
        { headers: this.squashHeaders }
      ).subscribe({ error: () => {} });
    }

    this.execAdvance();
  }

  private execAdvance(): void {
    const steps = this.execCurrentSteps;
    if (this.execStepIdx < steps.length - 1) { this.execStepIdx++; return; }

    const results = steps.map(s => this.execStepResults.get(s.id)?.status || 'pending');
    const globalStatus = results.includes('failed') ? 'failed'
      : results.includes('blocked') ? 'blocked' : 'passed';

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
    (this.execQueue[this.execCurrentIdx] as any).globalStatus = globalStatus;
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
    const results = this.execQueue.map((item: any) => ({
      squashTcId: item.tc.id,
      tcTitle: item.tc.name,
      tcImportance: item.tc.importance || 'MEDIUM',
      globalStatus: item.globalStatus || 'pending',
    }));

    const passed = results.filter(e => e.globalStatus === 'passed').length;
    const failed = results.filter(e => e.globalStatus === 'failed').length;
    const blocked = results.filter(e => e.globalStatus === 'blocked').length;

    const session = this.execSession || { id: '', name: 'Session', started_at: new Date().toISOString(), status: 'completed' };

    this.execReport = {
      session,
      executions: results.map(r => ({ tc_title: r.tcTitle, priority: r.tcImportance, global_status: r.globalStatus })) as any,
      report: { total: results.length, passed, failed, blocked, pending: 0, duration: 0 },
    };
    this.aiAnalysis = null;
    this.view = 'report';

    // Persister les résultats en DB
    if (session.id) {
      this.http.post(`${environment.apiUrl}/api/executions/sessions/${session.id}/complete`, { results })
        .subscribe({ error: () => {} });
    }
  }

  // ── Historique ────────────────────────────────────
  loadHistory(): void {
    this.view = 'history';
    this.historyLoading = true;
    this.http.get<any[]>(`${environment.apiUrl}/api/executions/sessions`).subscribe({
      next: (s) => { this.historySessions = s; this.historyLoading = false; },
      error: () => { this.historyLoading = false; },
    });
  }

  openHistoryDetail(session: any): void {
    this.historyDetail = null;
    this.aiAnalysis = null;
    this.view = 'history-detail';
    this.historyDetailLoading = true;
    this.http.get<any>(`${environment.apiUrl}/api/executions/sessions/${session.id}/report`).subscribe({
      next: (data) => {
        this.historyDetail = data;
        this.aiAnalysis = data.aiAnalysis || null;
        this.historyDetailLoading = false;
      },
      error: () => { this.historyDetailLoading = false; },
    });
  }

  analyzeWithAI(): void {
    if (!this.historyDetail?.session?.id && !this.execSession?.id) return;
    const sessionId = this.historyDetail?.session?.id || this.execSession?.id;
    this.aiAnalyzing = true;
    this.aiError = '';
    this.http.post<any>(`${environment.apiUrl}/api/executions/sessions/${sessionId}/analyze`, {}).subscribe({
      next: (analysis) => { this.aiAnalysis = analysis; this.aiAnalyzing = false; },
      error: (err: any) => { this.aiError = err?.error?.error || 'Erreur analyse IA'; this.aiAnalyzing = false; },
    });
  }

  analyzeCurrentReport(): void {
    if (!this.execSession?.id) return;
    this.aiAnalyzing = true;
    this.aiError = '';
    this.http.post<any>(`${environment.apiUrl}/api/executions/sessions/${this.execSession.id}/analyze`, {}).subscribe({
      next: (analysis) => { this.aiAnalysis = analysis; this.aiAnalyzing = false; },
      error: (err: any) => { this.aiError = err?.error?.error || 'Erreur analyse IA'; this.aiAnalyzing = false; },
    });
  }

  verdictClass(v: string): string {
    return v === 'OK' ? 'ok' : v === 'KO' ? 'ko' : 'partiel';
  }

  execAbort(): void {
    this.view = 'select';
    this.execQueue = [];
    this.execStepResults = new Map();
    this.execResetIframe();
  }

  goBack(): void { this.router.navigate(['/']); }

  priorityClass(p: string): string {
    if (!p) return '';
    const lp = p.toLowerCase();
    return lp === 'high' || lp === 'urgent' ? 'high' : lp === 'low' ? 'low' : 'medium';
  }
}
