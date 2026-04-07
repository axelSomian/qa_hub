import { Router, Request, Response } from 'express';
import {
  getProjects,
  getUserStories,
  testConnection,
} from '../services/openproject.service';

const router = Router();

const getConfig = (req: Request) => {
  const baseUrl = (req.headers['x-op-url'] as string) || process.env.OPENPROJECT_URL || '';
  const token = (req.headers['x-op-token'] as string) || process.env.OPENPROJECT_TOKEN || '';
  return { baseUrl, token };
};

// GET /api/openproject/test — tester la connexion
router.get('/test', async (req: Request, res: Response) => {
  try {
    const { baseUrl, token } = getConfig(req);
    const result = await testConnection(baseUrl, token);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ connected: false, error: err.message });
  }
});

// GET /api/openproject/projects — liste des projets
router.get('/projects', async (req: Request, res: Response) => {
  try {
    const { baseUrl, token } = getConfig(req);
    const projects = await getProjects(baseUrl, token);
    res.json(projects);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/openproject/projects/:id/user-stories — US d'un projet
router.get('/projects/:id/user-stories', async (req: Request, res: Response) => {
  try {
    const { baseUrl, token } = getConfig(req);
    const userStories = await getUserStories(baseUrl, token, req.params.id as string);
    res.json(userStories);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;