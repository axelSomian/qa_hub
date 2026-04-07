import { Router, Request, Response } from 'express';
import { generateTestCases, generateSpecificTestCase } from '../services/ai.service';
import { query } from '../db';

const router = Router();

// POST /api/ai/generate
router.post('/generate', async (req: Request, res: Response) => {
  const { usId, usTitle, usDescription, specificCriteria } = req.body;

  if (!usTitle) {
    res.status(400).json({ error: 'usTitle est requis' });
    return;
  }

  try {
    const saveTc = async (tc: any) => {
      const result = await query(
        `INSERT INTO test_cases (us_id, us_title, title, preconditions, priority, status)
         VALUES ($1, $2, $3, $4, $5, 'draft') RETURNING id`,
        [usId, usTitle, tc.title, tc.preconditions, tc.priority]
      );
      const tcId = result.rows[0].id;
      for (let i = 0; i < tc.steps.length; i++) {
        await query(
          `INSERT INTO test_steps (test_case_id, step_order, action, expected_result)
           VALUES ($1, $2, $3, $4)`,
          [tcId, i + 1, tc.steps[i].action, tc.steps[i].expected]
        );
      }
      return { ...tc, id: tcId };
    };

    // Mode spécifique : génère 1 CT et l'ajoute aux existants
    if (specificCriteria) {
      const tc = await generateSpecificTestCase(usTitle, usDescription || '', specificCriteria);
      const saved = await saveTc(tc);
      res.json({ success: true, testCases: [saved], mode: 'specific' });
      return;
    }

    // Mode complet : génère tous les CT (remplace)
    const testCases = await generateTestCases(usTitle, usDescription || '');
    const saved = [];
    for (const tc of testCases) saved.push(await saveTc(tc));

    res.json({ success: true, testCases: saved, mode: 'full' });
  } catch (err: any) {
    console.error('❌ Erreur génération IA :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/test-cases — créer un CT vide manuellement
router.post('/test-cases', async (req: Request, res: Response) => {
  const { usId, usTitle } = req.body;
  if (!usId) { res.status(400).json({ error: 'usId requis' }); return; }
  try {
    const { rows } = await query(
      `INSERT INTO test_cases (us_id, us_title, title, preconditions, priority, status)
       VALUES ($1, $2, 'Nouveau cas de test', '', 'medium', 'draft') RETURNING id`,
      [usId, usTitle || '']
    );
    const tcId = rows[0].id;
    const { rows: steps } = await query(
      `INSERT INTO test_steps (test_case_id, step_order, action, expected_result)
       VALUES ($1, 1, '', '') RETURNING *`,
      [tcId]
    );
    res.json({ id: tcId, title: 'Nouveau cas de test', preconditions: '', priority: 'medium', status: 'draft', steps });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/test-cases/:usId — récupérer les cas d'une US
router.get('/test-cases/:usId', async (req: Request, res: Response) => {
  try {
    const { rows: cases } = await query(
      `SELECT * FROM test_cases WHERE us_id = $1 ORDER BY created_at DESC`,
      [req.params.usId]
    );

    for (const tc of cases) {
      const { rows: steps } = await query(
        `SELECT * FROM test_steps WHERE test_case_id = $1 ORDER BY step_order`,
        [tc.id]
      );
      tc.steps = steps;
    }

    res.json(cases);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/ai/test-cases/:id — modifier titre, préconditions, priorité
router.patch('/test-cases/:id', async (req: Request, res: Response) => {
  const { title, preconditions, priority } = req.body;
  const validPriorities = ['low', 'medium', 'high'];
  if (priority && !validPriorities.includes(priority)) {
    res.status(400).json({ error: `Priorité invalide. Valeurs acceptées : ${validPriorities.join(', ')}` });
    return;
  }
  try {
    const { rows } = await query(
      `UPDATE test_cases
       SET title = COALESCE($1, title),
           preconditions = COALESCE($2, preconditions),
           priority = COALESCE($3, priority)
       WHERE id = $4 RETURNING *`,
      [title ?? null, preconditions ?? null, priority ?? null, req.params.id]
    );
    if (rows.length === 0) { res.status(404).json({ error: 'Cas de test introuvable' }); return; }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/ai/test-cases/:id/status — changer le statut d'un cas
router.patch('/test-cases/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body;
  const validStatuses = ['draft', 'ready', 'in_progress', 'passed', 'failed'];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: `Statut invalide. Valeurs acceptées : ${validStatuses.join(', ')}` });
    return;
  }
  try {
    const { rows } = await query(
      `UPDATE test_cases SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Cas de test introuvable' });
      return;
    }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/test-cases/:tcId/steps — insérer une étape à une position donnée
router.post('/test-cases/:tcId/steps', async (req: Request, res: Response) => {
  const { step_order } = req.body;
  if (!step_order) { res.status(400).json({ error: 'step_order requis' }); return; }
  try {
    await query(
      `UPDATE test_steps SET step_order = step_order + 1
       WHERE test_case_id = $1 AND step_order >= $2`,
      [req.params.tcId, step_order]
    );
    const { rows } = await query(
      `INSERT INTO test_steps (test_case_id, step_order, action, expected_result)
       VALUES ($1, $2, '', '') RETURNING *`,
      [req.params.tcId, step_order]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ai/test-steps/:id — supprimer une étape et réordonner
router.delete('/test-steps/:id', async (req: Request, res: Response) => {
  try {
    const { rows } = await query(`SELECT * FROM test_steps WHERE id = $1`, [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'Étape introuvable' }); return; }
    const { test_case_id, step_order } = rows[0];
    await query(`DELETE FROM test_steps WHERE id = $1`, [req.params.id]);
    await query(
      `UPDATE test_steps SET step_order = step_order - 1
       WHERE test_case_id = $1 AND step_order > $2`,
      [test_case_id, step_order]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/ai/test-steps/:id — modifier une étape
router.patch('/test-steps/:id', async (req: Request, res: Response) => {
  const { action, expected_result } = req.body;
  if (action === undefined && expected_result === undefined) {
    res.status(400).json({ error: 'action ou expected_result requis' });
    return;
  }
  try {
    const { rows } = await query(
      `UPDATE test_steps
       SET action = COALESCE($1, action),
           expected_result = COALESCE($2, expected_result)
       WHERE id = $3 RETURNING *`,
      [action ?? null, expected_result ?? null, req.params.id]
    );
    if (rows.length === 0) { res.status(404).json({ error: 'Étape introuvable' }); return; }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ai/test-cases/:id — supprimer un cas de test
router.delete('/test-cases/:id', async (req: Request, res: Response) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM test_cases WHERE id = $1`,
      [req.params.id]
    );
    if (rowCount === 0) {
      res.status(404).json({ error: 'Cas de test introuvable' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;