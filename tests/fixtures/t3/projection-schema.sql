create table projection_projects (
  project_id text primary key,
  title text not null,
  workspace_root text not null,
  scripts_json text not null,
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  default_model_selection_json text
);

create table projection_threads (
  thread_id text primary key,
  project_id text not null,
  title text not null,
  branch text,
  worktree_path text,
  latest_turn_id text,
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  runtime_mode text not null default 'full-access',
  interaction_mode text not null default 'default',
  model_selection_json text,
  archived_at text,
  latest_user_message_at text,
  pending_approval_count integer not null default 0,
  pending_user_input_count integer not null default 0,
  has_actionable_proposed_plan integer not null default 0
);

create table projection_thread_messages (
  message_id text primary key,
  thread_id text not null,
  turn_id text,
  role text not null,
  text text not null,
  is_streaming integer not null,
  created_at text not null,
  updated_at text not null,
  attachments_json text
);

create table projection_turns (
  row_id integer primary key,
  thread_id text not null,
  turn_id text,
  pending_message_id text,
  assistant_message_id text,
  state text not null,
  requested_at text not null,
  started_at text,
  completed_at text,
  checkpoint_turn_count integer,
  checkpoint_ref text,
  checkpoint_status text,
  checkpoint_files_json text not null,
  source_proposed_plan_thread_id text,
  source_proposed_plan_id text
);

create table projection_thread_sessions (
  thread_id text primary key,
  status text not null,
  provider_name text,
  provider_session_id text,
  provider_thread_id text,
  active_turn_id text,
  last_error text,
  updated_at text not null,
  runtime_mode text not null default 'full-access',
  provider_instance_id text
);
