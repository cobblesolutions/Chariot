const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
(async () => {
  for (const t of ["case_requirements","case_stress_tests","lender_offer_reviews"]) {
    const r = await pool.query("select indexname, indexdef from pg_indexes where tablename = $1", [t]);
    console.log(t, JSON.stringify(r.rows.map(x => x.indexdef.replace(/CREATE (UNIQUE )?INDEX /,'').replace(' ON public.'+t+' USING btree','').replace('  ',' '))));
    const c = await pool.query("select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid = $1::regclass and contype='u'", [t]);
    console.log("  unique constraints:", JSON.stringify(c.rows));
  }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
