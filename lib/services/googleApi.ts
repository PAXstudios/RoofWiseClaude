// Google Maps Platform — one place that understands WHY a request failed.
//
// The owner's key has API restrictions on it, so the live failure modes are
// not "network down" but "this key is not allowed to call that API":
//
//   Places (New)   HTTP 403  { error: { status: "PERMISSION_DENIED",
//                              details[].reason: "API_KEY_SERVICE_BLOCKED" } }
//   Places/Geocode HTTP 200  { status: "REQUEST_DENIED",
//        (legacy)             error_message: "…not authorized to use this service…" }
//   Solar/Weather  HTTP 403  { error: { status: "PERMISSION_DENIED",
//                              message: "…blocked…" } }
//
// Every Google client in lib/services/* funnels its failures through
// `classifyGoogleFailure` so the screens can show ONE honest, plain-English
// line (`describeGoogleApiError`) instead of a silent empty dropdown or a raw
// JSON snippet. Copy names the feature the roofer was using AND the exact
// Google API to enable, so the account owner knows what to flip — and nothing
// else (no env-var names, no HTTP codes on screen).
//
// Pure module: no React, no stores. Network helpers here only add a timeout.

export type GoogleApi = 'places' | 'geocoding' | 'solar' | 'weather' | 'mapTiles' | 'maps';

export type GoogleApiErrorKind =
  /** No key in this build. */
  | 'not_configured'
  /** The key exists but this API is not allowed for it (API restriction or API not enabled). */
  | 'not_authorized'
  /** The key's application restriction (bundle id / referrer) rejects this app. */
  | 'app_restricted'
  /** The key is malformed / revoked. */
  | 'invalid_key'
  /** Billing is off on the Cloud project. */
  | 'billing'
  /** Daily quota / rate limit. */
  | 'quota'
  /** Could not reach Google at all. */
  | 'network'
  /** Google did not answer inside the timeout. */
  | 'timeout'
  /** Anything else Google returned that is not success. */
  | 'http';

/** What the roofer was trying to do, and what the account owner must enable. */
export const GOOGLE_API_LABELS: Record<GoogleApi, { feature: string; apiName: string }> = {
  places: { feature: 'Address search', apiName: 'Places API (New)' },
  geocoding: { feature: 'Address lookup', apiName: 'Geocoding API' },
  solar: { feature: 'Roof measurement', apiName: 'Solar API' },
  weather: { feature: 'Weather', apiName: 'Weather API' },
  mapTiles: { feature: 'Google map imagery', apiName: 'Map Tiles API' },
  maps: { feature: 'Google Maps', apiName: 'Maps SDK' },
};

export class GoogleApiError extends Error {
  readonly api: GoogleApi;
  readonly kind: GoogleApiErrorKind;
  readonly httpStatus: number | null;
  /** Google's ErrorInfo.reason (e.g. API_KEY_SERVICE_BLOCKED) or legacy `status`. */
  readonly googleReason: string | null;

  constructor(
    api: GoogleApi,
    kind: GoogleApiErrorKind,
    message: string,
    httpStatus: number | null = null,
    googleReason: string | null = null,
  ) {
    super(message);
    this.name = 'GoogleApiError';
    this.api = api;
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.googleReason = googleReason;
  }
}

export function isGoogleApiError(err: unknown): err is GoogleApiError {
  return err instanceof GoogleApiError;
}

/** True when the failure is about the KEY (not the network) — the "tell the owner" cases. */
export function isGoogleKeyProblem(err: unknown): boolean {
  if (!isGoogleApiError(err)) return false;
  return (
    err.kind === 'not_configured' ||
    err.kind === 'not_authorized' ||
    err.kind === 'app_restricted' ||
    err.kind === 'invalid_key' ||
    err.kind === 'billing'
  );
}

// -----------------------------------------------------------------------------
// Classification — from the REAL response bodies Google returns
// -----------------------------------------------------------------------------

type GoogleRpcErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { '@type'?: string; reason?: string; metadata?: Record<string, string> }[];
  };
  /** Legacy web-service envelope (Geocoding, legacy Places). */
  status?: string;
  error_message?: string;
};

function parseBody(text: string): GoogleRpcErrorBody | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as GoogleRpcErrorBody) : null;
  } catch {
    return null;
  }
}

/**
 * Turn an HTTP failure (or a legacy 200-with-status failure) into a typed
 * error. Keyed on Google's ErrorInfo.reason first (the only stable field),
 * then the RPC status, then the legacy `status`, then the HTTP status.
 */
