"""Run only against a disposable local socket: python3 <file> /tmp/<db> <port>."""
import concurrent.futures
import pathlib
import subprocess
import sys

socket = pathlib.Path(sys.argv[1]).resolve()
port = int(sys.argv[2])
if not str(socket).startswith("/tmp/") or not 1024 <= port <= 65535:
    raise SystemExit("Disposable local database required")

def sql(statement):
    return subprocess.run(["psql", "-h", str(socket), "-p", str(port), "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement], capture_output=True, text=True, check=True).stdout.strip()

sql("""
INSERT INTO public.gravon_ai_test_settings(id,enabled,authorized_phone,crm_read_enabled,crm_read_instance,crm_read_phone,crm_read_revision,crm_move_enabled,crm_move_instance,crm_move_phone,crm_move_revision,crm_move_authorized_phone)
VALUES(1,true,'5511999998888',true,'fake','5511999998888','r',true,'fake','5511999998888','m','5511999998888');
INSERT INTO public.leads(id,name,company,stage,notes,history) VALUES('00000000-0000-0000-0000-000000000001','Pessoa fictícia','Empresa fictícia','lead-novo','Preservar','[]');
INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','parallel-proposal','Mover Empresa fictícia');
""")
code = sql("SELECT public.gravon_propose_stage_move('fake','5511999998888','r','m','parallel-proposal','company','Empresa fictícia','contato-realizado')->>'code'")
assert len(code) == 32 and all(c in "0123456789ABCDEF" for c in code)

def confirm(i):
    sql(f"INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','parallel-confirm-{i}','CONFIRMAR {code}')")
    return sql(f"SELECT public.gravon_resolve_stage_move('fake','5511999998888','r','m','parallel-confirm-{i}','{code}',false)->>'status'")

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(confirm, range(4)))
assert results == ["moved"] * 4, results
assert sql("SELECT stage||':'||jsonb_array_length(history) FROM public.leads WHERE id='00000000-0000-0000-0000-000000000001'") == "contato-realizado:1"

sql("INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','stale-proposal','Mover Empresa fictícia')")
stale_code = sql("SELECT public.gravon_propose_stage_move('fake','5511999998888','r','m','stale-proposal','company','Empresa fictícia','fechado')->>'code'")
# Separate transaction uses the actual timestamp trigger and monotonic revision.
sql("UPDATE public.leads SET notes='Editado em outra transação' WHERE id='00000000-0000-0000-0000-000000000001'")
sql(f"INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','stale-confirm','CONFIRMAR {stale_code}')")
assert sql(f"SELECT public.gravon_resolve_stage_move('fake','5511999998888','r','m','stale-confirm','{stale_code}',false)->>'status'") == "stale"
assert sql("SELECT stage FROM public.leads WHERE id='00000000-0000-0000-0000-000000000001'") == "contato-realizado"
sql("INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','bare-proposal','Mover Empresa fictícia')")
sql("SELECT public.gravon_propose_stage_move('fake','5511999998888','r','m','bare-proposal','company','Empresa fictícia','qualificacao')")

def bare_confirm(i):
    sql(f"INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','bare-confirm-{i}','Confirmar')")
    return sql(f"SELECT public.gravon_resolve_stage_move('fake','5511999998888','r','m','bare-confirm-{i}','',false)->>'status'")

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    bare_results = list(pool.map(bare_confirm, range(4)))
assert bare_results.count("moved") == 1 and bare_results.count("no_pending") == 3, bare_results
assert sql("SELECT stage||':'||jsonb_array_length(history) FROM public.leads WHERE id='00000000-0000-0000-0000-000000000001'") == "qualificacao:2"
winner = bare_results.index("moved")
sql("INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','after-bare','Mover Empresa fictícia')")
sql("SELECT public.gravon_propose_stage_move('fake','5511999998888','r','m','after-bare','company','Empresa fictícia','fechado')")
assert sql(f"SELECT public.gravon_resolve_stage_move('fake','5511999998888','r','m','bare-confirm-{winner}','',false)->>'status'") == "moved"
assert sql("SELECT stage FROM public.leads WHERE id='00000000-0000-0000-0000-000000000001'") == "qualificacao"
print("Coded and bare concurrent confirmations: one move each; stale edits and replay against a new proposal blocked.")