// Google Map Tiles API (2D tiles) — Google's real road + satellite imagery for
// the one runtime that cannot load Google's native map SDK: Expo Go on iOS.
//
// components/map/Map.tsx keeps Apple Maps as the base there and mounts
// components/map/GoogleTileLayer.tsx, which draws these tiles as an opaque
// layer on top. This file owns the network side:
//
//   createSession   POST https://tile.googleapis.com/v1/createSession
//   tiles           GET  https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=…&key=…
//   attribution     GET  https://tile.googleapis.com/tile/v1/viewport?session=…&zoom=…&north=…
//
// Sessions last ~2 weeks and are cached per map type in lib/stores/mapTilesStore.ts.
// The viewport attribution string is REQUIRED by Google's terms and is shown
// by GoogleTileLayer's chip.
//
// Failure policy (Drift #5): the map user never sees an error — the Apple base
// simply stays — and Diagnostics gets the honest reason via
// `getGoogleTilesStatus()`. Verified against the live API on 2026-09-02 with
// the owner's key: HTTP 403 PERMISSION_DENIED, details[].reason =
// API_KEY_SERVICE_BLOCKED, "Requests to this API tile method
// maps_api.tas.BootstrapService.Bootstrap are blocked." — the key's API
// restrictions. `ensureSession` keeps retrying on a throttle so imagery lights
// up on its own once the owner allows the Map Tiles API on that key.
//
// Billing note: createSession is free; every 2D tile fetched is metered. The
// UrlTile keeps its own tile cache — do not remount it on region change.

import { env } from '@/lib/env';
import {
  isTileSessionValid,
  useMapTilesStore,
  type TileError,
  type TileMapType,
  type TileSession,
} from '@/lib/stores/mapTilesStore';

export type { TileMapType, TileSession, TileError } from '@/lib/stores/mapTilesStore';

const CREATE_SESSION_URL = 'https://tile.googleapis.com/v1/createSession';
const TILE_URL_TEMPLATE = 'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}';
const VIEWPORT_URL = 'https://tile.googleapis.com/tile/v1/viewport';

/** Google serves 2D tiles up to zoom 22 (imagery availability varies). */
export const GOOGLE_TILES_MAX_ZOOM = 22;
/** Tile edge in px at scaleFactor1x — matches the `tileSize` we pass to UrlTile. */
export const GOOGLE_TILES_TILE_SIZE = 256;

const REQUEST_TIMEOUT_MS = 15_000;
/** Renew a session this long before Google's expiry so a tile never 4xx's mid-pan. */
const REFRESH_BEFORE_EXPIRY_MS = 24 * 60 * 60 * 1000;
/** After a failed createSession, don't hit Google again sooner than this. */
export const RETRY_AFTER_FAILURE_MS = 30_000;

export type CreateSessionOptions = {
  language?: string;
  region?: string;
};

const DEFAULT_SESSION_OPTIONS: Required<CreateSessionOptions> = {
  language: 'en-US',
  region: 'US',
};

export class MapTilesError extends Error {
  readonly httpStatus: number | null;
  readonly googleReason: string | null;
  constructor(message: string, httpStatus: number | null, googleReason: string | null) {
    super(message);
    this.name = 'MapTilesError';
    this.httpStatus = httpStatus;
    this.googleReason = googleReason;
  }
}

// -----------------------------------------------------------------------------
// Error shaping — from the REAL response bodies Google returns
// -----------------------------------------------------------------------------

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { '@type'?: string; reason?: string; metadata?: Record<string, string> }[];
  };
};

function parseGoogleError(text: string): { status: string | null; message: string | null; reason: string | null } {
  try {
    const body = JSON.parse(text) as GoogleErrorBody;
    const err = body.error;
    if (!err) return { status: null, message: null, reason: null };
    const info = err.details?.find(
      (d) => typeof d.reason === 'string' && (d['@type'] ?? '').endsWith('google.rpc.ErrorInfo'),
    );
    return {
      status: err.status ?? null,
      message: err.message ?? null,
      reason: info?.reason ?? null,
    };
  } catch {
    return { status: null, message: null, reason: null };
  }
}

/**
 * Plain-words reason for a Settings/Diagnostics row. Keyed on Google's
 * ErrorInfo.reason first (the only stable field), then HTTP status.
 */
