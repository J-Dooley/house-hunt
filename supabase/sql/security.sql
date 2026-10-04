-- Existing automatic-RLS event trigger is internal, not a client RPC.
revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
