import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

export interface TestStep {
  action: string;
  expected: string;
}

export interface TestCase {
  title: string;
  preconditions: string;
  priority: 'low' | 'medium' | 'high';
  steps: TestStep[];
}

const GROQ_URL = `https://api.groq.com/openai/v1/chat/completions`;

// Load ISTQB CTFL v4.0 test design techniques once at startup
// Source: backend/ressources/ISTQB_CTFL_Syllabus.md — sections 4.2, 4.3, 4.4
const loadIstqbGuidelines = (): string => {
  try {
    const filePath = path.join(__dirname, '../../ressources/ISTQB_CTFL_Syllabus.md');
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    // Extract sections 4.2 (boîte noire), 4.3 (boîte blanche overview), 4.4 (basées sur l'expérience)
    // Lines identified: 4.2 starts ~3091, 4.4 ends ~3519
    const relevant = lines.slice(3090, 3519).join('\n');
    // Strip page markers and blank-line clusters to reduce token usage
    return relevant
      .replace(/v4\.0\s*\n[\s\S]*?© International Software Testing Qualifications Board\s*\n/g, '')
      .replace(/Testeur certifié\s*\nNiveau Fondation\s*\n/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return '';
  }
};

const ISTQB_GUIDELINES = loadIstqbGuidelines();

const callGroq = async (prompt: string): Promise<string> => {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const err: any = await res.json();
    throw new Error(`Groq API error: ${err?.error?.message || res.statusText}`);
  }
  const data: any = await res.json();
  return data.choices[0].message.content.trim();
};

const parseJson = (content: string): any => {
  try { return JSON.parse(content); }
  catch { return JSON.parse(content.replace(/```json|```/g, '').trim()); }
};

const istqbBlock = ISTQB_GUIDELINES
  ? `\n═══ RÉFÉRENTIEL ISTQB CTFL v4.0 — TECHNIQUES DE CONCEPTION ═══\nApplique obligatoirement les techniques suivantes lors de la génération :\n${ISTQB_GUIDELINES}\n═══════════════════════════════════════════════════════════════\n`
  : '';

export const generateTestCases = async (
  usTitle: string,
  usDescription: string
): Promise<TestCase[]> => {
  const prompt = `Tu es un expert QA senior certifié ISTQB. Ton rôle est de générer des cas de test IMPACTANTS, RÉALISTES et PARFAITEMENT ADAPTÉS à la User Story fournie.
${istqbBlock}
═══ USER STORY ═══
Titre : ${usTitle}

Description :
${usDescription}
══════════════════

ÉTAPE 1 — Analyse la nature de cette US et identifie UNIQUEMENT ce qui s'y applique :
- Quel est le type fonctionnel ? (formulaire, import/export, workflow, consultation, calcul, authentification, etc.)
- Quels sont les risques métier réels si cette fonctionnalité dysfonctionne ?
- Quels sont les critères d'acceptation explicites et implicites ?
- Quels acteurs/rôles sont concernés ?
- Y a-t-il des données saisies par l'utilisateur ? Si oui, lesquelles ?
- Y a-t-il des valeurs numériques avec des bornes définies ? (seulement si applicable)
- Y a-t-il des transitions d'état ? (brouillon → validé, etc.) (seulement si applicable)
- Y a-t-il des combinaisons de conditions métier ? (seulement si applicable)

ÉTAPE 2 — Sélectionne UNIQUEMENT les techniques ISTQB pertinentes pour CETTE US :
▸ Partition d'équivalence → si des données valides/invalides peuvent être saisies
▸ Valeurs limites → SEULEMENT s'il y a des champs numériques ou des bornes explicites
▸ Table de décision → SEULEMENT si plusieurs conditions métier se combinent
▸ Transition d'état → SEULEMENT si un objet change de statut
▸ Cas d'usage / scénario → toujours applicable (flux nominal + alternatifs)
▸ Test d'erreur / robustesse → si des cas d'échec métier sont mentionnés
NE JAMAIS forcer une technique qui ne correspond pas à la nature de la US.

ÉTAPE 3 — Génère entre 4 et 8 cas de test selon ces règles absolues :
- Chaque CT doit couvrir un risque métier RÉEL et DISTINCT
- Le titre doit décrire précisément le scénario (jamais "Test nominal" ou "Cas limite")
- Les préconditions décrivent l'état concret du système (données, rôle, contexte exact)
- Les étapes utilisent les vrais noms de champs, valeurs et libellés de la US
- Chaque résultat attendu est vérifiable (message précis, état visible, donnée en base)
- La priorité reflète l'impact métier réel : high = bloquant, medium = important, low = mineur

Réponds UNIQUEMENT avec un tableau JSON valide (sans markdown, sans \`\`\`) :
[
  {
    "title": "Titre métier précis du scénario testé",
    "preconditions": "État concret du système avant le test",
    "priority": "high|medium|low",
    "steps": [
      {
        "action": "Action précise avec les vraies valeurs / champs de la US",
        "expected": "Résultat vérifiable : message, état, données, comportement"
      }
    ]
  }
]`;

  return parseJson(await callGroq(prompt));
};

export const generateSpecificTestCase = async (
  usTitle: string,
  usDescription: string,
  criteria: string
): Promise<TestCase> => {
  const prompt = `Tu es un expert QA senior certifié ISTQB. Génère UN SEUL cas de test précis, réaliste et impactant basé sur le critère spécifique fourni.
${istqbBlock}
═══ USER STORY ═══
Titre : ${usTitle}
Description : ${usDescription}
══════════════════

═══ CRITÈRE SPÉCIFIQUE À TESTER ═══
${criteria}
════════════════════════════════════

Analyse d'abord si une technique ISTQB s'applique naturellement à ce critère :
- Partition d'équivalence → si des données valides/invalides sont concernées
- Valeur limite → SEULEMENT si le critère mentionne des bornes numériques explicites
- Table de décision → si plusieurs conditions se combinent
- Transition d'état → si un statut change
- Scénario fonctionnel → si c'est un flux métier à couvrir
Applique la technique la plus pertinente, ou aucune si le critère est purement fonctionnel.

Génère exactement 1 cas de test avec :
- Titre décrivant précisément le scénario (pas "Test critère X")
- Préconditions concrètes (état du système, données existantes, rôle)
- Entre 4 et 8 étapes avec actions exactes et résultats vérifiables
- Priorité reflétant l'impact métier réel

Réponds UNIQUEMENT avec un objet JSON valide (sans tableau, sans markdown) :
{
  "title": "Titre spécifique du cas de test",
  "preconditions": "Préconditions concrètes",
  "priority": "high|medium|low",
  "steps": [
    { "action": "Action précise", "expected": "Résultat vérifiable" }
  ]
}`;

  return parseJson(await callGroq(prompt));
};
