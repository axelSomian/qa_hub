-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Workspaces (configurations de connexion)
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  openproject_url TEXT,
  openproject_token TEXT,
  squash_url TEXT,
  squash_token TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cas de test
CREATE TABLE IF NOT EXISTS test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  us_id VARCHAR(100),
  us_title TEXT,
  squash_id VARCHAR(100),
  title TEXT NOT NULL,
  preconditions TEXT,
  priority VARCHAR(20) DEFAULT 'medium',
  status VARCHAR(20) DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Étapes d'un cas de test
CREATE TABLE IF NOT EXISTS test_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id UUID REFERENCES test_cases(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  action TEXT NOT NULL,
  expected_result TEXT NOT NULL
);

-- Sessions d'exécution (regroupe plusieurs CTs)
CREATE TABLE IF NOT EXISTS execution_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200),
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'in_progress',
  squash_campaign_id VARCHAR(100),
  notes TEXT
);

-- Exécutions
CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES execution_sessions(id) ON DELETE CASCADE,
  test_case_id UUID REFERENCES test_cases(id) ON DELETE CASCADE,
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  executed_at TIMESTAMP DEFAULT NOW(),
  global_status VARCHAR(20) DEFAULT 'pending',
  squash_execution_id VARCHAR(100),
  squash_test_plan_item_id VARCHAR(100),
  notes TEXT
);

-- Étapes d'exécution
CREATE TABLE IF NOT EXISTS execution_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES executions(id) ON DELETE CASCADE,
  step_id UUID REFERENCES test_steps(id),
  status VARCHAR(20),
  comment TEXT,
  screenshot_url TEXT,
  squash_execution_step_id VARCHAR(100),
  executed_at TIMESTAMP DEFAULT NOW()
);