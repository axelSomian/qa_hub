import fetch from 'node-fetch';
import { query } from '../db';

const authHeader = (token: string) =>
  `Basic ${Buffer.from(token).toString('base64')}`;

const squashFetch = async (url: string, token: string, options: any = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': authHeader(token),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    throw new Error(body?.message || body?.error || `Squash ${res.status}: ${res.statusText}`);
  }
  return res.json();
};

export const getSquashProjects = async (squashUrl: string, squashToken: string) => {
  const data: any = await squashFetch(
    `${squashUrl}/api/rest/latest/projects?size=200`,
    squashToken
  );
  return (data._embedded?.projects || []).map((p: any) => ({ id: p.id, name: p.name }));
};

const mapNode = (item: any) => ({
  type: item._type === 'test-case' ? 'tc' : 'folder' as 'tc' | 'folder',
  id: item.id,
  name: item.name,
  reference: item.reference || '',
  importance: item.importance || 'MEDIUM',
  status: item.status || '',
});

export const getSquashLibraryRoot = async (squashUrl: string, squashToken: string, projectId: number) => {
  const data: any = await squashFetch(
    `${squashUrl}/api/rest/latest/projects/${projectId}/test-cases-library/content?size=200`,
    squashToken
  );
  const items: any[] = data._embedded?.['test-case-library-content'] || [];
  return items.map(mapNode);
};

export const getSquashFolderContent = async (squashUrl: string, squashToken: string, folderId: number) => {
  const data: any = await squashFetch(
    `${squashUrl}/api/rest/latest/test-case-folders/${folderId}/content?size=200`,
    squashToken
  );
  const items: any[] = data._embedded?.content || [];
  return items.map(mapNode);
};

export const getSquashTestCases = async (squashUrl: string, squashToken: string, projectId: number) => {
  // Récupère les TCs via la librairie du projet
  const data: any = await squashFetch(
    `${squashUrl}/api/rest/latest/projects/${projectId}/test-cases?size=200`,
    squashToken
  );
  return (data._embedded?.testCases || data._embedded?.['test-cases'] || []).map((tc: any) => ({
    id: tc.id,
    name: tc.name,
    reference: tc.reference || '',
    importance: tc.importance || 'MEDIUM',
    status: tc.status || 'WORK_IN_PROGRESS',
  }));
};

export const getSquashTestCaseDetail = async (squashUrl: string, squashToken: string, tcId: number) => {
  const tc: any = await squashFetch(
    `${squashUrl}/api/rest/latest/test-cases/${tcId}`,
    squashToken
  );
  // Récupérer les steps
  const stepsData: any = await squashFetch(
    `${squashUrl}/api/rest/latest/test-cases/${tcId}/steps`,
    squashToken
  ).catch(() => ({ _embedded: { steps: [] } }));

  const steps = (stepsData._embedded?.steps || []).map((s: any) => ({
    id: s.id,
    order: s.index || s.step_order || 0,
    action: s.action || '',
    expected_result: s.expected_result || s.expectedResult || '',
  }));

  return {
    id: tc.id,
    name: tc.name,
    reference: tc.reference || '',
    importance: tc.importance || 'MEDIUM',
    prerequisite: tc.prerequisite || '',
    steps,
  };
};

// ── Exécution ─────────────────────────────────────────────────

export const createCampaign = async (
  squashUrl: string, squashToken: string, projectId: number, name: string
): Promise<{ id: number }> => {
  const data: any = await squashFetch(`${squashUrl}/api/rest/latest/campaigns`, squashToken, {
    method: 'POST',
    body: JSON.stringify({ _type: 'campaign', name, status: 'IN_PROGRESS', project: { id: projectId, _type: 'project' } }),
  });
  return { id: data.id };
};

export const addTestPlanItems = async (
  squashUrl: string, squashToken: string, campaignId: number, squashTcIds: number[]
): Promise<{ items: { id: number; tcId: number }[] }> => {
  const items: { id: number; tcId: number }[] = [];
  for (const tcId of squashTcIds) {
    try {
      const data: any = await squashFetch(
        `${squashUrl}/api/rest/latest/campaigns/${campaignId}/test-plan`, squashToken,
        { method: 'POST', body: JSON.stringify({ _type: 'test-plan-item', referencedTestCase: { id: tcId, _type: 'test-case' } }) }
      );
      items.push({ id: data.id, tcId });
    } catch { /* CT non trouvé dans Squash, skip */ }
  }
  return { items };
};

export const createSquashExecution = async (
  squashUrl: string, squashToken: string, testPlanItemId: number
): Promise<{ id: number; steps: { id: number; stepOrder: number }[] }> => {
  const data: any = await squashFetch(
    `${squashUrl}/api/rest/latest/test-plan-items/${testPlanItemId}/executions`, squashToken,
    { method: 'POST', body: JSON.stringify({ _type: 'execution' }) }
  );
  const steps = (data.execution_steps || []).map((s: any) => ({ id: s.id, stepOrder: s.step_order || 0 }));
  return { id: data.id, steps };
};

