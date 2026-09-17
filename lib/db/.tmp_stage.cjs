const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
(async () => {
  const r = await pool.query("update cases set stage_index = 3, stage_started_at = now() where id = 9 returning id, stage_index");
  console.log(JSON.stringify(r.rows));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
