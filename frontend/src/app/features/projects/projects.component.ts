import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  OpenprojectService,
  Project,
  UserStory,
} from '../../core/services/openproject.service';
import { AiService, TestCase, TestStep } from '../../core/services/ai.service';
import { SquashService, SquashProject, PushResponse } from '../../core/services/squash.service';

const PAGE_SIZE = 8;

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.scss',
})
export class ProjectsComponent implements OnInit {
  opUrl = localStorage.getItem('op_url') || '';
  opToken = localStorage.getItem('op_token') || '';
  isConnected = false;
  connectionError = '';
  connectionLoading = false;

  projects: Project[] = [];
  selectedProject: Project | null = null;
  projectsLoading = false;

  userStories: UserStory[] = [];
  filteredStories: UserStory[] = [];
  pagedStories: UserStory[] = [];
  usLoading = false;

  searchTerm = '';
  currentPage = 1;
  totalPages = 1;

  // Navigation entre vues
  currentView: 'us-list' | 'tc-list' | 'tc-detail' = 'us-list';
  selectedUs: UserStory | null = null;
  selectedTc: TestCase | null = null;

  // Modale prévisualisation US
  previewUs: UserStory | null = null;

  // CT
  testCases: TestCase[] = [];
  generating = false;
  generationError = '';
  specificCriteria = '';
  criteriaOpen = false;
  addingManual = false;
  tcCountMap = new Map<number, number>(); // usId → nombre de CT

  // Edition steps
  savingStepId: string | null = null;
  savedStepId: string | null = null;
  addingStepAt: number | null = null;

