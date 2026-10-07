import { SQL } from "bun";
import step from "/home/user/redlens/scripts/lib/worker-steps/pau.mjs";
const db = new SQL(process.env.DATABASE_URL!);
for (let i = 0; i < 6; i++) {
  console.log(new Date().toISOString().slice(11, 19), await step.run({ db } as never));
  await Bun.sleep(30_000);
}
await db`UPDATE pau_state SET fetched_at = now() - interval '2 hours'`;
console.log(await step.run({ db } as never));
await db.close();
