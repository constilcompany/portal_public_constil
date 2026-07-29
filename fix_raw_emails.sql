WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER(PARTITION BY nylas_message_id ORDER BY received_at ASC) as row_num
  FROM raw_emails
)
DELETE FROM raw_emails WHERE id IN (SELECT id FROM duplicates WHERE row_num > 1);

ALTER TABLE raw_emails DROP CONSTRAINT IF EXISTS raw_emails_nylas_message_id_key;
ALTER TABLE raw_emails ADD CONSTRAINT raw_emails_nylas_message_id_key UNIQUE (nylas_message_id);