function describeHttpFailure(httpStatus: number, bodyText: string): MapTilesError {
  const { status, message, reason } = parseGoogleError(bodyText);
  const suffix = message ? ` (${message})` : '';

  switch (reason) {
    case 'API_KEY_SERVICE_BLOCKED':
      // The exact case live on the owner's key today.
      return new MapTilesError(
        'the Map Tiles API is blocked for this Google Maps key — allow "Map Tiles API" under the key\'s API restrictions in Google Cloud',
        httpStatus,
        reason,
      );
    case 'SERVICE_DISABLED':
      return new MapTilesError(
        'the Map Tiles API is not enabled on the Google Cloud project — enable it in APIs & Services',
        httpStatus,
        reason,
      );
    case 'API_KEY_INVALID':
      return new MapTilesError('the Google Maps key is invalid', httpStatus, reason);
    case 'API_KEY_IOS_APP_BLOCKED':
    case 'API_KEY_ANDROID_APP_BLOCKED':
    case 'API_KEY_HTTP_REFERRER_BLOCKED':
      return new MapTilesError(
        'the Google Maps key\'s application restriction blocks this app — Expo Go needs a key without app restrictions',
        httpStatus,
        reason,
      );
    case 'RATE_LIMIT_EXCEEDED':
    case 'QUOTA_EXCEEDED':
      return new MapTilesError('Map Tiles API quota exceeded for this key', httpStatus, reason);
    case 'BILLING_DISABLED':
      return new MapTilesError(
        'billing is not enabled on the Google Cloud project behind this key',
        httpStatus,
        reason,
      );
    default:
      break;
  }

  if (httpStatus === 429 || status === 'RESOURCE_EXHAUSTED') {
    return new MapTilesError('Map Tiles API quota exceeded for this key', httpStatus, reason);
  }
  if (httpStatus === 403 || status === 'PERMISSION_DENIED') {
    return new MapTilesError(`Google refused the request${suffix}`, httpStatus, reason);
  }
  if (httpStatus === 400) {
    return new MapTilesError(`Google rejected the request${suffix}`, httpStatus, reason);
  }
  if (httpStatus >= 500) {
    return new MapTilesError(`Google's tile service returned HTTP ${httpStatus}`, httpStatus, reason);
  }
  return new MapTilesError(
    `HTTP ${httpStatus}${status ? ` ${status}` : ''}${suffix}`,
    httpStatus,
    reason,
  );
}

