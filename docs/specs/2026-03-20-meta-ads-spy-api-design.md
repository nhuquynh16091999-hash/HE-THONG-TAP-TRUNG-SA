# Design Spec: Meta API Ads Spy Backend

## 1. Overview
Translate the Ads Spy feature from using a headless browser (Playwright) to the official Meta Ad Library API (`/v21.0/ads_archive`). This leverages existing Meta App permissions (`ads_read`) for better stability and eliminates the overhead of managing browser containers.

## 2. Architecture & Data Flow
*   **Frontend (Next.js):** The `Ads Spy Tab` UI components will dispatch a GET request containing search parameters (keyword, country, limit) to the FastAPI backend.
*   **FastAPI Backend (`faos_brain/api/ads_spy_api.py`):**
    *   Exposes `GET /api/ads-spy/meta`.
    *   Receives the search criteria.
    *   Reads `META_ACCESS_TOKEN` from the environment.
    *   Constructs a request to `https://graph.facebook.com/v21.0/ads_archive`.
    *   **Fields requested:** `id, page_id, page_name, ad_creation_time, ad_delivery_start_time, ad_delivery_stop_time, ad_creative_bodies, ad_creative_link_titles, ad_creative_link_captions, publisher_platforms`.
*   **Data Transformation:**
    The Meta API returns deeply nested and often repetitive arrays (e.g., `ad_creative_bodies[0]`). The Python backend flattens this into a clean array of ad objects:
    ```json
    {
      "ad_id": "123456",
      "page_name": "Example Page",
      "text": "Ad body text",
      "started_at": "2026-03-20",
      "platforms": ["facebook", "instagram"]
    }
    ```

## 3. Error Handling, Rate Limiting & Caching
*   **Token Expiration / Permission Denial:** 
    If Meta returns an error indicating invalid tokens or missing permissions (e.g., HTTP 401 or 403), the FastAPI endpoint will catch it and return a standardized HTTP 403 response to Next.js. The UI must gracefully alert the user.
*   **Rate Limits (HTTP 429):**
    Meta's Graph API imposes strict rate limits on the `/ads_archive` endpoint.
    *   **Caching Strategy:** To mitigate hitting limits due to UI refreshes, the Python backend will employ a lightweight in-memory cache (TTL = 5 minutes) keyed by the search query and country.

## 4. Testing & Verification
A test file `tests/test_ads_spy_meta.py` will be created to verify the connection, JSON parsing, and proper extraction of creative media and texts from raw API responses before hooking it into the API router.
