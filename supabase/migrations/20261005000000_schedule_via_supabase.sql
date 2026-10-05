-- Run the GitHub jobs on time, from Supabase.
--
-- GitHub starts scheduled workflows late when it's busy, sometimes hours late,
-- which can make a "1 hour to the deadline" reminder arrive after the deadline.
-- Jobs started on demand (workflow_dispatch) aren't held back like that, so
-- Supabase's own scheduler (pg_cron) asks GitHub to start them instead:
--   alerts.yml  every 15 minutes
--   fetch.yml   every 3 hours
-- The GitHub schedules stay in place as a backup. Two runs at once can't
-- happen (each workflow has a concurrency group), and alerts never send the
-- same notification twice.
--
-- Needs a GitHub token kept in Supabase Vault under the name
-- 'github_dispatch_token' (see README, "Running the jobs on time"). Until it's
-- there, the scheduled calls do nothing but log a warning.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Kept out of the public schema so the website's API can never call it.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.dispatch_workflow(workflow text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  if workflow !~ '^[a-z0-9_-]+\.yml$' then
    raise exception 'not a workflow file name: %', workflow;
  end if;

  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'github_dispatch_token'
  limit 1;

  if token is null or token = '' then
    raise warning 'github_dispatch_token is not in Vault yet; % not started', workflow;
    return null;
  end if;

  -- GitHub answers 204 when the run is queued. The reply lands in
  -- net._http_response (kept for 6 hours).
  return net.http_post(
    url := 'https://api.github.com/repos/wellingtonmapise/FPL-Raptor/actions/workflows/' || workflow || '/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'fpl-raptor-scheduler',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'main'),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function private.dispatch_workflow(text) from public, anon, authenticated;

-- Scheduling by name replaces an existing job of the same name, so running
-- this file again is safe.
select cron.schedule('fpl-raptor-alerts', '7,22,37,52 * * * *', $$select private.dispatch_workflow('alerts.yml')$$);
select cron.schedule('fpl-raptor-fetch', '17 */3 * * *', $$select private.dispatch_workflow('fetch.yml')$$);

-- Keep the cron history from growing forever: clear entries older than a week, daily.
select cron.schedule(
  'fpl-raptor-tidy-cron-history',
  '41 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
