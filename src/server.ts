import { accountOfSession } from "./auth/index.js";
import { bearer, createApi } from "./api/router.js";
import { openDb } from "./db/index.js";
import { seed } from "./db/seed.js";

const db = openDb("ledger.db");
if (!db.prepare("SELECT 1 FROM users").get()) seed(db);

const { LLM_BASE_URL, LLM_API_KEY } = process.env;
if (!LLM_BASE_URL || !LLM_API_KEY) throw new Error("set LLM_BASE_URL and LLM_API_KEY");

createApi(db, (req) => accountOfSession(db, bearer(req)), {
  baseUrl: LLM_BASE_URL,
  apiKey: LLM_API_KEY,
  model: "qwen3.8:27b",
}).listen(3000, () => console.log("http://localhost:3000  (alice / bob / alan, password demo1234)"));
