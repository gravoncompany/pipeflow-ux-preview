ALTER TABLE public.meta_capi_settings DROP CONSTRAINT IF EXISTS meta_capi_settings_last_check_status_check;
ALTER TABLE public.meta_capi_settings ADD CONSTRAINT meta_capi_settings_last_check_status_check
  CHECK (last_check_status IS NULL OR last_check_status IN ('ok','failed','limited'));
COMMENT ON COLUMN public.meta_capi_settings.last_check_status IS 'ok = Meta returned the Pixel to this token; limited = token valid but the Pixel cannot be read with it (typical Events Manager Conversions API token), access confirmed only by an accepted test event; failed = rejected.';