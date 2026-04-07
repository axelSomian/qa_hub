import { Router, Request, Response } from 'express';
import { getSquashProjects, pushTestCasesToSquash } from '../services/squash.service';

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

// POST /api/squash/push — injecter une sélection de CT dans un projet/dossier Squash
router.post('/push', async (req: Request, res: Response) => {
  const { url, token } = getSquashCreds(req);
  const { tcIds, projectId, folderName } = req.body;

  if (!url || !token) {
    res.status(400).json({ error: 'SQUASH_URL et SQUASH_TOKEN requis' });
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
    const result = await pushTestCasesToSquash(url, token, Number(projectId), tcIds, folderName);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('❌ Squash push error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
