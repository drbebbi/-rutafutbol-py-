// ApostaProvider — the single module that knows how to talk to Aposta.la.
// All Aposta-specific parsing lives in apostaNormalizer.js (pure, testable).
// This module adds the network layer: configured JSON/API endpoints and
// provider health status. It does NOT scrape Aposta.la.
//
// IMPORTANT: This provider does NOT scrape Aposta.la. Scraping would bypass
// anti-bot protections and violate terms. Instead it supports:
//   1. Manual event JSON import (admin pastes a normalized payload)
//   2. A configured JSON/API endpoint that returns Aposta events in a known schema
//   3. Provider health status
// If no ingestion method is configured, it reports "Aposta data unavailable".

import { secrets } from "base44:runtime";
import {
  normalizeMarketKey, normalizeApostaEvent, normalizeApostaMarket,
  validateApostaImport, APOSTA_PROVIDER_NAME,
} from "./apostaNormalizer.js";

export {
  normalizeMarketKey, normalizeApostaEvent, normalizeApostaMarket,
  validateApostaImport, APOSTA_PROVIDER_NAME,
};

// Fetch events from the configured Aposta JSON endpoint, if any.
// Returns { events: [], health: { status, error } }.
export async function fetchApostaEvents() {
  const endpoint = secrets.get("APOSTA_EVENTS_ENDPOINT");
  if (!endpoint) {
    return { events: [], health: { status: "unconfigured", error: "No Aposta events endpoint configured" } };
  }
  try {
    const res = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.events;
    if (!Array.isArray(list) || list.length > 100 || data.has_more || data.next_cursor) throw new Error("APOSTA_EVENTS_INVALID_OR_UNBOUNDED_RESPONSE");
    const events = list.map(normalizeApostaEvent).filter(Boolean);
    return { events, health: { status: "healthy", error: null } };
  } catch (err) {
    return { events: [], health: { status: "degraded", error: err.message } };
  }
}

// Fetch odds for a single event from the configured endpoint (optional).
// Returns { markets: [], health: { status, error } }.
// A "healthy" status with empty markets means a complete response with no
// markets — distinct from a failed fetch (degraded/unconfigured).
export async function fetchApostaOdds(apostaEventId) {
  const endpoint = secrets.get("APOSTA_ODDS_ENDPOINT");
  if (!endpoint) return { markets: [], health: { status: "unconfigured", error: "No Aposta odds endpoint configured" } };
  try {
    const url = endpoint.replace("{event_id}", encodeURIComponent(apostaEventId));
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.markets) || data.markets.length > 50 || data.complete !== true || String(data.aposta_event_id) !== String(apostaEventId)) throw new Error("APOSTA_ODDS_REQUIRES_COMPLETE_EVENT_RESPONSE");
    const markets = data.markets.map((m) => normalizeApostaMarket(m, data.source_timestamp || data.observed_at));
    return { markets, health: { status: "healthy", error: null } };
  } catch (err) {
    return { markets: [], health: { status: "degraded", error: err.message } };
  }
}

// Health check — pings the configured endpoint with a GET and records latency.
export async function apostaHealthCheck() {
  const endpoint = secrets.get("APOSTA_EVENTS_ENDPOINT");
  if (!endpoint) return { provider: APOSTA_PROVIDER_NAME, status: "unconfigured", latency_ms: null, error: "No endpoint configured" };
  const start = Date.now();
  try {
    const res = await fetch(endpoint, { method: "GET", headers: { Accept: "application/json" } });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { provider: APOSTA_PROVIDER_NAME, status: "degraded", latency_ms, error: `HTTP ${res.status}` };
    return { provider: APOSTA_PROVIDER_NAME, status: "healthy", latency_ms, error: null };
  } catch (err) {
    return { provider: APOSTA_PROVIDER_NAME, status: "offline", latency_ms: Date.now() - start, error: err.message };
  }
}