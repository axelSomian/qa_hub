import { Router, Request, Response } from 'express';
import { getSquashProjects, getSquashTestCases, getSquashTestCaseDetail, getSquashLibraryRoot, getSquashFolderContent, pushTestCasesToSquash, createSquashProject } from '../services/squash.service';
import { createOpTask, createTimeEntry } from '../services/openproject.service';

const router = Router();

const h = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) || '';

const getSquashCreds = (req: Request): { url: string; token: string } => ({
  url: h(req.headers['x-squash-url']) || process.env.SQUASH_URL || '',
  token: h(req.headers['x-squash-token']) || process.env.SQUASH_TOKEN || '',
});

const validateUrl = (url: string): boolean => {
  try { return /^https?:\/\/.+/.test(url); } catch { return false; }
};

// GET /api/squash/projects
router.get('/projects', async (req: Request, res: Response) => {
  const { url, token } = getSquashCreds(req);
  if (!url || !token) {
    res.status(400).json({ error: 'SQUASH_URL et SQUASH_TOKEN requis' });
    return;
  }
  if (!validateUrl(url)) {
    res.status(400).json({ error: `URL Squash invalide : "${url}". Format attendu : http://host:port/squash` });
    return;
  }
  try {
    const projects = await getSquashProjects(url, token);
    res.json(projects);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/squash/projects/:id/library — racine de la librairie (dossiers + TCs)
router.get('/projects/:id/library', async (req: Request, res: Response) => {
  const { url, token } = getSquashCreds(req);
  if (!url || !token) { res.status(400).json({ error: 'Credentials Squash requis' }); return; }
  if (!validateUrl(url)) { res.status(400).json({ error: 'URL Squash invalide' }); return; }
  try {
    const nodes = await getSquashLibraryRoot(url, token, Number(req.params.id));
    res.json(nodes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/squash/folders/:id/content — contenu d'un dossier
router.get('/folders/:id/content', async (req: Request, res: Response) => {
  const { url, token } = getSquashCreds(req);
  if (!url || !token) { res.status(400).json({ error: 'Credentials Squash requis' }); return; }
  if (!validateUrl(url)) { res.status(400).json({ error: 'URL Squash invalide' }); return; }
  try {
    const nodes = await getSquashFolderContent(url, token, Number(req.params.id));
    res.json(nodes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/squash/projects/:id/test-cases — CTs d'un projet Squash
router.get('/projects/:id/test-cases', async (req: Request, res: Response) => {
  const { url, token } = getSquashCreds(req);
  if (!url || !token) { res.status(400).json({ error: 'Credentials Squash requis' }); return; }
  if (!validateUrl(url)) { res.status(400).json({ error: 'URL Squash invalide' }); return; }
  try {
    const tcs = await getSquashTestCases(url, token, Number(req.params.id));
    res.json(tcs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/squash/test-cases/:id — détail d'un TC Squash avec steps
router.get('/test-cases/:id', async (req: Request, res: Response) => {
  const { url, token } = getSquashCreds(req);
  if (!url || !token) { res.status(400).json({ error: 'Credentials Squash requis' }); return; }
  if (!validateUrl(url)) { res.status(400).json({ error: 'URL Squash invalide' }); return; }
  try {
    const tc = await getSquashTestCaseDetail(url, token, Number(req.params.id));
    res.json(tc);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/squash/projects — créer un projet Squash TM
router.post('/projects', async (req: Request, res: Response) => {
  const { url, token } = getSquashCreds(req);
  const { name, description } = req.body;
  if (!url || !token) { res.status(400).json({ error: 'SQUASH_URL et SQUASH_TOKEN requis' }); return; }
  if (!validateUrl(url)) { res.status(400).json({ error: `URL Squash invalide` }); return; }
  if (!name || !name.trim()) { res.status(400).json({ error: 'Nom du projet requis' }); return; }
  try {
    const project = await createSquashProject(url, token, name, description);
    res.status(201).json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/squash/push — injecter les CT dans Squash + créer tâche OP optionnelle
router.post('/push', async (req: Request, res: Response) => {
  const { url, token } = getSquashCreds(req);
  const { tcIds, projectId, folderName, opTask } = req.body;
  // opTask: { opUrl, opToken, opProjectId, usId, usTitle, hours, comment }

  if (!url || !token) {
    res.status(400).json({ error: 'SQUASH_URL et SQUASH_TOKEN requis' });
    return;
  }
  if (!validateUrl(url)) {
    res.status(400).json({ error: `URL Squash invalide : "${url}". Format attendu : http://host:port/squash` });
    return;
  }
  if (!projectId) {
    res.status(400).json({ error: 'projectId requis' });
    return;
  }
  if (!tcIds || !Array.isArray(tcIds) || tcIds.length === 0) {
    res.status(400).json({ error: 'tcIds (tableau) requis' });
    return;
  }

  try {
    const squashResult = await pushTestCasesToSquash(url, token, Number(projectId), tcIds, folderName);

    // Création optionnelle d'une tâche OpenProject
    let opResult: any = null;
    if (opTask?.opUrl && opTask?.opToken && opTask?.opProjectId && opTask?.usId) {
      try {
        const wp = await createOpTask(
          opTask.opUrl,
          opTask.opToken,
          Number(opTask.opProjectId),
          Number(opTask.usId),
          opTask.usTitle || 'User Story',
          opTask.priority || 'medium',
          opTask.estimatedHours ? Number(opTask.estimatedHours) : undefined,
          opTask.assigneeId ? Number(opTask.assigneeId) : undefined
        );
        opResult = { taskId: wp.id, taskUrl: wp.url, subject: wp.subject };

        if (opTask.hours && Number(opTask.hours) > 0) {
          const te = await createTimeEntry(
            opTask.opUrl,
            opTask.opToken,
            Number(opTask.opProjectId),
            wp.id,
            Number(opTask.hours),
            opTask.comment || `Exécution de ${squashResult.pushed.length} cas de test`
          );
          opResult.timeEntryId = te.id;
          opResult.hoursLogged = te.hours;
        }
      } catch (opErr: any) {
        console.error('⚠️ OpenProject task error (non bloquant):', opErr.message);
        opResult = { error: opErr.message };
      }
    }

    res.json({ success: true, ...squashResult, opTask: opResult });
  } catch (err: any) {
    console.error('❌ Squash push error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
