-- Disposable local database only.
BEGIN;
INSERT INTO public.leads(id,name,stage,tags,history,notes) VALUES('00000000-0000-4000-8000-000000009001','Fictício','lead-novo','[]','[]','Anterior');
UPDATE public.leads SET notes='Nova anotação' WHERE id='00000000-0000-4000-8000-000000009001';
DO $$ BEGIN
 IF (SELECT history->0->>'kind' FROM public.leads WHERE id='00000000-0000-4000-8000-000000009001')<>'note' THEN RAISE EXCEPTION 'Note not recorded'; END IF;
END $$;
UPDATE public.leads SET stage='qualificacao' WHERE id='00000000-0000-4000-8000-000000009001';
UPDATE public.leads SET notes=notes WHERE id='00000000-0000-4000-8000-000000009001';
DO $$ BEGIN
 IF (SELECT jsonb_array_length(history) FROM public.leads WHERE id='00000000-0000-4000-8000-000000009001')<>2 THEN RAISE EXCEPTION 'Missing update or duplicated no-op'; END IF;
END $$;
ROLLBACK;