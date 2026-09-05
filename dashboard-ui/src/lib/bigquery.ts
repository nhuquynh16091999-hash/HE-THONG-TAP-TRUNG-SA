import { BigQuery } from "@google-cloud/bigquery";
import fs from "fs";
import path from "path";

// Auth resolution order:
//   1. GCP_SA_KEY_JSON env  — inline service-account JSON (Vercel/Render).
//   2. ../bigquery_key.json — service-account key file at repo root (local dev).
//   3. Application Default Credentials — `gcloud auth application-default login`.
const projectId = process.env.NEXT_PUBLIC_BQ_PROJECT || "cty-507710";

function buildClient(): BigQuery {
    const inlineKey = process.env.GCP_SA_KEY_JSON;
    if (inlineKey) {
        try {
            const credentials = JSON.parse(inlineKey);
            return new BigQuery({ projectId, credentials });
        } catch (e) {
            console.error("GCP_SA_KEY_JSON parse failed, fallback file:", e);
        }
    }
    const keyFilename = path.join(process.cwd(), "../bigquery_key.json");
    if (fs.existsSync(keyFilename)) {
        return new BigQuery({ projectId, keyFilename });
    }
    // Fallback: Application Default Credentials (gcloud ADC / GOOGLE_APPLICATION_CREDENTIALS).
    console.warn(`BigQuery: no key file at ${keyFilename}, using Application Default Credentials.`);
    return new BigQuery({ projectId });
}

export const bigquery = buildClient();

export const DATASET = process.env.DATASET || "TALPHA_Dataset";

export async function runQuery(query: string, params?: any[]) {
    try {
        const options = {
            query,
            params,
        };
        const [rows] = await bigquery.query(options);
        return rows;
    } catch (error: any) {
        console.error("BigQuery Error:", error?.message || error);
        console.error("SQL (first 300 chars):", query.substring(0, 300));
        throw new Error("Failed to execute query");
    }
}
