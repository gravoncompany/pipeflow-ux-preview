import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeGroups } from "./whatsapp-group-snapshot";
describe("essential group snapshots and live permissions", () => {
  it("keeps original g.us identifiers and deduplicates without returning participants", () => {
    const g = {id:"123456@g.us",subject:"Clientes",participants:[{id:"5547999998888@s.whatsapp.net"}]};
    const rows = normalizeGroups([g,g],"5547999998888");
    assert.equal(rows.length,1); assert.equal(rows[0].jid,"123456@g.us");
    assert.equal("participants" in rows[0],false);
  });
  it("allows browsing essentials but never authorizes a send without live membership", () => {
    const list = [{id:"123456@g.us",subject:"Clientes"}];
    assert.equal(normalizeGroups(list,"5547999998888")[0].canPost,true);
    assert.equal(normalizeGroups(list,"5547999998888",true)[0].canPost,false);
  });
  it("blocks announcement groups for non-admins and groups without membership", () => {
    assert.equal(normalizeGroups([{id:"123456@g.us",announce:true,participants:[{id:"5547999998888@s.whatsapp.net"}]}],"5547999998888",true)[0].canPost,false);
    assert.equal(normalizeGroups([{id:"123456@g.us",participants:[]}],"5547999998888",true)[0].canPost,false);
    assert.equal(normalizeGroups([{id:"123456@g.us",announce:true,participants:[{id:"5547999998888@s.whatsapp.net",admin:"admin"}]}],"5547999998888",true)[0].canPost,true);
  });
  it("handles thousands without the old 2000-group truncation", () => {
    assert.equal(normalizeGroups(Array.from({length:3500},(_,i)=>({id:`${100000+i}@g.us`,subject:`Grupo ${i}`})),"").length,3500);
  });
});