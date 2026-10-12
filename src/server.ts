import { accountOfSession } from "./auth/index.js";
import { bearer, createApi } from "./api/router.js";
import { openDb } from "./db/index.js";
import { seed } from "./db/seed.js";

const db = openDb("ledger.db");
if (!db.prepare("SELECT 1 FROM users").get()) seed(db);

const { SOCLAAS_BASE_URL, SOCLAAS_API_KEY } = process.env;
if (!SOCLAAS_BASE_URL || !SOCLAAS_API_KEY) throw new Error("set SOCLAAS_BASE_URL and SOCLAAS_API_KEY");

createApi(db, (req) => accountOfSession(db, bearer(req)), {
  baseUrl: SOCLAAS_BASE_URL,
  apiKey: SOCLAAS_API_KEY,
  model: "qwen3.8:27b",
}).listen(3000, () => console.log("http://localhost:3000  (alice / bob / alan, password demo1234)"));