function describeNetworkFailure(err: unknown, timedOut: boolean): MapTilesError {
  if (timedOut) {
    return new MapTilesError('Google\'s tile service did not answer in time', null, null);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new MapTilesError(`network error — ${msg || 'request failed'}`, null, null);
}

// -----------------------------------------------------------------------------
// Fetch with a hard timeout
// -----------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<{ res: Response; text: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } catch (err) {
    throw describeNetworkFailure(err, timedOut);
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

function apiKey(): string {
  // The base Maps Platform key. The Map Tiles API is a Maps Platform service,
  // so the same key the native SDKs / web JS use is the one to allow it on.
  return env.GOOGLE_MAPS_API_KEY;
}

export function isGoogleTilesConfigured(): boolean {
  return apiKey().length > 0;
}

/**
 * Raw createSession. Throws MapTilesError; callers that want the silent
 * path use `ensureSession`. Exposed so a Settings "Test" button can surface
 * the exact reason on demand.
 */
export async function createSession(
  mapType: TileMapType,
  opts: CreateSessionOptions = {},
): Promise<TileSession> {
  const key = apiKey();
  if (!key) throw new MapTilesError('no Google Maps key configured', null, null);

  const { language, region } = { ...DEFAULT_SESSION_OPTIONS, ...opts };
  const { res, text } = await fetchWithTimeout(
    `${CREATE_SESSION_URL}?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType, language, region }),
    },
  );

  if (!res.ok) throw describeHttpFailure(res.status, text);

  let body: {
    session?: string;
    expiry?: string | number;
    tileWidth?: number;
    tileHeight?: number;
    imageFormat?: string;
  };
  try {
    body = JSON.parse(text);
  } catch {
    throw new MapTilesError('Google returned an unreadable createSession response', res.status, null);
  }
  if (typeof body.session !== 'string' || body.session.length === 0) {
    throw new MapTilesError('Google returned no session token', res.status, null);
  }

  // `expiry` is seconds since epoch, as a string. Never invent one: a
  // missing/unparseable expiry becomes "expired now" so we re-ask.
  const expirySec = Number(body.expiry);
  const now = Date.now();
  const expiresAt = Number.isFinite(expirySec) && expirySec > 0 ? expirySec * 1000 : now;

  return {
    session: body.session,
    expiresAt,
    createdAt: now,
    tileWidth: typeof body.tileWidth === 'number' ? body.tileWidth : GOOGLE_TILES_TILE_SIZE,
    tileHeight: typeof body.tileHeight === 'number' ? body.tileHeight : GOOGLE_TILES_TILE_SIZE,
    imageFormat: typeof body.imageFormat === 'string' ? body.imageFormat : 'unknown',
  };
}

/** Valid, cached session for this map type — or null. No network. */
export function getCachedSession(mapType: TileMapType, now: number = Date.now()): TileSession | null {
  const s = useMapTilesStore.getState().sessions[mapType];
  return isTileSessionValid(s, now) ? s : null;
}

function needsRefresh(s: TileSession, now: number): boolean {
  return s.expiresAt - now < REFRESH_BEFORE_EXPIRY_MS;
}

const inFlight: Partial<Record<TileMapType, Promise<TileSession | null>>> = {};

/**
 * The silent path GoogleTileLayer polls.
 *
 * - Valid & fresh session cached → returned, no network.
 * - Otherwise (missing / near expiry) → createSession, throttled: after a
 *   failure we wait RETRY_AFTER_FAILURE_MS before asking Google again, unless
 *   `force`. A refresh that fails while the old session is still valid keeps
 *   returning the old one — imagery stays up until Google actually cuts it.
 * - Never throws. Failures land in the store's `lastError` for Diagnostics.
 */
export async function ensureSession(
  mapType: TileMapType,
  { force = false }: { force?: boolean } = {},
): Promise<TileSession | null> {
  const store = useMapTilesStore.getState();
  const now = Date.now();
  const cached = getCachedSession(mapType, now);

  if (cached && !needsRefresh(cached, now) && !force) return cached;

  if (!isGoogleTilesConfigured()) {
    if (!store.lastError || store.lastError.googleReason !== 'NO_KEY') {
      store.setLastError({
        at: now,
        mapType,
        reason: 'no Google Maps key configured',
        httpStatus: null,
        googleReason: 'NO_KEY',
      });
    }
    return cached;
  }

  const pending = inFlight[mapType];
  if (pending) return pending;

  if (!force && store.lastAttemptAt != null && store.lastError && now - store.lastAttemptAt < RETRY_AFTER_FAILURE_MS) {
    return cached;
  }

  const run = (async (): Promise<TileSession | null> => {
    useMapTilesStore.getState().noteAttempt(Date.now());
    try {
      const session = await createSession(mapType);
      useMapTilesStore.getState().setSession(mapType, session);
      return session;
    } catch (err) {
      const e = err instanceof MapTilesError ? err : describeNetworkFailure(err, false);
      const error: TileError = {
        at: Date.now(),
        mapType,
        reason: e.message,
        httpStatus: e.httpStatus,
        googleReason: e.googleReason,
      };
      useMapTilesStore.getState().setLastError(error);
      if (__DEV__) {
        console.warn(`[mapTiles] Google map imagery unavailable — ${e.message}`);
      }
      // A refresh that failed while the old session still works keeps it.
      return getCachedSession(mapType) ?? null;
    } finally {
      delete inFlight[mapType];
    }
  })();

  inFlight[mapType] = run;
  return run;
}

/** Tile URL template for react-native-maps' UrlTile ({z}/{x}/{y} substituted natively). */
export function tileUrlTemplate(session: TileSession): string {
  return `${TILE_URL_TEMPLATE}?session=${encodeURIComponent(session.session)}&key=${encodeURIComponent(apiKey())}`;
}

// -----------------------------------------------------------------------------
// Attribution (required by Google's terms)
// -----------------------------------------------------------------------------

export type TileViewport = {
  zoom: number;
  north: number;
  south: number;
  east: number;
  west: number;
};

/**
 * Copyright string for what is on screen, e.g. "Map data ©2026 Google" or
 * "Imagery ©2026 Airbus, Maxar Technologies, Map data ©2026 Google". Returns
 * null on any failure — the chip then falls back to the bare "Google" mark.
 * Attribution failures are NOT recorded as imagery errors: the tiles are
 * still drawing.
 */
export async function fetchViewportAttribution(
  mapType: TileMapType,
  viewport: TileViewport,
): Promise<string | null> {
  const session = getCachedSession(mapType);
  if (!session) return null;
  const key = apiKey();
  if (!key) return null;

  const q = new URLSearchParams({
    session: session.session,
    key,
    zoom: String(clampZoom(viewport.zoom)),
    north: viewport.north.toFixed(6),
    south: viewport.south.toFixed(6),
    east: viewport.east.toFixed(6),
    west: viewport.west.toFixed(6),
  });

  try {
    const { res, text } = await fetchWithTimeout(`${VIEWPORT_URL}?${q.toString()}`, { method: 'GET' });
    if (!res.ok) return null;
    const body = JSON.parse(text) as { copyright?: string };
    return typeof body.copyright === 'string' && body.copyright.length > 0 ? body.copyright : null;
  } catch {
    return null;
  }
}

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 0;
  return Math.max(0, Math.min(GOOGLE_TILES_MAX_ZOOM, Math.round(z)));
}

/**
 * Web-Mercator zoom for a react-native-maps region drawn at `widthPx`. The
 * viewport endpoint only uses zoom to pick which imagery providers to credit,
 * so an integer estimate from the longitude span is exactly enough.
 */
export function zoomForRegion(longitudeDelta: number, widthPx: number): number {
  const w = widthPx > 0 ? widthPx : 390;
  const span = Math.max(1e-6, Math.abs(longitudeDelta));
  return clampZoom(Math.log2((360 * w) / (GOOGLE_TILES_TILE_SIZE * span)));
}

/** Bounds of a region, clamped to the Mercator-safe latitude band. */
export function viewportForRegion(
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number },
  widthPx: number,
): TileViewport {
  const halfLat = Math.abs(region.latitudeDelta) / 2;
  const halfLon = Math.abs(region.longitudeDelta) / 2;
  const clampLat = (v: number) => Math.max(-85, Math.min(85, v));
  const wrapLon = (v: number) => {
    let x = v;
    while (x > 180) x -= 360;
    while (x < -180) x += 360;
    return x;
  };
  return {
    zoom: zoomForRegion(region.longitudeDelta, widthPx),
    north: clampLat(region.latitude + halfLat),
    south: clampLat(region.latitude - halfLat),
    east: wrapLon(region.longitude + halfLon),
    west: wrapLon(region.longitude - halfLon),
  };
}

// -----------------------------------------------------------------------------
// Status for Settings / Diagnostics
// -----------------------------------------------------------------------------

export type GoogleTilesStatus = {
  configured: boolean;
  /** At least one map type has a live session right now. */
  available: boolean;
  sessions: { mapType: TileMapType; expiresAt: number }[];
  lastError: TileError | null;
  lastSuccessAt: number | null;
  /** One honest line: "Google map imagery active …" or "… unavailable — <reason>". */
  message: string;
};

/** True when Google tiles can be drawn right now (a valid cached session exists). */
export function isGoogleTilesAvailable(now: number = Date.now()): boolean {
  const { sessions } = useMapTilesStore.getState();
  return (Object.keys(sessions) as TileMapType[]).some((t) => isTileSessionValid(sessions[t], now));
}

/** The last reason imagery was unavailable, or null if it never failed. */
export function getLastGoogleTilesError(): TileError | null {
  return useMapTilesStore.getState().lastError;
}

export function getGoogleTilesStatus(now: number = Date.now()): GoogleTilesStatus {
  const { sessions, lastError, lastSuccessAt } = useMapTilesStore.getState();
  const configured = isGoogleTilesConfigured();
  const live = (Object.keys(sessions) as TileMapType[])
    .filter((t) => isTileSessionValid(sessions[t], now))
    .map((t) => ({ mapType: t, expiresAt: (sessions[t] as TileSession).expiresAt }));
  const available = live.length > 0;

  let message: string;
  if (!configured) {
    message = 'Google map imagery unavailable — no Google Maps key configured';
  } else if (available) {
    const soonest = Math.min(...live.map((s) => s.expiresAt));
    message = `Google map imagery active (${live.map((s) => s.mapType).join(' + ')}) · session renews by ${new Date(soonest).toLocaleDateString()}`;
  } else if (lastError) {
    message = `Google map imagery unavailable — ${lastError.reason}`;
  } else {
    message = 'Google map imagery unavailable — not requested yet (opens with the first map)';
  }

  return { configured, available, sessions: live, lastError, lastSuccessAt, message };
}
