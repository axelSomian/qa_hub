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