  // Edition TC meta
  tcSaving = false;
  tcSaved = false;
  readonly priorities: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];

  // Squash credentials
  squashUrlInput = localStorage.getItem('squash_url') || '';
  squashTokenInput = localStorage.getItem('squash_token') || '';
  squashConfigured = false;
  squashConfigError = '';
  squashConnecting = false;

  // Squash push
  squashProjects: SquashProject[] = [];
  squashProjectsLoading = false;
  selectedSquashProjectId: number | null = null;
  squashFolderName = '';
  squashPanelOpen = false;
  pushingToSquash = false;
  pushResult: PushResponse | null = null;
  pushError = '';
  selectedTcIds = new Set<string>();

  constructor(
    private opService: OpenprojectService,
    private aiService: AiService,
    private squashService: SquashService
  ) {}

  ngOnInit(): void {
    this.squashConfigured = this.squashService.hasCredentials;
    if (this.opUrl && this.opToken) this.connect();
  }

  connect(): void {
    this.connectionLoading = true;
    this.connectionError = '';
    this.opService.testConnection(this.opUrl, this.opToken).subscribe({
      next: () => {
        this.isConnected = true;
        this.connectionLoading = false;
        localStorage.setItem('op_url', this.opUrl);
        localStorage.setItem('op_token', this.opToken);
        this.loadProjects();
      },
      error: () => {
        this.isConnected = false;
        this.connectionLoading = false;
        this.connectionError = "Connexion échouée. Vérifie l'URL et le token.";
      },
    });
  }

  loadProjects(): void {
    this.projectsLoading = true;
    this.opService.getProjects().subscribe({
      next: (p) => { this.projects = p; this.projectsLoading = false; },
      error: () => { this.projectsLoading = false; },
    });
  }

  selectProject(project: Project): void {
    this.selectedProject = project;
    this.userStories = [];
    this.filteredStories = [];
    this.searchTerm = '';
    this.currentPage = 1;
    this.currentView = 'us-list';
    this.usLoading = true;
    this.opService.getUserStories(project.id).subscribe({
      next: (us) => {
        this.userStories = us;
        this.filteredStories = us;
        this.totalPages = Math.ceil(us.length / PAGE_SIZE);
        this.updatePage();
        this.usLoading = false;
        this.loadTestCaseCounts(us);
      },
      error: () => { this.usLoading = false; },
    });
  }

  onSearch(): void {
    this.currentPage = 1;
    const term = this.searchTerm.toLowerCase();
    this.filteredStories = term
      ? this.userStories.filter(
          (us) =>
            us.subject.toLowerCase().includes(term) ||
            us.description.toLowerCase().includes(term)
        )
      : [...this.userStories];
    this.totalPages = Math.max(1, Math.ceil(this.filteredStories.length / PAGE_SIZE));
    this.updatePage();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.updatePage();
  }

  priorityClass(priority: string): string {
    if (!priority) return 'p-low';
    return `p-${priority.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-')}`;
  }

  private updatePage(): void {
    const start = (this.currentPage - 1) * PAGE_SIZE;
    this.pagedStories = this.filteredStories.slice(start, start + PAGE_SIZE);
  }

  disconnect(): void {
    localStorage.removeItem('op_url');
    localStorage.removeItem('op_token');
    this.isConnected = false;
    this.projects = [];
    this.userStories = [];
    this.selectedProject = null;
    this.currentView = 'us-list';
  }

  // ── Modale prévisualisation US ────────────────────

  openUsPreview(us: UserStory, event: Event): void {
    event.stopPropagation();
    this.previewUs = us;
    document.body.style.overflow = 'hidden';
  }

  closeUsPreview(): void {
    this.previewUs = null;
    document.body.style.overflow = '';
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.previewUs) this.closeUsPreview();
  }

  openTcFromPreview(us: UserStory): void {
    this.closeUsPreview();
    this.openTcScreen(us);
  }

  // ── Navigation vues ───────────────────────────────

  openTcScreen(us: UserStory): void {
    this.selectedUs = us;
    this.currentView = 'tc-list';
    this.testCases = [];
    this.generationError = '';
    this.pushResult = null;
    this.pushError = '';
    this.squashPanelOpen = false;
    this.squashFolderName = '';
    this.selectedTcIds = new Set();
    this.selectedTc = null;
    this.loadExistingTestCases(us.id);
  }

  openTcDetail(tc: TestCase): void {
    this.selectedTc = tc;
    this.currentView = 'tc-detail';
  }

  backToUsList(): void {
    this.currentView = 'us-list';
    this.selectedUs = null;
    this.testCases = [];
    this.selectedTc = null;
  }

  backToTcList(): void {
    this.currentView = 'tc-list';
    this.selectedTc = null;
  }

  // ── CT ────────────────────────────────────────────

  loadTestCaseCounts(stories: UserStory[]): void {
    this.tcCountMap = new Map();
    for (const us of stories) {
      this.aiService.getTestCases(us.id).subscribe({
        next: (tc) => { if (tc.length > 0) this.tcCountMap.set(us.id, tc.length); },
        error: () => {},
      });
    }
  }

  loadExistingTestCases(usId: number): void {
    this.aiService.getTestCases(usId).subscribe({
      next: (tc) => {
        this.testCases = tc;
        if (tc.length > 0) this.tcCountMap.set(usId, tc.length);
        else this.tcCountMap.delete(usId);
      },
      error: () => {},
    });
  }

  generate(): void {
    if (!this.selectedUs) return;
    this.generating = true;
    this.generationError = '';

    const doGenerate = () => {
      this.aiService.generate({
        usId: this.selectedUs!.id,
        usTitle: this.selectedUs!.subject,
        usDescription: this.selectedUs!.description,
      }).subscribe({
        next: (res) => {
          this.testCases = res.testCases;
          this.generating = false;
          if (this.selectedUs) this.tcCountMap.set(this.selectedUs.id, res.testCases.length);
        },
        error: () => {
          this.generationError = 'Erreur lors de la génération. Réessaie.';
          this.generating = false;
        },
      });
    };

    if (this.testCases.length > 0) {
      const ids = this.testCases.filter((tc) => tc.id).map((tc) => tc.id!);
      let pending = ids.length;
      if (pending === 0) { doGenerate(); return; }
      for (const id of ids) {
        this.aiService.deleteTestCase(id).subscribe({
          next: () => { if (--pending === 0) doGenerate(); },
          error: () => { if (--pending === 0) doGenerate(); },
        });
      }
    } else {
      doGenerate();
    }
  }

  generateSpecific(): void {
    if (!this.selectedUs || !this.specificCriteria.trim()) return;
    this.generating = true;
    this.generationError = '';
    this.aiService.generate({
      usId: this.selectedUs.id,
      usTitle: this.selectedUs.subject,
      usDescription: this.selectedUs.description,
      specificCriteria: this.specificCriteria.trim(),
    }).subscribe({
      next: (res) => {
        this.testCases = [...this.testCases, ...res.testCases];
        this.generating = false;
        this.specificCriteria = '';
        this.criteriaOpen = false;
        if (this.selectedUs) this.tcCountMap.set(this.selectedUs.id, this.testCases.length);
      },
      error: () => {
        this.generationError = 'Erreur lors de la génération. Réessaie.';
        this.generating = false;
      },
    });
  }

  addManualTestCase(): void {
    if (!this.selectedUs) return;
    this.addingManual = true;
    this.aiService.createManualTestCase(this.selectedUs.id, this.selectedUs.subject).subscribe({
      next: (tc) => {
        this.testCases = [...this.testCases, tc];
        this.addingManual = false;
        if (this.selectedUs) this.tcCountMap.set(this.selectedUs.id, this.testCases.length);
      },
      error: () => { this.addingManual = false; },
    });
  }

  saveTcField(field: 'title' | 'preconditions', target: EventTarget | null): void {
    if (!this.selectedTc?.id || !target) return;
    const value = (target as HTMLElement).innerText.trim();
    if (value === (this.selectedTc as any)[field]) return;
    this.tcSaving = true;
    this.aiService.updateTestCase(this.selectedTc.id, { [field]: value }).subscribe({
      next: (updated) => {
        (this.selectedTc as any)[field] = updated[field];
        this.tcSaving = false;
        this.tcSaved = true;
        setTimeout(() => { this.tcSaved = false; }, 1500);
      },
      error: () => { this.tcSaving = false; },
    });
  }

  savePriority(priority: 'low' | 'medium' | 'high'): void {
    if (!this.selectedTc?.id || priority === this.selectedTc.priority) return;
    this.selectedTc.priority = priority;
    this.aiService.updateTestCase(this.selectedTc.id, { priority }).subscribe({ error: () => {} });
  }

  saveStep(step: TestStep, field: 'action' | 'expected_result', target: EventTarget | null): void {
    if (!step.id || !target) return;
    const el = target as HTMLElement;
    const value = el.innerHTML;
    this.savingStepId = step.id;
    this.aiService.updateStep(step.id, { [field]: value }).subscribe({
      next: () => {
        (step as any)[field] = value;
        this.savingStepId = null;
        this.savedStepId = step.id!;
        setTimeout(() => { this.savedStepId = null; }, 1500);
      },
      error: () => { this.savingStepId = null; },
    });
  }

  formatText(cmd: string): void {
    document.execCommand(cmd, false);
  }

  insertStep(afterIndex: number): void {
    if (!this.selectedTc?.id) return;
    const newOrder = afterIndex + 2; // 1-based, insert after position afterIndex+1
    this.addingStepAt = afterIndex;
    this.aiService.addStep(this.selectedTc.id, newOrder).subscribe({
      next: (step) => {
        this.selectedTc!.steps.splice(afterIndex + 1, 0, step);
        this.addingStepAt = null;
      },
      error: () => { this.addingStepAt = null; },
    });
  }

  addStepAtEnd(): void {
    if (!this.selectedTc?.id) return;
    const newOrder = (this.selectedTc.steps?.length ?? 0) + 1;
    this.addingStepAt = newOrder;
    this.aiService.addStep(this.selectedTc.id, newOrder).subscribe({
      next: (step) => {
        this.selectedTc!.steps.push(step);
        this.addingStepAt = null;
      },
      error: () => { this.addingStepAt = null; },
    });
  }

  removeStep(step: TestStep, index: number): void {
    if (!step.id) return;
    this.aiService.deleteStep(step.id).subscribe({
      next: () => {
        this.selectedTc!.steps.splice(index, 1);
        // Réajuster step_order localement
        this.selectedTc!.steps.forEach((s, i) => s.step_order = i + 1);
      },
      error: () => {},
    });
  }

  deleteTestCase(tc: TestCase): void {
    if (!tc.id) return;
    this.aiService.deleteTestCase(tc.id).subscribe({
      next: () => {
        this.testCases = this.testCases.filter((t) => t.id !== tc.id);
        if (this.currentView === 'tc-detail') this.backToTcList();
      },
      error: () => {},
    });
  }

  toggleStatus(tc: TestCase | null): void {
    if (!tc?.id) return;
    const next = tc.status === 'ready' ? 'draft' : 'ready';
    this.aiService.updateStatus(tc.id, next).subscribe({
      next: (updated) => { tc.status = updated.status; },
      error: () => {},
    });
  }

  // ── Squash credentials ────────────────────────────

  get squashUrlDisplay(): string {
    try { return new URL(this.squashUrlInput).hostname; } catch { return this.squashUrlInput; }
  }

  configureSquash(): void {
    const url = this.squashUrlInput.trim();
    const token = this.squashTokenInput.trim();
    this.squashConfigError = '';
    if (!url || !token) { this.squashConfigError = 'URL et token requis.'; return; }
    if (!/^https?:\/\/.+/.test(url)) {
      this.squashConfigError = 'URL invalide. Ex : http://squash:8080/squash';
      return;
    }
    this.squashConnecting = true;
    this.squashService.saveCredentials(url, token);
    this.squashService.getProjects().subscribe({
      next: (projects) => {
        this.squashConfigured = true;
        this.squashProjects = projects;
        this.squashConnecting = false;
      },
      error: (err) => {
        this.squashService.clearCredentials();
        this.squashConfigError = err?.error?.error || 'Connexion Squash échouée. Vérifie l\'URL et le token.';
        this.squashConnecting = false;
      },
    });
  }

  disconnectSquash(): void {
    this.squashService.clearCredentials();
    this.squashConfigured = false;
    this.squashConfigError = '';
    this.squashUrlInput = '';
    this.squashTokenInput = '';
    this.squashProjects = [];
    this.squashPanelOpen = false;
    this.pushResult = null;
  }

  // ── Squash push ───────────────────────────────────

  toggleTcSelection(tc: TestCase, event: Event): void {
    event.stopPropagation();
    if (!tc.id) return;
    const next = new Set(this.selectedTcIds);
    if (next.has(tc.id)) next.delete(tc.id);
    else next.add(tc.id);
    this.selectedTcIds = next;
  }

  selectAllTc(): void {
    if (this.selectedTcIds.size === this.testCases.length) {
      this.selectedTcIds = new Set();
    } else {
      this.selectedTcIds = new Set(this.testCases.filter(tc => tc.id).map(tc => tc.id!));
    }
  }

  openSquashPush(): void {
    if (this.selectedTcIds.size === 0) return;
    if (!this.squashConfigured) {
      this.pushError = 'Configurez les credentials Squash TM dans la barre latérale avant d\'injecter.';
      return;
    }
    this.squashPanelOpen = !this.squashPanelOpen;
    this.pushResult = null;
    this.pushError = '';
    if (this.squashPanelOpen && this.squashProjects.length === 0) {
      this.squashProjectsLoading = true;
      this.squashService.getProjects().subscribe({
        next: (p) => { this.squashProjects = p; this.squashProjectsLoading = false; },
        error: () => { this.squashProjectsLoading = false; this.pushError = 'Impossible de charger les projets Squash.'; },
      });
    }
  }

  titlesOf(items: { title: string }[]): string {
    return items.map(i => `"${i.title}"`).join(', ');
  }

  pushToSquash(): void {
    if (!this.selectedSquashProjectId || this.selectedTcIds.size === 0) return;
    this.pushingToSquash = true;
    this.pushResult = null;
    this.pushError = '';
    const tcIds = Array.from(this.selectedTcIds);
    this.squashService.push(tcIds, this.selectedSquashProjectId, this.squashFolderName || undefined).subscribe({
      next: (result) => {
        this.pushingToSquash = false;
        this.pushResult = result;
        this.squashPanelOpen = false;
        this.selectedTcIds = new Set();
        this.loadExistingTestCases(this.selectedUs!.id);
      },
      error: (err) => {
        this.pushingToSquash = false;
        this.pushError = err?.error?.error || "Erreur lors de l'envoi vers Squash.";
      },
    });
  }
}
