import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("lote30 privado: dedupe, lease, geração individual e revisão concorrente",{timeout:60000},async()=>{
 const db=new PGlite();try{
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(await readFile("drizzle/migrations/0075_b2b_ai_email_drafts.sql","utf8"));
  await db.exec(await readFile("drizzle/migrations/0076_b2b_prospect_campaign_configuration.sql","utf8"));
  const companies=Array.from({length:30},(_,i)=>({key:`fixture${i}`,name:`Empresa fictícia${i}`}));
  const create=async()=> (await db.query<{id:string}>("SELECT create_b2b_ai_email_batch('operation','auto','Teste',$1::jsonb) id",[JSON.stringify(companies)])).rows[0].id;
  const id=await create();assert.equal(await create(),id);
  assert.equal((await db.query("SELECT * FROM b2b_ai_email_items")).rows.length,30);
  await assert.rejects(db.query("SELECT create_b2b_ai_email_batch('31','auto','Teste',$1::jsonb)",[JSON.stringify([...companies,{key:"31"}])]),/invalid_batch/);
  const token="00000000-0000-4000-8000-000000000001";
  const claim=async()=> (await db.query<{ok:boolean}>("SELECT claim_b2b_ai_email_batch($1,$2) ok",[id,token])).rows[0].ok;
  assert.equal(await claim(),true);assert.equal(await claim(),false);
  const rows=(await db.query<{id:string}>("SELECT id FROM b2b_ai_email_items ORDER BY position")).rows;
  for(let i=0;i<rows.length;i++){
   await db.query("UPDATE b2b_ai_email_items SET state='generating' WHERE id=$1",[rows[i].id]);
   assert.equal((await db.query<{ok:boolean}>("SELECT finish_b2b_ai_email_item($1,$2,$3,$4,$5) ok",[id,token,rows[i].id,`Assunto${i}`,`Conteúdo individualizado${i}`])).rows[0].ok,true);
  }
  assert.equal((await db.query("SELECT * FROM b2b_ai_email_items WHERE state='draft'")).rows.length,30);
  assert.equal((await db.query("SELECT DISTINCT subject FROM b2b_ai_email_items")).rows.length,30);
  const review=async(rev:number,approved:boolean)=> (await db.query<{ok:boolean}>("SELECT review_b2b_ai_email($1,$2,'Assunto revisado','Conteúdo revisado individualmente',$3) ok",[rows[0].id,rev,approved])).rows[0].ok;
  assert.equal(await review(2,true),true);assert.equal(await review(2,false),false);assert.equal(await review(3,false),true);
  assert.equal((await db.query<{state:string}>("SELECT state FROM b2b_ai_email_items WHERE id=$1",[rows[0].id])).rows[0].state,"draft");
  for(const role of ["anon","authenticated"]){
   assert.equal((await db.query<{ok:boolean}>("SELECT has_table_privilege($1,'b2b_ai_email_items','SELECT') ok",[role])).rows[0].ok,false);
   assert.equal((await db.query<{ok:boolean}>("SELECT has_function_privilege($1,'create_b2b_ai_email_batch(text,text,text,jsonb)','EXECUTE') ok",[role])).rows[0].ok,false);
  }
  await db.exec("INSERT INTO b2b_ai_email_control VALUES(1,true,'Denied')");
  await assert.rejects(db.query("SELECT create_b2b_ai_email_batch('denied','auto','Teste',$1::jsonb)",[JSON.stringify([companies[0]])]),/provider_denied/);
 }finally{await db.close();}
});