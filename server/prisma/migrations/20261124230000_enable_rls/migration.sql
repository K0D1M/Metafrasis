-- Κλείδωμα του schema public απέναντι στο Data API (PostgREST) του Supabase.
--
-- Το app μιλά με τη βάση μόνο μέσω Prisma, ως ο ρόλος που κατέχει τους πίνακες.
-- Ο κάτοχος ενός πίνακα παρακάμπτει το RLS (δεν χρησιμοποιούμε FORCE), οπότε το app
-- δουλεύει όπως πριν. Οι ρόλοι anon/authenticated του Supabase δεν έχουν πολιτικές,
-- άρα δεν βλέπουν ούτε μία γραμμή.

-- 1. RLS σε κάθε υπάρχοντα πίνακα του public, μαζί με το _prisma_migrations.
--    Χωρίς πολιτικές: deny-all για όποιον δεν είναι κάτοχος ή BYPASSRLS.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END
$$;

-- 2. Αφαίρεση δικαιωμάτων των anon/authenticated (δεύτερο επίπεδο άμυνας) και
--    ακύρωση των default privileges ώστε κάθε μελλοντικός πίνακας, sequence ή
--    function που φτιάχνει ο ρόλος των migrations να μη δίνεται αυτόματα στο Data API.
--    Οι ρόλοι υπάρχουν μόνο στο Supabase, οπότε σε απλή Postgres το βήμα παραλείπεται.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END
$$;