export const updateSquashExecution = async (
  squashUrl: string, squashToken: string, executionId: number, status: 'SUCCESS' | 'FAILURE' | 'BLOCKED' | 'RUNNING'
): Promise<void> => {
  await squashFetch(`${squashUrl}/api/rest/latest/executions/${executionId}`, squashToken, {
    method: 'PATCH',
    body: JSON.stringify({ _type: 'execution', execution_status: status }),
  });
};

export const updateSquashExecutionStep = async (
  squashUrl: string, squashToken: string, execStepId: number,
  status: 'SUCCESS' | 'FAILURE' | 'BLOCKED', comment?: string
): Promise<void> => {
  await squashFetch(`${squashUrl}/api/rest/latest/execution-steps/${execStepId}`, squashToken, {
    method: 'PATCH',
    body: JSON.stringify({ _type: 'execution-step', execution_status: status, ...(comment ? { comment: { raw: comment } } : {}) }),
  });
};

export const createSquashProject = async (
  squashUrl: string,
  squashToken: string,
  name: string,
  description?: string
): Promise<{ id: number; name: string }> => {
  const label = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const data: any = await squashFetch(
    `${squashUrl}/api/rest/latest/projects`,
    squashToken,
    {
      method: 'POST',
      body: JSON.stringify({
        _type: 'project',
        name: name.trim(),
        label,
        description: description?.trim() || '',
      }),
    }
  );
  return { id: data.id, name: data.name };
};

const priorityToImportance = (priority: string): string =>
  ({ high: 'HIGH', medium: 'MEDIUM', low: 'LOW' }[priority] || 'MEDIUM');

export interface PushResult {
  pushed: { id: string; squashId: number; title: string }[];
  blocked: { id: string; title: string; squashId: string }[];
}

export const pushTestCasesToSquash = async (
  squashUrl: string,
  squashToken: string,
  squashProjectId: number,
  tcIds: string[],
  folderName?: string
): Promise<PushResult> => {

  if (!tcIds || tcIds.length === 0) {
    throw new Error('Aucun cas de test sélectionné.');
  }

  // Récupérer les TC sélectionnés depuis la DB
  const placeholders = tcIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rows: cases } = await query(
    `SELECT * FROM test_cases WHERE id IN (${placeholders}) ORDER BY created_at`,
    tcIds
  );

  const toBlock = cases.filter((tc: any) => tc.squash_id);
  const toPush  = cases.filter((tc: any) => !tc.squash_id);

  const blocked = toBlock.map((tc: any) => ({
    id: tc.id, title: tc.title, squashId: tc.squash_id,
  }));

  if (toPush.length === 0) {
    return { pushed: [], blocked };
  }

  // Parent par défaut = le projet directement (Squash l'accepte comme racine)
  let parentId: number = squashProjectId;
  let parentType: string = 'project';

  if (folderName?.trim()) {
    try {
      const folder: any = await squashFetch(
        `${squashUrl}/api/rest/latest/test-case-folders`,
        squashToken,
        {
          method: 'POST',
          body: JSON.stringify({
            _type: 'test-case-folder',
            name: folderName.trim().substring(0, 100),
            parent: { id: squashProjectId, _type: 'project' },
          }),
        }
      );
      parentId = folder.id;
      parentType = 'test-case-folder';
    } catch {
      // Dossier existe peut-être déjà, on continue avec la racine du projet
    }
  }

  const pushed: PushResult['pushed'] = [];

  for (const tc of toPush) {
    const { rows: steps } = await query(
      `SELECT * FROM test_steps WHERE test_case_id = $1 ORDER BY step_order`,
      [tc.id]
    );

    const squashTc: any = await squashFetch(
      `${squashUrl}/api/rest/latest/test-cases`,
      squashToken,
      {
        method: 'POST',
        body: JSON.stringify({
          _type: 'test-case',
          name: tc.title,
          importance: priorityToImportance(tc.priority),
          status: 'WORK_IN_PROGRESS',
          prerequisite: tc.preconditions || '',
          parent: { id: parentId, _type: parentType },
        }),
      }
    );

    for (const step of steps) {
      await squashFetch(
        `${squashUrl}/api/rest/latest/test-cases/${squashTc.id}/steps`,
        squashToken,
        {
          method: 'POST',
          body: JSON.stringify({
            _type: 'action-step',
            action: step.action || '',
            expected_result: step.expected_result || '',
          }),
        }
      ).catch(() => {});
    }

    await query(`UPDATE test_cases SET squash_id = $1 WHERE id = $2`, [
      String(squashTc.id), tc.id,
    ]);

    pushed.push({ id: tc.id, squashId: squashTc.id, title: tc.title });
  }

  return { pushed, blocked };
};