export function classifyGoogleFailure(
  api: GoogleApi,
  httpStatus: number,
  bodyText: string,
): GoogleApiError {
  const body = parseBody(bodyText);
  const rpc = body?.error;
  const info = rpc?.details?.find(
    (d) => typeof d.reason === 'string' && (d['@type'] ?? '').endsWith('google.rpc.ErrorInfo'),
  );
  const reason = info?.reason ?? null;
  const rpcStatus = rpc?.status ?? null;
  const legacyStatus = typeof body?.status === 'string' ? body.status : null;
  const message = (rpc?.message ?? body?.error_message ?? '').toString();
  const lower = message.toLowerCase();
  const tag = reason ?? rpcStatus ?? legacyStatus;

  const mk = (kind: GoogleApiErrorKind) =>
    new GoogleApiError(api, kind, message || `${GOOGLE_API_LABELS[api].apiName} ${httpStatus}`, httpStatus, tag);

  switch (reason) {
    case 'API_KEY_SERVICE_BLOCKED':
    case 'SERVICE_DISABLED':
    case 'ACCESS_TOKEN_SCOPE_INSUFFICIENT':
      return mk('not_authorized');
    case 'API_KEY_INVALID':
      return mk('invalid_key');
    case 'API_KEY_IOS_APP_BLOCKED':
    case 'API_KEY_ANDROID_APP_BLOCKED':
    case 'API_KEY_HTTP_REFERRER_BLOCKED':
    case 'API_KEY_IP_ADDRESS_BLOCKED':
      return mk('app_restricted');
    case 'RATE_LIMIT_EXCEEDED':
    case 'QUOTA_EXCEEDED':
      return mk('quota');
    case 'BILLING_DISABLED':
      return mk('billing');
    default:
      break;
  }

  // Legacy web services (Geocoding, legacy Places): HTTP 200 + status field.
  if (legacyStatus === 'REQUEST_DENIED') {
    if (lower.includes('not authorized') || lower.includes('not enabled') || lower.includes('blocked')) {
      return mk('not_authorized');
    }
    if (lower.includes('referer') || lower.includes('referrer') || lower.includes('ip address')) {
      return mk('app_restricted');
    }
    if (lower.includes('invalid') && lower.includes('key')) return mk('invalid_key');
    if (lower.includes('billing')) return mk('billing');
    // A denied request with no recognised text is still a key problem.
    return mk('not_authorized');
  }
  if (legacyStatus === 'OVER_QUERY_LIMIT' || legacyStatus === 'OVER_DAILY_LIMIT') {
    return mk('quota');
  }

  if (httpStatus === 429 || rpcStatus === 'RESOURCE_EXHAUSTED') return mk('quota');
  if (httpStatus === 403 || rpcStatus === 'PERMISSION_DENIED') {
    // Solar/Weather say "…are blocked." or "…has not been used in project…".
    if (lower.includes('billing')) return mk('billing');
    if (lower.includes('referer') || lower.includes('referrer') || lower.includes('bundle')) {
      return mk('app_restricted');
    }
    return mk('not_authorized');
  }
  if (httpStatus === 400 && lower.includes('api key not valid')) return mk('invalid_key');

  return mk('http');
}

/** A legacy 200 response whose `status` is a failure (Geocoding, legacy Places). */
export function legacyStatusIsFailure(status: unknown): boolean {
  return (
    status === 'REQUEST_DENIED' ||
    status === 'OVER_QUERY_LIMIT' ||
    status === 'OVER_DAILY_LIMIT' ||
    status === 'INVALID_REQUEST' ||
    status === 'UNKNOWN_ERROR'
  );
}

// -----------------------------------------------------------------------------
// Fetch with a hard timeout — network vs timeout are distinguished
// -----------------------------------------------------------------------------

export const GOOGLE_REQUEST_TIMEOUT_MS = 15_000;

