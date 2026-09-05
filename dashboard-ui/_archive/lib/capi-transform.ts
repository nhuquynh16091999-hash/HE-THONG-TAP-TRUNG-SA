/**
 * CAPI Transform — SHA256 hashing and normalization for Meta Conversions API.
 *
 * TypeScript port of faos_brain/workflows/capi_transform.py
 * Used by /api/stramark/capi-push to push Purchase events to Meta.
 *
 * Deduplication: event_id = order_id (Meta dedup with browser pixel).
 */

import { createHash } from "crypto";

// ═══ SHA256 Hash Helpers ═══

/**
 * SHA256 hash a single field per Meta CAPI requirements.
 * Rules: trim whitespace, lowercase, SHA256 hex digest.
 */
export function hashField(value: string | null | undefined): string | null {
    if (!value || !value.trim()) return null;
    const cleaned = value.trim().toLowerCase();
    return createHash("sha256").update(cleaned, "utf-8").digest("hex");
}

/**
 * Normalize phone number for Meta CAPI hashing.
 * Remove non-digit chars. Romanian numbers (0XXXXXXXXX) → prefix with 40.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
    if (!phone || !phone.trim()) return null;
    let digits = phone.trim().replace(/\D/g, "");
    if (!digits) return null;

    // Romanian numbers: remove leading 0, prefix with 40
    if (digits.startsWith("0") && digits.length === 10) {
        digits = "40" + digits.slice(1);
    }

    return createHash("sha256").update(digits, "utf-8").digest("hex");
}

/**
 * Remove diacritics from text (s→s, t→t, a→a, a→a, i→i).
 */
export function removeDiacritics(text: string): string {
    return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

// ═══ User Data Hashing ═══

export interface OrderData {
    order_id: string;
    order_date?: string;
    event_time?: number;
    customer_phone?: string;
    customer_email?: string;
    customer_name?: string;
    customer_city?: string;
    customer_country_code?: string;
    value: number;
    currency: string;
    content_ids?: string[];
    num_items?: number;
}

/**
 * Build hashed user_data object per Meta CAPI spec.
 * All PII fields are SHA256-hashed. Phone has special normalization.
 */
export function hashUserData(order: OrderData): Record<string, any> {
    // Split customer_name into first/last
    const nameParts = (order.customer_name || "").trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

    // City: remove diacritics before hashing
    const city = removeDiacritics(order.customer_city || "");

    // Country: ISO 2-letter lowercase
    const country = (order.customer_country_code || "").trim().toLowerCase();

    const userData: Record<string, any> = {};

    const em = hashField(order.customer_email);
    if (em) userData.em = [em];

    const ph = normalizePhone(order.customer_phone);
    if (ph) userData.ph = [ph];

    const fn = hashField(firstName);
    if (fn) userData.fn = [fn];

    const ln = hashField(lastName);
    if (ln) userData.ln = [ln];

    const ct = hashField(city);
    if (ct) userData.ct = [ct];

    const co = hashField(country);
    if (co) userData.country = [co];

    // External ID = order_id hashed
    const extId = hashField(order.order_id);
    if (extId) userData.external_id = [extId];

    return userData;
}

// ═══ Build CAPI Event Payload ═══

/**
 * Build a single CAPI Purchase event from an order.
 */
export function buildEvent(order: OrderData): Record<string, any> {
    const contentIds = order.content_ids || [];

    return {
        event_name: "Purchase",
        event_time: order.event_time || Math.floor(Date.now() / 1000),
        event_id: order.order_id, // Dedup key
        action_source: "website",
        user_data: hashUserData(order),
        custom_data: {
            value: order.value || 0,
            currency: order.currency || "RON",
            content_ids: contentIds,
            content_type: "product",
            order_id: order.order_id,
            num_items: order.num_items || 1,
        },
    };
}
