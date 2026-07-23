UPDATE candidates
SET city = NULL,
    updated_at = now()
WHERE city IS NOT NULL
  AND city !~ '[[:alpha:]ÁÉÍÓÚÜÑáéíóúüñ]';

UPDATE candidates
SET country = NULL,
    updated_at = now()
WHERE country IS NOT NULL
  AND country !~ '[[:alpha:]ÁÉÍÓÚÜÑáéíóúüñ]';

UPDATE candidates
SET "current_role" = NULL,
    updated_at = now()
WHERE "current_role" IS NOT NULL
  AND "current_role" !~ '[[:alpha:]ÁÉÍÓÚÜÑáéíóúüñ]';
