-- backup-dryrun.sql — the stand-in "production" for the dry run of deploy/backup.sh (api backup-restore.yml).
-- Only the five key tables, shaped like Supabase's: RLS on, a policy naming `authenticated`, a default from extensions.*.
-- Run after `backup.sh prepare` on the source database. Never against a real database.
CREATE TABLE public.identities (id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(), user_id text NOT NULL, country text);
ALTER TABLE public.identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY identities_self ON public.identities TO authenticated USING (true);
CREATE TABLE public.chit_header (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_id uuid REFERENCES public.identities(id), total_minor bigint);
CREATE TABLE public.journal_entry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chit_id uuid REFERENCES public.chit_header(id), amount_minor bigint);
CREATE TABLE public.catalogue_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.books_setting (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text, value jsonb);
INSERT INTO public.identities (user_id, country) SELECT 'dry-run-' || g, 'IN' FROM generate_series(1, 3) g;
INSERT INTO public.chit_header (identity_id, total_minor) SELECT id, 10000 FROM public.identities;
INSERT INTO public.journal_entry (chit_id, amount_minor) SELECT id, 10000 FROM public.chit_header;
INSERT INTO public.catalogue_items (name) VALUES ('tea'), ('rice');
INSERT INTO public.books_setting (key, value) VALUES ('fy_start', '"04"');
