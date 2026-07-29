SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'estimates';
