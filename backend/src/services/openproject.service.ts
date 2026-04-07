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

// Récupérer les User Stories d'un projet
export const getUserStories = async (
    baseUrl: string,
    token: string,
    projectId: string
  ) => {
    const res = await fetch(
      `${baseUrl}/api/v3/projects/${projectId}/work_packages?pageSize=100`,
      { headers: getHeaders(token) }
    );
  
    if (!res.ok) {
      throw new Error(`OpenProject error: ${res.status} ${res.statusText}`);
    }
  
    const data: any = await res.json();
  
    // Filtre uniquement les "User story"
    return data._embedded.elements
     
      .map((us: any) => ({
        id: us.id,
        subject: us.subject,
        description: us.description?.raw || '',
        status: us._links?.status?.title || '',
        priority: us._links?.priority?.title || '',
        type: us._links?.type?.title || '',
        assignee: us._links?.assignee?.title || null,
      }));
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
      name: user.name,
      email: user.email,
    },
  };
};