UPDATE estimates SET document_url = 'test' WHERE id = (SELECT id FROM estimates LIMIT 1);
