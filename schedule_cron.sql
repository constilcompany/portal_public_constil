CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'process-estimate-followups-hourly', 
  '0 * * * *', 
  $$
    SELECT net.http_post(
        url:=current_setting('app.settings.supabase_url', true) || '/functions/v1/process-estimate-followups',
        headers:=jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true)
        )
    ) as request_id;
  $$
);
