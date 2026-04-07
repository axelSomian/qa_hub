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
  const prompt = `Tu es un expert QA senior certifié ISTQB. Analyse en profondeur cette User Story et génère des cas de test précis et exhaustifs qui couvrent exactement ce qui est demandé.
${istqbBlock}
═══ USER STORY ═══
Titre : ${usTitle}

Description :
${usDescription}
══════════════════

ÉTAPE 1 — Analyse la US et identifie :
- Les acteurs impliqués (qui fait quoi)
- Les règles métier explicites et implicites
- Les critères d'acceptation (exprimés ou à déduire)
- Les partitions d'équivalence (valeurs valides et invalides) pour chaque champ/donnée
- Les valeurs limites (min, max, min-1, max+1) sur les champs numériques ou ordonnés
- Les combinaisons de conditions (règles métier à modéliser en table de décision si besoin)
- Les transitions d'état possibles du système
- Les flux principaux et les flux alternatifs

ÉTAPE 2 — Génère entre 4 et 8 cas de test en appliquant les techniques ISTQB :
- Au moins 1 cas "happy path" (partition valide, valeur nominale)
- Au moins 1 cas de valeurs limites (boundary value analysis : valeur à la limite, juste en dessous, juste au dessus)
- Au moins 1 cas de partition invalide (données incorrectes / rejetées)
- Au moins 1 cas couvrant une combinaison de conditions métier (table de décision)
- Si des transitions d'état existent : au moins 1 cas couvrant une transition valide et une invalide
- Titres spécifiques au métier (pas génériques comme "Test nominal")
- Préconditions concrètes (état du système, données existantes, rôle connecté)
- Entre 5 et 10 étapes par cas (navigation, saisie, validation, vérification)
- Étapes formulées avec les vrais éléments de la US (noms de champs, valeurs exactes)
- Résultats attendus vérifiables (message exact, état attendu, donnée en base)

Réponds UNIQUEMENT avec un tableau JSON valide (sans markdown, sans \`\`\`) :
[
  {
    "title": "Titre métier précis du cas de test",
    "preconditions": "État concret du système avant le test (données, rôle, contexte)",
    "priority": "high|medium|low",
    "steps": [
      {
        "action": "Action précise avec les vraies valeurs / champs de la US",
        "expected": "Résultat vérifiable : message, état, données, comportement attendu"
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
  const prompt = `Tu es un expert QA senior certifié ISTQB. Génère UN SEUL cas de test précis et complet basé sur le critère suivant.
${istqbBlock}
═══ USER STORY ═══
Titre : ${usTitle}
Description : ${usDescription}
══════════════════

═══ CRITÈRE SPÉCIFIQUE À TESTER ═══
${criteria}
════════════════════════════════════

Génère exactement 1 cas de test en appliquant la technique ISTQB la plus adaptée au critère (partition d'équivalence, valeur limite, table de décision, transition d'état, estimation d'erreur) :
- Titre précis indiquant la technique utilisée et le critère testé
- Préconditions concrètes (état du système, données, rôle)
- Entre 4 et 8 étapes détaillées (actions exactes + résultats vérifiables)
- Priorité adaptée à l'importance du critère

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
