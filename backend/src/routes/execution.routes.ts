import { Router, Request, Response } from 'express';
import { query } from '../db';
import { callGroqRaw } from '../services/ai.service';
import {
  createCampaign, addTestPlanItems, createSquashExecution,
  updateSquashExecution, updateSquashExecutionStep,
} from '../services/squash.service';

const router = Router();

const h = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) || '';
const getSquashCreds = (req: Request) => ({
  url: h(req.headers['x-squash-url']) || process.env.SQUASH_URL || '',
  token: h(req.headers['x-squash-token']) || process.env.SQUASH_TOKEN || '',
});
const toSquashStatus = (s: string) =>
  s === 'passed' ? 'SUCCESS' : s === 'failed' ? 'FAILURE' : 'BLOCKED';

// ── GET /api/executions/sessions — liste toutes les sessions ──
router.get('/sessions', async (_req: Request, res: Response) => {
  try {
    const { rows: sessions } = await query(`
      SELECT s.*,
        COUNT(e.id)::int AS total,
        COUNT(CASE WHEN e.global_status = 'passed' THEN 1 END)::int AS passed,
        COUNT(CASE WHEN e.global_status = 'failed' THEN 1 END)::int AS failed,
        COUNT(CASE WHEN e.global_status = 'blocked' THEN 1 END)::int AS blocked,
        COUNT(CASE WHEN e.global_status = 'pending' THEN 1 END)::int AS pending
      FROM execution_sessions s
      LEFT JOIN executions e ON e.session_id = s.id
      GROUP BY s.id
      ORDER BY s.started_at DESC
    `);
    res.json(sessions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/executions/sessions — créer une session ────────
router.post('/sessions', async (req: Request, res: Response) => {
  const { sessionName, squashProjectId, squashProjectName, squashTcs, tcIds } = req.body;
  // squashTcs: [{ id, name, importance }] — CTs Squash sélectionnés

  try {
    const name = sessionName || `Session ${new Date().toISOString().slice(0, 10)}`;

    const { rows: [session] } = await query(
      `INSERT INTO execution_sessions (name, squash_project_id, squash_project_name)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, squashProjectId || null, squashProjectName || null]
    );

    const executions: any[] = [];

    // Cas 1 : CTs venant de Squash TM (arbre dossiers)
    if (squashTcs && Array.isArray(squashTcs) && squashTcs.length > 0) {
      for (const tc of squashTcs) {
        const { rows: [exec] } = await query(
          `INSERT INTO executions (session_id, squash_tc_id, tc_title, tc_importance, global_status, started_at)
           VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING *`,
          [session.id, tc.id, tc.name, tc.importance || 'MEDIUM']
        );
        executions.push(exec);
      }
    }

    // Cas 2 : CTs venant de la DB (legacy)
    if (tcIds && Array.isArray(tcIds) && tcIds.length > 0) {
      const placeholders = tcIds.map((_: any, i: number) => `$${i + 1}`).join(', ');
      const { rows: cases } = await query(
        `SELECT * FROM test_cases WHERE id IN (${placeholders})`, tcIds
      );
      for (const tc of cases) {
        const { rows: [exec] } = await query(
          `INSERT INTO executions (session_id, test_case_id, tc_title, tc_importance, global_status, started_at)
           VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING *`,
          [session.id, tc.id, tc.title, tc.priority || 'medium']
        );
        executions.push(exec);
      }
    }

    // Campagne Squash optionnelle
    let squashCampaignId: number | null = null;
    if (squashProjectId) {
      const { url, token } = getSquashCreds(req);
      if (url && token) {
        try {
          const campaign = await createCampaign(url, token, Number(squashProjectId), name);
          squashCampaignId = campaign.id;
          await query(`UPDATE execution_sessions SET squash_campaign_id = $1 WHERE id = $2`,
            [String(squashCampaignId), session.id]);

          const squashTcIdList = (squashTcs || []).map((tc: any) => Number(tc.id));
          if (squashTcIdList.length > 0) {
            const { items } = await addTestPlanItems(url, token, squashCampaignId, squashTcIdList);
            for (const item of items) {
              const exec = executions.find((e: any) => e.squash_tc_id === item.tcId);
              if (exec) {
                await query(
                  `UPDATE executions SET squash_test_plan_item_id = $1 WHERE id = $2`,
                  [String(item.id), exec.id]
                );
              }
            }
          }
        } catch (e: any) {
          console.error('⚠️ Squash campaign (non bloquant):', e.message);
        }
      }
    }

    res.status(201).json({ session: { ...session, squash_campaign_id: squashCampaignId }, executions });
  } catch (err: any) {
    console.error('❌ Session creation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/executions/sessions/:id ─────────────────────────
router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { rows: [session] } = await query(`SELECT * FROM execution_sessions WHERE id = $1`, [req.params.id]);
    if (!session) { res.status(404).json({ error: 'Session introuvable' }); return; }

    const { rows: executions } = await query(
      `SELECT * FROM executions WHERE session_id = $1 ORDER BY started_at`, [req.params.id]
    );
    for (const exec of executions) {
      if (exec.test_case_id) {
        const { rows: [tc] } = await query(`SELECT * FROM test_cases WHERE id = $1`, [exec.test_case_id]);
        const { rows: steps } = await query(`SELECT * FROM test_steps WHERE test_case_id = $1 ORDER BY step_order`, [exec.test_case_id]);
        if (tc) { tc.steps = steps; exec.tc = tc; }
      }
      const { rows: execSteps } = await query(`SELECT * FROM execution_steps WHERE execution_id = $1`, [exec.id]);
      exec.execution_steps = execSteps;
    }

    res.json({ session, executions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/executions/sessions/:id/complete ────────────────
// Finalise la session avec les résultats (appelé à la fin de l'exécution)
router.post('/sessions/:id/complete', async (req: Request, res: Response) => {
  // results: [{ squashTcId, tcTitle, tcImportance, globalStatus, stepResults: [{action, expectedResult, status, comment}] }]
  const { results, notes } = req.body;

  try {
    const { rows: [session] } = await query(`SELECT * FROM execution_sessions WHERE id = $1`, [req.params.id]);
    if (!session) { res.status(404).json({ error: 'Session introuvable' }); return; }

    // Mettre à jour chaque exécution avec son statut final
    for (const r of results || []) {
      await query(
        `UPDATE executions
         SET global_status = $1, tc_title = COALESCE($2, tc_title), tc_importance = COALESCE($3, tc_importance),
             ended_at = NOW(), notes = $4
         WHERE session_id = $5 AND (squash_tc_id = $6 OR tc_title = $2)`,
        [r.globalStatus, r.tcTitle, r.tcImportance || 'MEDIUM', r.notes || null, req.params.id, r.squashTcId || null]
      );
    }

    // Fermer la session
    const { rows: [updated] } = await query(
      `UPDATE execution_sessions SET status = 'completed', ended_at = NOW(), notes = $1
       WHERE id = $2 RETURNING *`,
      [notes || null, req.params.id]
    );

    // Calculer le rapport
    const { rows: executions } = await query(
      `SELECT * FROM executions WHERE session_id = $1`, [req.params.id]
    );
    const total = executions.length;
    const passed = executions.filter((e: any) => e.global_status === 'passed').length;
    const failed = executions.filter((e: any) => e.global_status === 'failed').length;
    const blocked = executions.filter((e: any) => e.global_status === 'blocked').length;
    const duration = updated.ended_at && updated.started_at
      ? Math.round((new Date(updated.ended_at).getTime() - new Date(updated.started_at).getTime()) / 1000)
      : 0;

    res.json({ session: updated, executions, report: { total, passed, failed, blocked, pending: total - passed - failed - blocked, duration } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/executions/sessions/:id/analyze — analyse IA ───
router.post('/sessions/:id/analyze', async (req: Request, res: Response) => {
  try {
    const { rows: [session] } = await query(`SELECT * FROM execution_sessions WHERE id = $1`, [req.params.id]);
    if (!session) { res.status(404).json({ error: 'Session introuvable' }); return; }

    const { rows: executions } = await query(
      `SELECT * FROM executions WHERE session_id = $1 ORDER BY started_at`, [req.params.id]
    );

    const total = executions.length;
    const passed = executions.filter((e: any) => e.global_status === 'passed').length;
    const failed = executions.filter((e: any) => e.global_status === 'failed').length;
    const blocked = executions.filter((e: any) => e.global_status === 'blocked').length;

    const prompt = `Tu es un expert QA. Analyse les résultats de cette session de test et donne un verdict clair.

Session : "${session.name}"
Projet Squash : ${session.squash_project_name || 'N/A'}
Date : ${new Date(session.started_at).toLocaleDateString('fr-FR')}

Résultats :
- Total : ${total} cas de test
- Passés : ${passed}
- Échoués : ${failed}
- Bloqués : ${blocked}

Détail des cas de test :
${executions.map((e: any) => `- [${e.global_status.toUpperCase()}] ${e.tc_title || 'CT #' + e.squash_tc_id} (priorité: ${e.tc_importance || 'N/A'})`).join('\n')}

Réponds en JSON avec cette structure exacte :
{
  "verdict": "OK" | "KO" | "PARTIEL",
  "score": <nombre entre 0 et 100>,
  "resume": "<1-2 phrases de résumé>",
  "points_positifs": ["<point>", ...],
  "points_negatifs": ["<point>", ...],
  "recommandations": ["<action>", ...]
}`;

    const raw = await callGroqRaw(prompt);
    // Extraire le JSON de la réponse
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Réponse IA invalide');
    const analysis = JSON.parse(jsonMatch[0]);

    // Sauvegarder l'analyse dans les notes de la session
    await query(`UPDATE execution_sessions SET notes = $1 WHERE id = $2`, [JSON.stringify(analysis), req.params.id]);

    res.json(analysis);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/executions/:executionId/steps/:stepId ─────────
router.patch('/:executionId/steps/:stepId', async (req: Request, res: Response) => {
  const { status, comment } = req.body;
  const validStatuses = ['passed', 'failed', 'blocked'];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: 'status invalide (passed|failed|blocked)' }); return;
  }

  try {
    const { rows: existing } = await query(
      `SELECT * FROM execution_steps WHERE execution_id = $1 AND step_id = $2`,
      [req.params.executionId, req.params.stepId]
    );

    let execStep: any;
    if (existing.length > 0) {
      const { rows: [updated] } = await query(
        `UPDATE execution_steps SET status = $1, comment = $2, executed_at = NOW()
         WHERE execution_id = $3 AND step_id = $4 RETURNING *`,
        [status, comment || null, req.params.executionId, req.params.stepId]
      );
      execStep = updated;
    } else {
      const { rows: [inserted] } = await query(
        `INSERT INTO execution_steps (execution_id, step_id, status, comment, executed_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
        [req.params.executionId, req.params.stepId, status, comment || null]
      );
      execStep = inserted;
    }

    const { url, token } = getSquashCreds(req);
    if (url && token) {
      try {
        const { rows: [exec] } = await query(`SELECT * FROM executions WHERE id = $1`, [req.params.executionId]);
        let squashExecId = exec?.squash_execution_id;
        if (!squashExecId && exec?.squash_test_plan_item_id) {
          const squashExec = await createSquashExecution(url, token, Number(exec.squash_test_plan_item_id));
          squashExecId = String(squashExec.id);
          await query(`UPDATE executions SET squash_execution_id = $1 WHERE id = $2`, [squashExecId, exec.id]);
        }
        if (execStep.squash_execution_step_id) {
          await updateSquashExecutionStep(url, token, Number(execStep.squash_execution_step_id), toSquashStatus(status) as any, comment);
        }
      } catch (e: any) {
        console.error('⚠️ Squash step (non bloquant):', e.message);
      }
    }

    res.json(execStep);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/executions/:executionId/complete ───────────────
router.patch('/:executionId/complete', async (req: Request, res: Response) => {
  const { global_status, notes } = req.body;
  try {
    const { rows: [exec] } = await query(
      `UPDATE executions SET global_status = $1, notes = $2, ended_at = NOW()
       WHERE id = $3 RETURNING *`,
      [global_status, notes || null, req.params.executionId]
    );
    if (!exec) { res.status(404).json({ error: 'Execution introuvable' }); return; }
    const { url, token } = getSquashCreds(req);
    if (url && token && exec.squash_execution_id) {
      try {
        await updateSquashExecution(url, token, Number(exec.squash_execution_id), toSquashStatus(global_status) as any);
      } catch (e: any) {
        console.error('⚠️ Squash exec complete (non bloquant):', e.message);
      }
    }
    res.json(exec);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/executions/sessions/:id/report ───────────────────
router.get('/sessions/:id/report', async (req: Request, res: Response) => {
  try {
    const { rows: [session] } = await query(`SELECT * FROM execution_sessions WHERE id = $1`, [req.params.id]);
    if (!session) { res.status(404).json({ error: 'Session introuvable' }); return; }

    const { rows: executions } = await query(
      `SELECT * FROM executions WHERE session_id = $1 ORDER BY started_at`, [req.params.id]
    );

    const total = executions.length;
    const passed = executions.filter((e: any) => e.global_status === 'passed').length;
    const failed = executions.filter((e: any) => e.global_status === 'failed').length;
    const blocked = executions.filter((e: any) => e.global_status === 'blocked').length;
    const duration = session.ended_at && session.started_at
      ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000)
      : 0;

    // Analyse IA sauvegardée dans les notes
    let aiAnalysis = null;
    if (session.notes) {
      try { aiAnalysis = JSON.parse(session.notes); } catch {}
    }

    res.json({ session, executions, report: { total, passed, failed, blocked, pending: total - passed - failed - blocked, duration }, aiAnalysis });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
