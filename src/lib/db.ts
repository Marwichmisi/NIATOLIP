// Accès base Postgres (service `db` du docker-compose, M1-1b).
// Utilisé uniquement quand DATABASE_URL est posée ; sinon le stockage
// local par fichiers JSON prend le relais (voir projects.ts).
// Serveur uniquement : jamais importé depuis un composant client.
import { Pool } from "pg";
import type { PoolClient } from "pg";

export type { PoolClient };

if (typeof window !== "undefined") {
  throw new Error("db.ts est serveur-uniquement (DATABASE_URL ne doit jamais fuir au navigateur).");
}

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;

export function isPgConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL manquante (service db non configuré).");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

const SCHEMA_SQL = `
create table if not exists users (
  id text primary key,
  email text,
  created_at timestamptz not null default now()
);
create table if not exists projects (
  id text primary key,
  user_id text not null default 'local',
  name text not null,
  working_files jsonb not null default '{}',
  current_version_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists project_versions (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  version_no integer not null,
  label text not null default '',
  created_from_run_id text,
  created_at timestamptz not null default now(),
  unique (project_id, version_no)
);
create table if not exists project_files (
  version_id text not null references project_versions(id) on delete cascade,
  path text not null,
  content text not null,
  content_hash text not null,
  primary key (version_id, path)
);
create table if not exists conversations (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists messages (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  role text not null,
  ui_message_json jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_versions_project on project_versions(project_id, version_no);
create index if not exists idx_messages_conv on messages(conversation_id, created_at, id);
`;

/** Crée les tables au premier usage (idempotent, une seule fois par process). */
export function initSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await getPool().query(SCHEMA_SQL);
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}
