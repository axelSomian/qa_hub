import { Router, Request, Response } from 'express';
import { query } from '../db';
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

// ── POST /api/executions/sessions ─────────────────────────────
// Crée une session + executions + campagne Squash optionnelle
router.post('/sessions', async (req: Request, res: Response) => {
  const { tcIds, sessionName, squashProjectId } = req.body;
  if (!tcIds || !Array.isArray(tcIds) || tcIds.length === 0) {
    res.status(400).json({ error: 'tcIds requis' }); return;
  }

  try {
    const name = sessionName || `Session ${new Date().toISOString().slice(0, 10)}`;

    // Créer la session
    const { rows: [session] } = await query(
      `INSERT INTO execution_sessions (name) VALUES ($1) RETURNING *`, [name]
    );

    // Récupérer les TCs avec leurs steps
    const placeholders = tcIds.map((_: any, i: number) => `$${i + 1}`).join(', ');
    const { rows: cases } = await query(
      `SELECT * FROM test_cases WHERE id IN (${placeholders}) ORDER BY created_at`, tcIds
    );
    for (const tc of cases) {
      const { rows: steps } = await query(
        `SELECT * FROM test_steps WHERE test_case_id = $1 ORDER BY step_order`, [tc.id]
      );
      tc.steps = steps;
    }

    // Créer une exécution par TC
    const executions: any[] = [];
    for (const tc of cases) {
      const { rows: [exec] } = await query(
        `INSERT INTO executions (session_id, test_case_id, global_status, started_at)
         VALUES ($1, $2, 'pending', NOW()) RETURNING *`,
        [session.id, tc.id]
      );
      exec.tc = tc;
      executions.push(exec);
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

          // Ajouter les TCs qui ont un squash_id au plan de test
          const squashTcIds = cases.filter((tc: any) => tc.squash_id).map((tc: any) => Number(tc.squash_id));
          if (squashTcIds.length > 0) {
            const { items } = await addTestPlanItems(url, token, squashCampaignId, squashTcIds);
            // Stocker le test_plan_item_id dans chaque execution
            for (const item of items) {
              const tc = cases.find((c: any) => String(c.squash_id) === String(item.tcId));
              if (tc) {
                const exec = executions.find((e: any) => e.test_case_id === tc.id);
                if (exec) {
                  await query(
                    `UPDATE executions SET squash_test_plan_item_id = $1 WHERE id = $2`,
                    [String(item.id), exec.id]
                  );
                  exec.squash_test_plan_item_id = String(item.id);
                }
              }
            }
          }
        } catch (e: any) {
          console.error('⚠️ Squash campaign error (non bloquant):', e.message);
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
      const { rows: [tc] } = await query(`SELECT * FROM test_cases WHERE id = $1`, [exec.test_case_id]);
      const { rows: steps } = await query(`SELECT * FROM test_steps WHERE test_case_id = $1 ORDER BY step_order`, [exec.test_case_id]);
      tc.steps = steps;
      exec.tc = tc;
      const { rows: execSteps } = await query(`SELECT * FROM execution_steps WHERE execution_id = $1`, [exec.id]);
      exec.execution_steps = execSteps;
    }

    res.json({ session, executions });
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
    // Upsert execution_step
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

    // Squash : créer l'exécution si pas encore fait + màj step
    const { url, token } = getSquashCreds(req);
    if (url && token) {
      try {
        const { rows: [exec] } = await query(`SELECT * FROM executions WHERE id = $1`, [req.params.executionId]);
        let squashExecId = exec?.squash_execution_id;

        if (!squashExecId && exec?.squash_test_plan_item_id) {
          const squashExec = await createSquashExecution(url, token, Number(exec.squash_test_plan_item_id));
          squashExecId = String(squashExec.id);
          await query(`UPDATE executions SET squash_execution_id = $1 WHERE id = $2`, [squashExecId, exec.id]);

          // Stocker les IDs des steps Squash
          for (const ss of squashExec.steps) {
            await query(
              `UPDATE execution_steps SET squash_execution_step_id = $1
               WHERE execution_id = $2 AND step_id IN (
                 SELECT id FROM test_steps WHERE test_case_id = $3 ORDER BY step_order LIMIT 1 OFFSET $4
               )`,
              [String(ss.id), req.params.executionId, exec.test_case_id, ss.stepOrder]
            );
          }
        }

        if (execStep.squash_execution_step_id) {
          await updateSquashExecutionStep(
            url, token, Number(execStep.squash_execution_step_id),
            toSquashStatus(status) as any, comment
          );
        }
      } catch (e: any) {
        console.error('⚠️ Squash step update (non bloquant):', e.message);
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

    // Màj statut Squash
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

// ── PATCH /api/executions/sessions/:id/complete ───────────────
router.patch('/sessions/:id/complete', async (req: Request, res: Response) => {
  const { notes } = req.body;
  try {
    const { rows: [session] } = await query(
      `UPDATE execution_sessions SET status = 'completed', ended_at = NOW(), notes = $1
       WHERE id = $2 RETURNING *`,
      [notes || null, req.params.id]
    );
    if (!session) { res.status(404).json({ error: 'Session introuvable' }); return; }

    // Générer le rapport
    const { rows: executions } = await query(
      `SELECT e.*, tc.title as tc_title, tc.priority
       FROM executions e JOIN test_cases tc ON tc.id = e.test_case_id
       WHERE e.session_id = $1`,
      [req.params.id]
    );

    const total = executions.length;
    const passed = executions.filter((e: any) => e.global_status === 'passed').length;
    const failed = executions.filter((e: any) => e.global_status === 'failed').length;
    const blocked = executions.filter((e: any) => e.global_status === 'blocked').length;
    const pending = executions.filter((e: any) => e.global_status === 'pending').length;
    const duration = session.ended_at && session.started_at
      ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000)
      : 0;

    res.json({ session, executions, report: { total, passed, failed, blocked, pending, duration } });
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
      `SELECT e.*, tc.title as tc_title, tc.priority
       FROM executions e JOIN test_cases tc ON tc.id = e.test_case_id
       WHERE e.session_id = $1 ORDER BY e.started_at`,
      [req.params.id]
    );
    for (const exec of executions) {
      const { rows: steps } = await query(
        `SELECT es.*, ts.action, ts.expected_result, ts.step_order
         FROM execution_steps es
         JOIN test_steps ts ON ts.id = es.step_id
         WHERE es.execution_id = $1
         ORDER BY ts.step_order`,
        [exec.id]
      );
      exec.steps = steps;
    }

    const total = executions.length;
    const passed = executions.filter((e: any) => e.global_status === 'passed').length;
    const failed = executions.filter((e: any) => e.global_status === 'failed').length;
    const blocked = executions.filter((e: any) => e.global_status === 'blocked').length;
    const duration = session.ended_at && session.started_at
      ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000)
      : 0;

    res.json({ session, executions, report: { total, passed, failed, blocked, pending: total - passed - failed - blocked, duration } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
