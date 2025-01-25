import { drizzle } from "drizzle-orm/postgres-js";
import createpostgres from "postgres";

import * as schema from "./schema";

const db_url = Bun.env["DATABASE_URL"];
console.log("url: ", db_url);
if (db_url == undefined) throw new Error("DATABASE_URL must be defined");

export const postgres = createpostgres(db_url, { connect_timeout: 5 });
export const db = drizzle(postgres, { schema });

export default db;
