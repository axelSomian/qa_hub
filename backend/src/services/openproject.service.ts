import fetch from 'node-fetch';

const getHeaders = (token: string) => ({
  'Authorization': `Basic ${Buffer.from(`apikey:${token}`).toString('base64')}`,
  'Content-Type': 'application/json',
});

// Récupérer tous les projets
export const getProjects = async (baseUrl: string, token: string) => {
  const res = await fetch(`${baseUrl}/api/v3/projects`, {
    headers: getHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`OpenProject error: ${res.status} ${res.statusText}`);
  }

  const data: any = await res.json();
  return data._embedded.elements.map((p: any) => ({
    id: p.id,
    name: p.name,
    identifier: p.identifier,
  }));
};

// Récupérer toutes les User Stories d'un projet (pagination automatique)
export const getUserStories = async (
    baseUrl: string,
    token: string,
    projectId: string
  ) => {
    const PAGE_SIZE = 100;
    let page = 1;
    let total = Infinity;
    const all: any[] = [];

    while (all.length < total) {
      const filters = encodeURIComponent(JSON.stringify([{ type_id: { operator: '=', values: ['6', '7'] } }]));
      const res = await fetch(
        `${baseUrl}/api/v3/projects/${projectId}/work_packages?pageSize=${PAGE_SIZE}&page=${page}&filters=${filters}`,
        { headers: getHeaders(token) }
      );

      if (!res.ok) {
        throw new Error(`OpenProject error: ${res.status} ${res.statusText}`);
      }

      const data: any = await res.json();
      total = data.total ?? 0;
      const elements: any[] = data._embedded?.elements ?? [];
      all.push(...elements);

      if (elements.length < PAGE_SIZE) break;
      page++;
    }

    return all.map((us: any) => ({
      id: us.id,
      subject: us.subject,
      description: us.description?.raw || '',
      status: us._links?.status?.title || '',
      priority: us._links?.priority?.title || '',
      type: us._links?.type?.title || '',
      assignee: us._links?.assignee?.title || null,
    }));
  };

// Convertit un nombre décimal d'heures en durée ISO 8601 (ex: 2.5 → "PT2H30M")
const hoursToIso = (hours: number): string => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `PT${h}H${m}M` : `PT${h}H`;
};

const priorityLabelMap: Record<string, string> = {
  high:   'Haute',
  medium: 'Normale',
  low:    'Basse',
};

// IDs priorités OpenProject : 7=Low, 8=Normal, 9=High
const priorityHrefMap: Record<string, string> = {
  high:   '/api/v3/priorities/9',
  medium: '/api/v3/priorities/8',
  low:    '/api/v3/priorities/7',
};

// Créer une tâche "Test Execution" dans OpenProject liée à une US
export const createOpTask = async (
  baseUrl: string,
  token: string,
  projectId: number,
  usId: number,
  usTitle: string,
  priority: string = 'medium',
  estimatedHours?: number,
  assigneeId?: number
): Promise<{ id: number; subject: string; url: string }> => {
  const body: any = {
    subject: `Test Execution — ${usTitle}`,
    description: { raw: `Criticité : ${priorityLabelMap[priority] || 'Normale'}` },
    percentageDone: 100,
    estimatedTime: estimatedHours ? hoursToIso(estimatedHours) : undefined,
    _links: {
      project:  { href: `/api/v3/projects/${projectId}` },
      type:     { href: '/api/v3/types/1' },
      parent:   { href: `/api/v3/work_packages/${usId}` },
      status:   { href: '/api/v3/statuses/7' },
      priority: { href: priorityHrefMap[priority] || '/api/v3/priorities/8' },
      ...(assigneeId ? { assignee: { href: `/api/v3/users/${assigneeId}` } } : {}),
    },
  };
  if (!body.estimatedTime) delete body.estimatedTime;

  const res = await fetch(`${baseUrl}/api/v3/work_packages`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.message || `OpenProject WP error ${res.status}`);
  return {
    id: data.id,
    subject: data.subject,
    url: `${baseUrl}/work_packages/${data.id}`,
  };
};

// Loguer le temps passé sur un work package
export const createTimeEntry = async (
  baseUrl: string,
  token: string,
  projectId: number,
  workPackageId: number,
  hours: number,
  comment: string
): Promise<{ id: number; hours: string }> => {
  const today = new Date().toISOString().split('T')[0];
  const res = await fetch(`${baseUrl}/api/v3/time_entries`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({
      hours: hoursToIso(hours),
      spentOn: today,
      comment: { raw: comment },
      _links: {
        workPackage: { href: `/api/v3/work_packages/${workPackageId}` },
        project:     { href: `/api/v3/projects/${projectId}` },
      },
    }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.message || `OpenProject TimeEntry error ${res.status}`);
  return { id: data.id, hours: data.hours };
};

// Ajouter un commentaire sur un work package
export const addComment = async (
  baseUrl: string,
  token: string,
  workPackageId: number,
  comment: string
): Promise<{ id: number }> => {
  const res = await fetch(`${baseUrl}/api/v3/work_packages/${workPackageId}/activities`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ comment: { raw: comment } }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.message || `OpenProject Activity error ${res.status}`);
  return { id: data.id };
};

// Tester la connexion
export const testConnection = async (baseUrl: string, token: string) => {
  const res = await fetch(`${baseUrl}/api/v3/users/me`, {
    headers: getHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Connexion échouée: ${res.status} ${res.statusText}`);
  }

  const user: any = await res.json();
  return {
    connected: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  };
};