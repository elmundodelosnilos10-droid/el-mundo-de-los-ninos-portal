/** Synthetic guard unit tests; these do not prove provider delivery. */
import assert from "node:assert/strict";
import test from "node:test";
import { assertPristineDatabase } from "./realtime-local/run.mjs";

function syntheticCatalog({dirtyTable, identities=0, objects=0}={}) {
  const inspected=[];
  const sql=async (strings,...values)=>{
    if(typeof strings==="string")return {schema:strings.split(".")[0],name:strings.split(".")[1]};
    const text=strings.join("?");
    if(text.includes("as rows from")){
      const table=await values[0];
      assert.equal(table.schema,"public");inspected.push(table.name);
      return [{rows:table.name===dirtyTable?1:0}];
    }
    if(text.includes("auth.identities"))return [{identities,objects}];
    if(text.includes("current_database"))return [{users:0,profiles:0,students:0,years:0,settings:0,messages:0,notifications:0,conversations:0,roles:0,database:"postgres",version:"170011"}];
    if(text.includes("pg_publication_namespace"))return [{pubinsert:true,pubupdate:true,pubdelete:false,pubtruncate:false,puballtables:false,schemas:0}];
    if(text.includes("pg_publication_tables"))return ["communication_settings","messages","notifications"].map(tablename=>({schemaname:"public",tablename}));
    throw Error("Unexpected synthetic query");
  };
  return {sql,inspected};
}
test("synthetic pristine guard inspects all 33 school tables and private data",async()=>{
  const fixture=syntheticCatalog();assert.equal(await assertPristineDatabase(fixture.sql),"170011");
  assert.equal(new Set(fixture.inspected).size,33);
  assert.ok(fixture.inspected.includes("school_account_invitation_provisions"));
});
test("synthetic pristine guard rejects leftover non-Realtime tables, Auth identities and Storage objects",async()=>{
  for(const configuration of [{dirtyTable:"files"},{dirtyTable:"school_account_invitation_provisions"},{identities:1},{objects:1}]){
    await assert.rejects(assertPristineDatabase(syntheticCatalog(configuration).sql),error=>["local_database_not_pristine","local_private_data_not_pristine"].includes(error.code));
  }
});