export async function fetchGoogle(
  api: GoogleApi,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = GOOGLE_REQUEST_TIMEOUT_MS,
): Promise<{ res: Response; text: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } catch (err) {
    if (timedOut) {
      throw new GoogleApiError(api, 'timeout', 'Google did not answer in time.');
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new GoogleApiError(api, 'network', msg || 'Network request failed.');
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Denial memo — once a key is refused for an API, every field that uses that
// API can say so immediately instead of firing one more doomed request per
// keystroke. Cleared by a later success (e.g. the owner flipped the switch
// and re-ran the Settings check).
// -----------------------------------------------------------------------------

const DENIAL_TTL_MS = 10 * 60 * 1000;
const denials = new Map<GoogleApi, { err: GoogleApiError; at: number }>();

export function rememberGoogleDenial(err: GoogleApiError): void {
  if (!isGoogleKeyProblem(err)) return;
  denials.set(err.api, { err, at: Date.now() });
}

export function recentGoogleDenial(api: GoogleApi, now: number = Date.now()): GoogleApiError | null {
  const d = denials.get(api);
  if (!d) return null;
  if (now - d.at > DENIAL_TTL_MS) {
    denials.delete(api);
    return null;
  }
  return d.err;
}

export function clearGoogleDenial(api: GoogleApi): void {
  denials.delete(api);
}

// -----------------------------------------------------------------------------
// Copy — plain English for a roofer, exact API name for the owner
// -----------------------------------------------------------------------------

/**
 * One sentence (two at most) a gloved roofer can act on. Returns `null` when
 * `err` is not a Google API error, so callers can fall back to their own copy.
 */
export function describeGoogleApiError(err: unknown): string | null {
  if (!isGoogleApiError(err)) return null;
  const { feature, apiName } = GOOGLE_API_LABELS[err.api];
  switch (err.kind) {
    case 'not_configured':
      return `${feature} isn't set up in this build — there's no Google key. Type it in by hand for now.`;
    case 'not_authorized':
      return `${feature} isn't enabled for this app's Google key yet (${apiName}). Ask the account owner to enable it.`;
    case 'app_restricted':
      return `${feature} is blocked by the Google key's app restriction (${apiName}). The account owner needs to allow this app on the key.`;
    case 'invalid_key':
      return `${feature} is off — the app's Google key isn't valid (${apiName}). Ask the account owner to check it.`;
    case 'billing':
      return `${feature} is off — billing isn't enabled on the Google project behind this key (${apiName}).`;
    case 'quota':
      return `${feature} hit its Google usage limit for now (${apiName}). Try again later.`;
    case 'network':
      return `Can't reach Google right now — check your connection and try again.`;
    case 'timeout':
      return `Google didn't answer in time. Try again.`;
    case 'http':
    default:
      return `${feature} didn't work — ${apiName} returned an error. Try again in a moment.`;
  }
}

/** Short pill-friendly state for a Settings row. */
export type GoogleApiProbeState =
  | 'enabled'
  | 'not_enabled'
  | 'not_configured'
  | 'unreachable'
  | 'not_tested';

export type GoogleApiProbeResult = {
  api: GoogleApi;
  state: GoogleApiProbeState;
  /** One honest line under the pill. */
  detail: string;
  checkedAt: number | null;
};

const PROBE_TTL_MS = 10 * 60 * 1000;
const probeCache = new Map<GoogleApi, GoogleApiProbeResult>();
let probeInFlight: Promise<GoogleApiProbeResult[]> | null = null;

/** Probe order as shown in Settings. */
export const PROBED_APIS: GoogleApi[] = ['maps', 'places', 'geocoding', 'weather', 'solar', 'mapTiles'];

function fromError(api: GoogleApi, err: unknown): GoogleApiProbeResult {
  const now = Date.now();
  if (isGoogleApiError(err)) {
    if (err.kind === 'not_configured') {
      return { api, state: 'not_configured', detail: 'No Google key in this build', checkedAt: now };
    }
    if (isGoogleKeyProblem(err)) {
      rememberGoogleDenial(err);
      return { api, state: 'not_enabled', detail: describeGoogleApiError(err) ?? err.message, checkedAt: now };
    }
    if (err.kind === 'quota') {
      // The key IS allowed — it just ran out. That is "enabled" for the owner's question.
      clearGoogleDenial(api);
      return { api, state: 'enabled', detail: 'Enabled — usage limit reached right now', checkedAt: now };
    }
    return { api, state: 'unreachable', detail: describeGoogleApiError(err) ?? err.message, checkedAt: now };
  }
  const msg = err instanceof Error ? err.message : 'Request failed';
  return { api, state: 'unreachable', detail: msg, checkedAt: now };
}

function ok(api: GoogleApi, detail = 'Enabled for this key'): GoogleApiProbeResult {
  clearGoogleDenial(api);
  return { api, state: 'enabled', detail, checkedAt: Date.now() };
}

/**
 * Probe every Google API the app uses with the smallest request each one
 * accepts. Results are cached for 10 minutes; `force` re-asks. Never throws —
 * a failed probe is a result, and "Not tested" is only ever the state of a
 * probe that has not run.
 *
 * The probes are injected so this module stays free of the concrete service
 * clients (and their store imports); see `probeGoogleApis` in Settings.
 */
export async function runGoogleApiProbes(
  probes: Partial<Record<GoogleApi, () => Promise<string | void>>>,
  { force = false }: { force?: boolean } = {},
): Promise<GoogleApiProbeResult[]> {
  if (probeInFlight) return probeInFlight;
  const now = Date.now();

  const run = (async () => {
    const results = await Promise.all(
      PROBED_APIS.map(async (api): Promise<GoogleApiProbeResult> => {
        const cached = probeCache.get(api);
        if (!force && cached && cached.checkedAt != null && now - cached.checkedAt < PROBE_TTL_MS) {
          return cached;
        }
        const probe = probes[api];
        if (!probe) {
          return {
            api,
            state: 'not_tested',
            detail: 'Can\'t be checked with a request from the app',
            checkedAt: null,
          };
        }
        try {
          const detail = await probe();
          return ok(api, typeof detail === 'string' && detail.length > 0 ? detail : undefined);
        } catch (err) {
          return fromError(api, err);
        }
      }),
    );
    for (const r of results) probeCache.set(r.api, r);
    return results;
  })();

  probeInFlight = run;
  try {
    return await run;
  } finally {
    probeInFlight = null;
  }
}

/** Cached probe results (possibly stale or empty) — for a first paint before probing. */
export function getCachedGoogleApiProbes(): GoogleApiProbeResult[] {
  return PROBED_APIS.map(
    (api) =>
      probeCache.get(api) ?? { api, state: 'not_tested', detail: 'Not checked yet', checkedAt: null },
  );
}
