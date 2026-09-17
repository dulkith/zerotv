import { MongoClient, Db, Collection, Document } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://modayaka:38PbAS5b4YbtA4oq@cluster0.z2evkj5.mongodb.net/?appName=Cluster0";
const DB_NAME = process.env.MONGODB_DB || "lankatv";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  await db.command({ ping: 1 });
  console.log("[mongo] connected to", DB_NAME);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error("MongoDB not connected — call connectMongo() first");
  return db;
}

export function col(name: string): Collection<Document> {
  return getDb().collection(name);
}

export async function closeMongo(): Promise<void> {
  if (client) { await client.close(); client = null; db = null; }
}
