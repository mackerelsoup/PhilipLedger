import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

export type Db = Database.Database;

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/** Opens a SQLite db (in-memory by default) with the schema applied. */
export function openDb(path = ":memory:"): Db {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  const hasSchema = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get();
  if (!hasSchema) db.exec(schema);
  return db;
}
