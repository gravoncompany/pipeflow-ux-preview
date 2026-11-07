import { createFileRoute } from '@tanstack/react-router';

export const Route=createFileRoute('/api/public/jobs/hypercash-sync')({server:{handlers:{POST:async({request})=>{
  // Same internal scheduler credential as the existing private scheduled-reader jobs.
  const secret=process.env['PORTAL_ADS_SYNC_SECRET'];const received=request.headers.get('authorization')??'';const expected=secret?`Bearer ${secret}`:'';
  let diff=received.length^expected.length;for(let i=0;i<expected.length;i++)diff|=received.charCodeAt(i)^expected.charCodeAt(i);
  if(!secret||diff!==0)return Response.json({error:'Unauthorized'},{status:401});
  try{
    const {supabaseAdmin:db}=await import('@/integrations/supabase/client.server');
    const {data,error}=await db.from('crm_external_integrations').select('auto_sync,status').eq('provider','hypercash').maybeSingle();
    if(error)throw new Error('configuration');
    if(!data?.auto_sync||data.status!=='ativa')return Response.json({ok:true,skipped:true});
    const {runHypercashSync}=await import('@/lib/hypercash.server');
    const result=await runHypercashSync(async()=>{const current=await db.from('crm_external_integrations').select('auto_sync,status').eq('provider','hypercash').single();if(current.error||!current.data.auto_sync||current.data.status!=='ativa')throw new Error('Sync desativada.');});
    return Response.json(result);
  }catch{return Response.json({error:'Sync unavailable'},{status:503});}
}}}});