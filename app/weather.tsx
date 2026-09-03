/**
 * /weather — the page the Home hero opens. A weather app for roofers.
 *
 * Pages, swiped sideways (`LocationPager`): "Current location" first, then
 * every saved address. Each page: a dark hero with the big current reading,
 * the HAAG §7 roof-work rating, wind/gusts/rain/UV and sunrise/sunset; then,
 * on the light ground, active NWS alerts, the next roof-work window, the
 * 48-hour strip, the 10-day list, the storm count near the point (tap →
 * Map), and the details grid. Add / manage locations from the header.
 *
 * Data: `weather.ts` (current), `weatherForecast.ts` (hourly + daily),
 * `nwsAlerts.ts` (alerts), `stormMatch.fetchAddressStormHistory` (storms).
 * Every module carries its own honest state — not set up / not available /
 * checking — and none of them ever draws a number the service did not send
 * (Drift #5). Location comes from `LocationField.resolveDeviceLocation`,
 * with the permission-denied state named and routed to the fix.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useReducedMotion } from 'react-native-reanimated';
import { Aurora } from '@/components/glass/Aurora';
import { AnimatedCounter, FadeSlideIn } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { IconChip, type IoniconName } from '@/components/ui/IconChip';
import { Pill } from '@/components/ui/Pill';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  LocationField,
  resolveDeviceLocation,
  type ResolvedLocation,
} from '@/components/LocationField';
import { AlertsList } from '@/components/weather/AlertsList';
import { DailyList } from '@/components/weather/DailyList';
import {
  conditionIcon,
  formatClock,
  formatHourLabel,
  formatWeekday,
  HourlyStrip,
} from '@/components/weather/HourlyStrip';
import { LocationPager, PagerDots, type PagerPage } from '@/components/weather/LocationPager';
import { isWeatherConfigured } from '@/lib/env';
import { geocodeText } from '@/lib/services/geocoding';
import { fetchActiveAlerts, type NwsAlertsResult } from '@/lib/services/nwsAlerts';
import {
  evaluateSafety,
  SAFETY_RATING_LABELS,
  type SafetyRating,
  type SafetyResult,
} from '@/lib/services/safetyEngine';
import { resolveServiceState, stateFromText } from '@/lib/services/serviceState';
import {
  fetchAddressStormHistory,
  HISTORY_LOOKBACK_YEARS_DEFAULT,
  MATCH_RADIUS_MILES,
  type StormHistoryResult,
} from '@/lib/services/stormMatch';
import {
  fetchCurrentWeather,
  hasSafetySignal,
  WeatherNotConfiguredError,
  type CurrentWeather,
} from '@/lib/services/weather';
import {
  fetchDailyForecast,
  fetchHourlyForecast,
  findRoofWorkWindow,
  type ForecastDay,
  type ForecastHour,
  type ForecastResult,
} from '@/lib/services/weatherForecast';
import { useStormAlertStore } from '@/lib/stores/stormAlertStore';
import { useToastStore } from '@/lib/stores/toastStore';
import {
  useWeatherLocationsStore,
  type WeatherLocation,
} from '@/lib/stores/weatherLocationsStore';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  glass,
  gradients,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/**
 * Deep-link contract for the Map tab: `focus=point` with `lat`, `lng` and an
 * optional `label` asks the map to centre on that point and load its storm
 * history there. (The Map tab consumes `focus` the same way it consumes
 * `FOCUS_STORM_LEADS`.)
 */
export const MAP_FOCUS_POINT = 'point';

const DEVICE_PAGE_ID = 'device';
const TEMP_SIZE = fontSize.display * 2;

type Coord = { lat: number; lng: number; address: string; stateCode?: string };

type Page = PagerPage & { coord?: Coord };

type CoordPhase =
  | { kind: 'pending' }
  | { kind: 'ready'; coord: Coord }
  | { kind: 'permission'; canAskAgain: boolean }
  | { kind: 'no-fix' }
  | { kind: 'unsupported' };

type CurrentPhase =
  | { kind: 'pending' }
  | { kind: 'ready'; weather: CurrentWeather }
  | { kind: 'not_configured' }
  | { kind: 'unavailable'; reason: string };

type Pending = { status: 'pending' };

const SAFETY_CHIP: Record<SafetyRating, { bg: string; ink: string; icon: IoniconName }> = {
  SAFE: { bg: colors.tileGreen, ink: colors.tileGreenInk, icon: 'shield-checkmark' },
  USE_CAUTION: { bg: colors.tileOrange, ink: colors.tileOrangeInk, icon: 'alert-circle' },
  UNSAFE: { bg: colors.danger, ink: colors.textInverse, icon: 'warning' },
};

/* ═══════════════════════════ screen ═══════════════════════════════════ */

export default function WeatherScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const saved = useWeatherLocationsStore((s) => s.locations);
  const [index, setIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);

  const pages = useMemo<Page[]>(
    () => [
      { id: DEVICE_PAGE_ID, kind: 'device', title: 'Current location' },
      ...saved.map<Page>((l) => ({
        id: l.id,
        kind: 'saved',
        title: l.label,
        subtitle: l.address,
        coord: { lat: l.lat, lng: l.lng, address: l.address, stateCode: l.stateCode },
      })),
    ],
    [saved],
  );

  // A removed page must not leave the index pointing past the end.
  useEffect(() => {
    if (index > pages.length - 1) setIndex(Math.max(0, pages.length - 1));
  }, [index, pages.length]);

  const page = pages[Math.min(index, pages.length - 1)];

  const onSaved = useCallback(
    (loc: WeatherLocation) => {
      setAdding(false);
      const at = saved.findIndex((l) => l.id === loc.id);
      // The store dedupes, so the page may already exist; land on it either way.
      setIndex(at >= 0 ? at + 1 : saved.length + 1);
    },
    [saved],
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Header on the sky. The pager pages carry their own hero gradient, so
          this band is the flat ink the gradients start from. */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerRow}>
          <PressableScale
            style={styles.headerBtn}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.textInverse} />
          </PressableScale>
          <View style={styles.headerTitle}>
            <Text style={styles.headerKicker}>WEATHER</Text>
            <Text style={styles.headerName} numberOfLines={1}>
              {page.title}
            </Text>
          </View>
          {saved.length > 0 && (
            <PressableScale
              style={styles.headerBtn}
              onPress={() => setManaging(true)}
              accessibilityRole="button"
              accessibilityLabel="Manage saved locations"
            >
              <View style={styles.headerBtnFill}>
                <Ionicons name="list" size={20} color={colors.textInverse} />
              </View>
            </PressableScale>
          )}
          <PressableScale
            style={styles.headerBtn}
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="Add a location"
          >
            <View style={styles.headerBtnFill}>
              <Ionicons name="add" size={24} color={colors.textInverse} />
            </View>
          </PressableScale>
        </View>
        <PagerDots count={pages.length} index={index} style={styles.dots} />
      </View>

      <LocationPager
        pages={pages}
        index={index}
        onIndexChange={setIndex}
        width={width}
        renderPage={(p, _i, active) => <LocationPage page={p} active={active} />}
      />

      <AddLocationSheet visible={adding} onClose={() => setAdding(false)} onSaved={onSaved} />
      <ManageLocationsSheet visible={managing} onClose={() => setManaging(false)} />
    </View>
  );
}

/* ═══════════════════════════ one page ═════════════════════════════════ */

function LocationPage({ page, active }: { page: Page; active: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const activeAlert = useStormAlertStore((s) => s.alerts.find((a) => a.status === 'new'));

  const [coordPhase, setCoordPhase] = useState<CoordPhase>(() =>
    page.coord ? { kind: 'ready', coord: page.coord } : { kind: 'pending' },
  );
  const [current, setCurrent] = useState<CurrentPhase>(() =>
    isWeatherConfigured ? { kind: 'pending' } : { kind: 'not_configured' },
  );
  const [hourly, setHourly] = useState<ForecastResult<ForecastHour> | Pending>({ status: 'pending' });
  const [daily, setDaily] = useState<ForecastResult<ForecastDay> | Pending>({ status: 'pending' });
  const [alerts, setAlerts] = useState<NwsAlertsResult | Pending>({ status: 'pending' });
  const [storms, setStorms] = useState<StormHistoryResult | Pending>({ status: 'pending' });
  const [refreshing, setRefreshing] = useState(false);
  const runRef = useRef(0);
  const armedRef = useRef(false);

  const load = useCallback(
    async (opts: { refresh?: boolean } = {}) => {
      const run = ++runRef.current;
      const stale = () => runRef.current !== run;
      if (opts.refresh) setRefreshing(true);

      // 1 · Where is this page?
      let coord: Coord | null = page.coord ?? null;
      if (!coord) {
        setCoordPhase({ kind: 'pending' });
        const r = await resolveDeviceLocation();
        if (stale()) return;
        if (r.status === 'ok') {
          coord = {
            lat: r.location.lat,
            lng: r.location.lng,
            address: r.location.address,
            stateCode: r.location.stateCode,
          };
          setCoordPhase({ kind: 'ready', coord });
        } else {
          setCoordPhase(
            r.status === 'permission_denied'
              ? { kind: 'permission', canAskAgain: r.canAskAgain }
              : r.status === 'no_fix'
              ? { kind: 'no-fix' }
              : { kind: 'unsupported' },
          );
          setRefreshing(false);
          return;
        }
      }

      // 2 · Everything about that point, in parallel. Each settles on its own
      //     so a slow NWS never holds up the temperature.
      const at = { lat: coord.lat, lng: coord.lng };
      const state = coord.stateCode ?? stateFromText(coord.address) ?? resolveServiceState();

      if (isWeatherConfigured) {
        setCurrent({ kind: 'pending' });
        fetchCurrentWeather(at)
          .then((weather) => !stale() && setCurrent({ kind: 'ready', weather }))
          .catch((err) => {
            if (stale()) return;
            setCurrent(
              err instanceof WeatherNotConfiguredError
                ? { kind: 'not_configured' }
                : { kind: 'unavailable', reason: describe(err) },
            );
          });
      } else {
        setCurrent({ kind: 'not_configured' });
      }

      setHourly({ status: 'pending' });
      fetchHourlyForecast(at).then((r) => !stale() && setHourly(r));
      setDaily({ status: 'pending' });
      fetchDailyForecast(at).then((r) => !stale() && setDaily(r));
      setAlerts({ status: 'pending' });
      fetchActiveAlerts(at).then((r) => !stale() && setAlerts(r));
      setStorms({ status: 'pending' });
      fetchAddressStormHistory({
        ...at,
        state,
        lookbackYears: HISTORY_LOOKBACK_YEARS_DEFAULT,
        radiusMiles: MATCH_RADIUS_MILES,
      })
        .then((r) => !stale() && setStorms(r))
        .catch((err) => !stale() && setStorms({ status: 'unavailable', reason: describe(err) }));

      if (!stale()) setRefreshing(false);
    },
    [page.coord],
  );

  // Fetch the first time the page is shown, not when it is merely mounted as
  // a neighbour — and re-run if the saved coordinates change underneath us.
  useEffect(() => {
    if (!active || armedRef.current) return;
    armedRef.current = true;
    load();
  }, [active, load]);

  useEffect(() => {
    return () => {
      runRef.current += 1;
    };
  }, []);

  const coord = coordPhase.kind === 'ready' ? coordPhase.coord : null;
  const weather = current.kind === 'ready' ? current.weather : null;
  const safety = weather && hasSafetySignal(weather.safety) ? evaluateSafety(weather.safety) : null;
  const today = daily.status === 'ok' ? daily.items[0] : undefined;
  const timeZone = daily.status === 'ok' ? daily.timeZone : hourly.status === 'ok' ? hourly.timeZone : undefined;
  const isDaytime = weather?.isDaytime ?? true;
  const window = hourly.status === 'ok' ? findRoofWorkWindow(hourly.items) : null;

  const openMapHere = () => {
    if (!coord) return;
    router.navigate({
      pathname: '/(tabs)/map',
      params: {
        focus: MAP_FOCUS_POINT,
        lat: String(coord.lat),
        lng: String(coord.lng),
        label: page.kind === 'device' ? 'Current location' : page.title,
      },
    } as any);
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.pageContent, { paddingBottom: insets.bottom + spacing.xxxl }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ refresh: true })}
          tintColor={colors.textInverse}
          colors={[colors.accent]}
          progressBackgroundColor={colors.surface}
        />
      }
    >
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <View style={styles.hero}>
        <LinearGradient
          colors={weather ? (isDaytime ? gradients.clearDay : gradients.stormNight) : gradients.stormNight}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <Aurora transparent />

        <View style={styles.heroBody}>
          <View style={styles.placeRow}>
            <Ionicons
              name={page.kind === 'device' ? 'navigate' : 'location'}
              size={15}
              color={colors.brandSoft}
            />
            <Text style={styles.placeText} numberOfLines={2}>
              {coord?.address ?? page.subtitle ?? page.title}
            </Text>
          </View>

          {coordPhase.kind !== 'ready' ? (
            <CoordPanel phase={coordPhase} onRetry={() => load()} />
          ) : current.kind === 'ready' && weather ? (
            <>
              <View style={styles.flagRow}>
                <View style={styles.nowChip}>
                  <Ionicons name={isDaytime ? 'sunny' : 'moon'} size={13} color={colors.textInverse} />
                  <Text style={styles.nowChipText}>RIGHT NOW</Text>
                </View>
                {safety && (
                  <View
                    style={[styles.safetyChip, { backgroundColor: SAFETY_CHIP[safety.rating].bg }]}
                    accessibilityRole="text"
                    accessibilityLabel={`Roof work safety: ${SAFETY_RATING_LABELS[safety.rating]}`}
                  >
                    <Ionicons
                      name={SAFETY_CHIP[safety.rating].icon}
                      size={13}
                      color={SAFETY_CHIP[safety.rating].ink}
                    />
                    <Text style={[styles.safetyChipText, { color: SAFETY_CHIP[safety.rating].ink }]}>
                      ROOF WORK · {SAFETY_RATING_LABELS[safety.rating].toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.readingRow}>
                <Text style={styles.temp} maxFontSizeMultiplier={1.2}>
                  {reduced ? (
                    weather.temperatureF
                  ) : (
                    <AnimatedCounter value={weather.temperatureF} style={styles.temp} />
                  )}
                  <Text style={styles.tempUnit}>°</Text>
                </Text>
                <View style={styles.readingMeta}>
                  <View style={styles.conditionRow}>
                    <Ionicons
                      name={conditionIcon(weather.description.toUpperCase().replace(/ /g, '_'), isDaytime)}
                      size={20}
                      color={colors.textInverse}
                    />
                    <Text style={styles.condition} numberOfLines={2}>
                      {weather.description}
                    </Text>
                  </View>
                  <Text style={styles.metaPrimary}>Feels like {weather.feelsLikeF}°</Text>
                  {today && (today.highF !== undefined || today.lowF !== undefined) && (
                    <Text style={styles.metaSecondary}>
                      {today.highF !== undefined ? `H ${today.highF}°` : ''}
                      {today.highF !== undefined && today.lowF !== undefined ? '  ' : ''}
                      {today.lowF !== undefined ? `L ${today.lowF}°` : ''}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.tileRow}>
                {weather.windMph !== undefined && (
                  <HeroTile icon="flag-outline" value={`${weather.windMph}`} unit="mph" label="Wind" />
                )}
                {weather.gustMph !== undefined && (
                  <HeroTile
                    icon="warning-outline"
                    value={`${weather.gustMph}`}
                    unit="mph"
                    label="Gusts"
                    tone={weather.gustMph >= 40 ? 'danger' : weather.gustMph >= 25 ? 'warn' : undefined}
                  />
                )}
                {weather.precipChancePercent !== undefined && (
                  <HeroTile
                    icon="rainy-outline"
                    value={`${weather.precipChancePercent}`}
                    unit="%"
                    label="Rain"
                    tone={weather.precipChancePercent >= 20 ? 'warn' : undefined}
                  />
                )}
                {weather.humidity !== undefined && (
                  <HeroTile icon="water-outline" value={`${weather.humidity}`} unit="%" label="Humidity" />
                )}
              </View>

              {today && (today.sunriseTime || today.sunsetTime) && (
                <View style={styles.sunRow}>
                  {today.sunriseTime && (
                    <SunItem icon="sunny-outline" label="Sunrise" time={formatClock(today.sunriseTime, timeZone)} />
                  )}
                  {today.sunsetTime && (
                    <SunItem icon="moon-outline" label="Sunset" time={formatClock(today.sunsetTime, timeZone)} />
                  )}
                </View>
              )}
            </>
          ) : (
            <CurrentPanel phase={current} onRetry={() => load()} />
          )}
        </View>
      </View>

      {/* ── Light content ─────────────────────────────────────────────── */}
      <View style={styles.content}>
        {activeAlert && (
          <FadeSlideIn index={0}>
            <RichCard
              icon="thunderstorm"
              iconTone="orange"
              title={activeAlert.eventKind === 'wind' ? 'Severe wind alert' : 'Storm alert'}
              subtitle={activeAlert.areaLabel}
              chevron
              onPress={() =>
                router.push({ pathname: '/storm-alert/[id]', params: { id: activeAlert.id } } as any)
              }
              accessibilityLabel={`Storm alert for ${activeAlert.areaLabel}. Opens the alert.`}
            />
          </FadeSlideIn>
        )}

        <FadeSlideIn index={1}>
          <AlertsList
            alerts={alerts.status === 'ok' ? alerts.alerts : []}
            status={alerts.status === 'pending' ? 'pending' : alerts.status}
            reason={alerts.status === 'unavailable' ? alerts.reason : undefined}
          />
        </FadeSlideIn>

        <FadeSlideIn index={2}>
          <RoofWorkCard safety={safety} window={window} hourlyStatus={hourly.status} />
        </FadeSlideIn>

        <FadeSlideIn index={3}>
          <HourlyStrip
            hours={hourly.status === 'ok' ? hourly.items : []}
            status={hourly.status}
            reason={hourly.status === 'unavailable' ? hourly.reason : undefined}
          />
        </FadeSlideIn>

        <FadeSlideIn index={4}>
          <DailyList
            days={daily.status === 'ok' ? daily.items : []}
            status={daily.status}
            reason={daily.status === 'unavailable' ? daily.reason : undefined}
            timeZone={timeZone}
          />
        </FadeSlideIn>

        <FadeSlideIn index={5}>
          <StormsNearCard storms={storms} coordReady={coord !== null} onPress={openMapHere} />
        </FadeSlideIn>

        {weather && (
          <FadeSlideIn index={6}>
            <DetailsCard weather={weather} today={today} timeZone={timeZone} />
          </FadeSlideIn>
        )}
      </View>
    </ScrollView>
  );
}

/* ═══════════════════════════ hero pieces ══════════════════════════════ */

function HeroTile({
  icon,
  value,
  unit,
  label,
  tone,
}: {
  icon: IoniconName;
  value: string;
  unit: string;
  label: string;
  tone?: 'warn' | 'danger';
}) {
  const ink = tone === 'danger' ? colors.danger : tone === 'warn' ? colors.accentSoft : colors.textInverse;
  return (
    <View style={styles.tile} accessibilityRole="text" accessibilityLabel={`${label} ${value} ${unit}`}>
      <Ionicons name={icon} size={15} color={colors.brandSoft} />
      <Text style={[styles.tileValue, { color: ink }]} numberOfLines={1}>
        {value}
        <Text style={styles.tileUnit}> {unit}</Text>
      </Text>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

function SunItem({ icon, label, time }: { icon: IoniconName; label: string; time?: string }) {
  if (!time) return null;
  return (
    <View style={styles.sunItem}>
      <Ionicons name={icon} size={14} color={colors.brandSoft} />
      <Text style={styles.sunText}>
        {label} <Text style={styles.sunTime}>{time}</Text>
      </Text>
    </View>
  );
}

/** Location could not be resolved — the cause, and the one action that helps. */
function CoordPanel({ phase, onRetry }: { phase: CoordPhase; onRetry: () => void }) {
  if (phase.kind === 'pending') {
    return <HeroNotice icon="navigate-circle-outline" title="Finding your location" />;
  }
  if (phase.kind === 'permission') {
    const openSettings = () => {
      if (phase.canAskAgain) {
        onRetry();
        return;
      }
      if (Platform.OS !== 'web' && typeof Linking.openSettings === 'function') {
        Linking.openSettings().catch(() => {});
      }
    };
    return (
      <HeroNotice
        icon="location-outline"
        title="Location access is off"
        cause="Allow location so this page can show the weather where you are."
        cta={{ label: 'Turn on location access', icon: 'navigate-outline', onPress: openSettings }}
      />
    );
  }
  if (phase.kind === 'no-fix') {
    return (
      <HeroNotice
        icon="navigate-circle-outline"
        title="No location fix yet"
        cause="The phone has not found where it is. Try again with a clearer view of the sky."
        cta={{ label: 'Try again', icon: 'refresh', onPress: onRetry }}
      />
    );
  }
  return (
    <HeroNotice
      icon="navigate-circle-outline"
      title="Location isn’t available here"
      cause="Add an address with the + button to see its weather."
    />
  );
}

/** Weather could not be read — same honest copy the Home hero uses. */
function CurrentPanel({ phase, onRetry }: { phase: CurrentPhase; onRetry: () => void }) {
  const router = useRouter();
  if (phase.kind === 'pending') {
    return <HeroNotice icon="radio-outline" title="Checking conditions" />;
  }
  if (phase.kind === 'not_configured') {
    return (
      <HeroNotice
        icon="key-outline"
        title="Weather not available"
        cause="Weather isn’t set up yet"
        cta={{
          label: 'Add a weather key in Settings',
          icon: 'settings-outline',
          onPress: () => router.push('/settings'),
        }}
      />
    );
  }
  return (
    <HeroNotice
      icon="cloud-offline-outline"
      title="Weather not available"
      cause="The weather service did not respond"
      cta={{ label: 'Try again', icon: 'refresh', onPress: onRetry }}
    />
  );
}

function HeroNotice({
  icon,
  title,
  cause,
  cta,
}: {
  icon: IoniconName;
  title: string;
  cause?: string;
  cta?: { label: string; icon: IoniconName; onPress: () => void };
}) {
  return (
    <View style={styles.notice}>
      <View style={styles.readingRow}>
        <View style={styles.glyphSlot}>
          <Ionicons name={icon} size={Math.round(TEMP_SIZE * 0.5)} color={colors.brandSoft} />
        </View>
        <View style={styles.readingMeta}>
          <Text style={styles.noticeTitle} numberOfLines={2}>
            {title}
          </Text>
          {cause && (
            <Text style={styles.metaPrimary} numberOfLines={3}>
              {cause}
            </Text>
          )}
        </View>
      </View>
      {cta && (
        <PressableScale
          style={styles.noticeCta}
          onPress={cta.onPress}
          accessibilityRole="button"
          accessibilityLabel={cta.label}
        >
          <Ionicons name={cta.icon} size={18} color={colors.textInverse} />
          <Text style={styles.noticeCtaText} numberOfLines={1}>
            {cta.label}
          </Text>
        </PressableScale>
      )}
    </View>
  );
}

/* ═══════════════════════════ light cards ══════════════════════════════ */

function RoofWorkCard({
  safety,
  window,
  hourlyStatus,
}: {
  safety: SafetyResult | null;
  window: ReturnType<typeof findRoofWorkWindow>;
  hourlyStatus: ForecastResult<ForecastHour>['status'] | 'pending';
}) {
  const tone = safety
    ? safety.rating === 'SAFE'
      ? 'green'
      : safety.rating === 'UNSAFE'
      ? 'orange'
      : 'orange'
    : 'quiet';

  const windowLine = window
    ? `${window.rating === 'SAFE' ? 'Safe' : 'Caution'} window: ${windowLabel(window.start)} – ${windowLabel(
        window.end,
        true,
      )} (${window.hours} h)`
    : hourlyStatus === 'ok'
    ? 'No safe daylight window in the next 48 hours.'
    : hourlyStatus === 'pending'
    ? 'Checking the next 48 hours…'
    : hourlyStatus === 'not_configured'
    ? 'Hourly forecast needs a weather key to find a window.'
    : 'Hourly forecast not available — no window can be confirmed.';

  return (
    <RichCard
      icon={safety ? SAFETY_CHIP[safety.rating].icon : 'shield-outline'}
      iconTone={tone}
      title="Roof-work window"
      subtitle="HAAG §7 go / no-go from the forecast"
      headerTrailing={
        safety ? (
          <Pill
            label={SAFETY_RATING_LABELS[safety.rating]}
            tone={safety.rating === 'SAFE' ? 'success' : safety.rating === 'UNSAFE' ? 'danger' : 'warn'}
            solid={safety.rating === 'UNSAFE'}
          />
        ) : undefined
      }
    >
      <View style={styles.roofWork}>
        <View style={styles.windowRow}>
          <Ionicons
            name={window ? 'time-outline' : 'remove-circle-outline'}
            size={18}
            color={window?.rating === 'SAFE' ? colors.success : window ? colors.warn : colors.textSubtle}
          />
          <Text style={styles.windowText}>{windowLine}</Text>
        </View>
        {safety ? (
          safety.reasons.slice(0, 3).map((r) => (
            <Text key={r} style={styles.reason}>
              · {r}
            </Text>
          ))
        ) : (
          <Text style={styles.reason}>
            Right-now rating needs wind and temperature readings from the weather service.
          </Text>
        )}
      </View>
    </RichCard>
  );
}

function windowLabel(hour: ForecastHour, end = false): string {
  const clock = formatHourLabel(hour);
  const day = hour.localDate ? formatWeekday(hour.localDate, true) : '';
  return end ? clock : day ? `${day} ${clock}` : clock;
}

function StormsNearCard({
  storms,
  coordReady,
  onPress,
}: {
  storms: StormHistoryResult | Pending;
  coordReady: boolean;
  onPress: () => void;
}) {
  const title = `Storms near here (${HISTORY_LOOKBACK_YEARS_DEFAULT} yr)`;
  if (storms.status === 'pending') {
    return (
      <RichCard icon="thunderstorm-outline" iconTone="orange" title={title} subtitle="Checking NOAA storm reports…">
        <ActivityIndicator color={colors.accent} />
      </RichCard>
    );
  }
  if (storms.status === 'unavailable') {
    return (
      <RichCard
        icon="cloud-offline-outline"
        iconTone="quiet"
        title={title}
        subtitle="Storm history not available right now."
      />
    );
  }
  const hail = storms.events.filter((e) => e.type === 'hail').length;
  const wind = storms.events.filter((e) => e.type === 'wind').length;
  const total = storms.events.length;
  const latest = storms.events[0];
  return (
    <RichCard
      icon="thunderstorm"
      iconTone={total > 0 ? 'orange' : 'quiet'}
      title={title}
      subtitle={`Validated NOAA reports within ${MATCH_RADIUS_MILES} mi`}
      chevron={coordReady}
      onPress={coordReady ? onPress : undefined}
      accessibilityLabel={`${total} storms within ${MATCH_RADIUS_MILES} miles in the past ${HISTORY_LOOKBACK_YEARS_DEFAULT} years. Opens the map here.`}
    >
      {total === 0 ? (
        <Text style={styles.reason}>
          No hail ≥0.25" or wind ≥58 mph reports within {MATCH_RADIUS_MILES} mi in the past{' '}
          {storms.lookbackYears} years.
        </Text>
      ) : (
        <View style={styles.stormRow}>
          <View style={styles.stormStat}>
            <Text style={styles.stormValue}>{total}</Text>
            <Text style={styles.stormLabel}>STORMS</Text>
          </View>
          <View style={styles.stormStat}>
            <Text style={[styles.stormValue, { color: colors.stormHail }]}>{hail}</Text>
            <Text style={styles.stormLabel}>HAIL</Text>
          </View>
          <View style={styles.stormStat}>
            <Text style={[styles.stormValue, { color: colors.stormWind }]}>{wind}</Text>
            <Text style={styles.stormLabel}>WIND</Text>
          </View>
          {latest && (
            <View style={[styles.stormStat, styles.stormLatest]}>
              <Text style={styles.stormLatestText} numberOfLines={2}>
                Latest {latest.occurredAt.slice(0, 10)}
                {latest.magnitude !== null
                  ? latest.type === 'hail'
                    ? ` · ${latest.magnitude}" hail`
                    : ` · ${Math.round(latest.magnitude)} mph`
                  : ''}
              </Text>
            </View>
          )}
        </View>
      )}
    </RichCard>
  );
}

function DetailsCard({
  weather,
  today,
  timeZone,
}: {
  weather: CurrentWeather;
  today?: ForecastDay;
  timeZone?: string;
}) {
  const items: { icon: IoniconName; label: string; value: string }[] = [];
  if (weather.windMph !== undefined) {
    items.push({
      icon: 'flag-outline',
      label: 'Wind',
      value: `${weather.windMph} mph${weather.gustMph !== undefined ? ` · gusts ${weather.gustMph}` : ''}`,
    });
  }
  if (weather.thunderstormProbabilityPercent !== undefined) {
    items.push({ icon: 'thunderstorm-outline', label: 'Thunderstorm chance', value: `${weather.thunderstormProbabilityPercent}%` });
  }
  if (today?.day?.uvIndex !== undefined) {
    items.push({ icon: 'sunny-outline', label: 'UV index (day)', value: `${today.day.uvIndex}` });
  }
  if (today?.day?.precipInches !== undefined) {
    items.push({ icon: 'rainy-outline', label: 'Rain today', value: `${today.day.precipInches}"` });
  }
  const sunrise = formatClock(today?.sunriseTime, timeZone);
  const sunset = formatClock(today?.sunsetTime, timeZone);
  if (sunrise) items.push({ icon: 'sunny-outline', label: 'Sunrise', value: sunrise });
  if (sunset) items.push({ icon: 'moon-outline', label: 'Sunset', value: sunset });
  if (items.length === 0) return null;

  return (
    <View style={styles.detailsWrap}>
      <SectionHeader title="Details" style={styles.sectionHeader} />
      <RichCard padded={false}>
        {items.map((it, i) => (
          <View key={it.label} style={[styles.detailRow, i > 0 && styles.detailRowBorder]}>
            <IconChip name={it.icon} tone="blue" size="sm" />
            <Text style={styles.detailLabel}>{it.label}</Text>
            <Text style={styles.detailValue}>{it.value}</Text>
          </View>
        ))}
      </RichCard>
    </View>
  );
}

/* ═══════════════════════════ sheets ═══════════════════════════════════ */

function AddLocationSheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: (loc: WeatherLocation) => void;
}) {
  const add = useWeatherLocationsStore((s) => s.add);
  const toast = useToastStore((s) => s.show);
  const [text, setText] = useState('');
  const [resolved, setResolved] = useState<ResolvedLocation | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setText('');
      setResolved(null);
      setSaving(false);
      setError(null);
    }
  }, [visible]);

  const save = async () => {
    const typed = text.trim();
    if (typed.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      let point = resolved && resolved.address === typed ? resolved : null;
      if (!point) {
        const g = await geocodeText(typed).catch(() => null);
        if (!g) {
          setError('Couldn’t find that address. Check the spelling, pick a suggestion, or use your location.');
          return;
        }
        point = { address: g.formattedAddress, lat: g.lat, lng: g.lng, source: 'places' };
      }
      const loc = add({
        label: shortLabel(point),
        address: point.address,
        lat: point.lat,
        lng: point.lng,
        stateCode: point.stateCode ?? stateFromText(point.address) ?? undefined,
      });
      toast({ tone: 'success', title: 'Location added', body: loc.label });
      onSaved(loc);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.sheetFlex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Add location</Text>
            <PressableScale
              style={styles.sheetClose}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </PressableScale>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <LocationField
              value={text}
              onChangeText={(t) => {
                setText(t);
                if (error) setError(null);
              }}
              onResolved={(loc) => {
                setResolved(loc);
                setText(loc.address);
              }}
              label="Address"
              placeholder="123 Main St, Plano TX"
              autoFocus
              returnKeyType="done"
            />
            {error && (
              <View style={styles.sheetError}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text style={styles.sheetErrorText}>{error}</Text>
              </View>
            )}
            <Text style={styles.sheetHint}>
              Saved locations get their own weather page — swipe between them from the top.
            </Text>
          </ScrollView>

          <View style={styles.sheetFooter}>
            <PressableScale
              style={[styles.saveShadow, (text.trim().length === 0 || saving) && styles.saveDisabled]}
              onPress={save}
              disabled={text.trim().length === 0 || saving}
              accessibilityRole="button"
              accessibilityLabel="Save location"
              accessibilityState={{ disabled: text.trim().length === 0 || saving, busy: saving }}
            >
              <LinearGradient
                colors={gradients.accent}
                style={styles.saveBtn}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                {saving ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={22} color={colors.textInverse} />
                    <Text style={styles.saveText}>Save location</Text>
                  </>
                )}
              </LinearGradient>
            </PressableScale>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function ManageLocationsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const locations = useWeatherLocationsStore((s) => s.locations);
  const remove = useWeatherLocationsStore((s) => s.remove);
  const move = useWeatherLocationsStore((s) => s.move);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) setConfirmId(null);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Saved locations</Text>
          <PressableScale
            style={styles.sheetClose}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.sheetBody}>
          <RichCard padded={locations.length === 0}>
            {locations.length === 0 ? (
              <View style={styles.manageEmpty}>
                <IconChip name="location-outline" tone="blue" size="md" />
                <Text style={styles.manageEmptyTitle}>No saved locations</Text>
                <Text style={styles.manageEmptyBody}>Use + on the weather page to add an address.</Text>
              </View>
            ) : (
              locations.map((l, i) => (
                <View key={l.id}>
                  {i > 0 && <View style={styles.manageSep} />}
                  <View style={styles.manageRow}>
                    <IconChip name="location" tone="blue" size="sm" />
                    <View style={styles.manageText}>
                      <Text style={styles.manageLabel} numberOfLines={1}>
                        {l.label}
                      </Text>
                      <Text style={styles.manageAddress} numberOfLines={1}>
                        {l.address}
                      </Text>
                    </View>
                    {confirmId === l.id ? (
                      <>
                        <PressableScale
                          style={styles.manageBtn}
                          onPress={() => setConfirmId(null)}
                          accessibilityRole="button"
                          accessibilityLabel="Cancel"
                        >
                          <Text style={styles.manageCancel}>Cancel</Text>
                        </PressableScale>
                        <PressableScale
                          style={[styles.manageBtn, styles.manageRemove]}
                          onPress={() => {
                            remove(l.id);
                            setConfirmId(null);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Confirm remove ${l.label}`}
                        >
                          <Text style={styles.manageRemoveText}>Remove</Text>
                        </PressableScale>
                      </>
                    ) : (
                      <>
                        <PressableScale
                          style={styles.manageBtn}
                          onPress={() => move(l.id, -1)}
                          disabled={i === 0}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${l.label} up`}
                          accessibilityState={{ disabled: i === 0 }}
                        >
                          <Ionicons name="chevron-up" size={22} color={i === 0 ? colors.borderStrong : colors.text} />
                        </PressableScale>
                        <PressableScale
                          style={styles.manageBtn}
                          onPress={() => move(l.id, 1)}
                          disabled={i === locations.length - 1}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${l.label} down`}
                          accessibilityState={{ disabled: i === locations.length - 1 }}
                        >
                          <Ionicons
                            name="chevron-down"
                            size={22}
                            color={i === locations.length - 1 ? colors.borderStrong : colors.text}
                          />
                        </PressableScale>
                        <PressableScale
                          style={styles.manageBtn}
                          onPress={() => setConfirmId(l.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${l.label}`}
                        >
                          <Ionicons name="trash-outline" size={20} color={colors.danger} />
                        </PressableScale>
                      </>
                    )}
                  </View>
                </View>
              ))
            )}
          </RichCard>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/* ═══════════════════════════ helpers ══════════════════════════════════ */

/** "1562 Marilla St" / "Plano, TX" — the first meaningful piece of an address. */
function shortLabel(loc: ResolvedLocation): string {
  const first = loc.address.split(',')[0]?.trim();
  if (first && first.length > 0 && first.length <= 40) return first;
  if (loc.city) return loc.stateCode ? `${loc.city}, ${loc.stateCode}` : loc.city;
  return loc.address;
}

function describe(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'The service did not respond';
}

/* ═══════════════════════════ styles ═══════════════════════════════════ */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brand.royalInk },

  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
    backgroundColor: brand.royalInk,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnFill: {
    width: touchTarget.small,
    height: touchTarget.small,
    borderRadius: radii.pill,
    backgroundColor: glass.fillHigh,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, gap: 2 },
  headerKicker: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 1.2,
    color: colors.brandSoft,
  },
  headerName: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    letterSpacing: -0.3,
  },
  dots: { paddingBottom: spacing.xs },

  page: { flex: 1, backgroundColor: colors.bg },
  pageContent: { gap: spacing.xl },

  // ── Hero ──────────────────────────────────────────────────────────────
  hero: {
    overflow: 'hidden',
    backgroundColor: brand.royalInk,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
  },
  heroBody: { padding: spacing.xl, gap: spacing.lg },
  placeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  placeText: { flex: 1, fontSize: fontSize.bodySm, color: colors.brandSoft, lineHeight: 18 },

  flagRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  nowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
  },
  nowChipText: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 1.2,
    color: colors.textInverse,
  },
  safetyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
  },
  safetyChipText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, letterSpacing: 0.6 },

  readingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  temp: {
    fontSize: TEMP_SIZE,
    lineHeight: TEMP_SIZE,
    fontWeight: fontWeight.regular,
    color: colors.textInverse,
    fontVariant: ['tabular-nums'],
  },
  tempUnit: { fontSize: fontSize.titleXl, fontWeight: fontWeight.regular, color: colors.textInverse },
  readingMeta: { flex: 1, paddingBottom: spacing.sm, gap: 2 },
  conditionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  condition: {
    flex: 1,
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    letterSpacing: -0.2,
  },
  metaPrimary: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.textInverse },
  metaSecondary: { fontSize: fontSize.bodySm, color: colors.brandSoft, fontVariant: ['tabular-nums'] },

  tileRow: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minHeight: touchTarget.preferred,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
    gap: 2,
  },
  tileValue: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  tileUnit: { fontSize: fontSize.caption, fontWeight: fontWeight.regular, color: colors.brandSoft },
  tileLabel: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, letterSpacing: 0.6, color: colors.brandSoft },

  sunRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  sunItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sunText: { fontSize: fontSize.bodySm, color: colors.brandSoft },
  sunTime: { color: colors.textInverse, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },

  notice: { gap: spacing.lg },
  glyphSlot: {
    width: TEMP_SIZE,
    height: TEMP_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
  },
  noticeTitle: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    letterSpacing: -0.2,
    marginBottom: spacing.xs,
  },
  noticeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
  },
  noticeCtaText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.textInverse },

  // ── Light content ─────────────────────────────────────────────────────
  content: { paddingHorizontal: spacing.lg, gap: spacing.xl },
  sectionHeader: { marginBottom: spacing.sm, paddingHorizontal: spacing.lg },

  roofWork: { gap: spacing.sm },
  windowRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  windowText: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text, lineHeight: 20 },
  reason: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },

  stormRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg, flexWrap: 'wrap' },
  stormStat: { gap: 2 },
  stormValue: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  stormLabel: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, color: colors.textSubtle, letterSpacing: 0.7 },
  stormLatest: { flex: 1, minWidth: 120, paddingBottom: spacing.xs },
  stormLatestText: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },

  detailsWrap: {},
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
  },
  detailRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  detailLabel: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text, fontWeight: fontWeight.medium },
  detailValue: { fontSize: fontSize.bodyMd, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  // ── Sheets ────────────────────────────────────────────────────────────
  sheet: { flex: 1, backgroundColor: colors.bg },
  sheetFlex: { flex: 1 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.xl,
    paddingRight: spacing.xs,
    minHeight: touchTarget.standard,
  },
  sheetTitle: {
    flex: 1,
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  sheetClose: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBody: { padding: spacing.lg, gap: spacing.lg },
  sheetHint: { fontSize: fontSize.bodySm, color: colors.textSubtle, lineHeight: 18, paddingHorizontal: spacing.xs },
  sheetError: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, paddingHorizontal: spacing.xs },
  sheetErrorText: { flex: 1, fontSize: fontSize.bodySm, color: colors.danger, lineHeight: 18 },
  sheetFooter: { padding: spacing.lg, paddingTop: spacing.sm },
  saveShadow: { borderRadius: radii.button, ...shadows.raised },
  saveDisabled: { opacity: 0.5 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    overflow: 'hidden',
  },
  saveText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },

  manageEmpty: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  manageEmptyTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text, marginTop: spacing.xs },
  manageEmptyBody: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center' },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
  },
  manageSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginLeft: spacing.lg },
  manageText: { flex: 1, gap: 2 },
  manageLabel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  manageAddress: { fontSize: fontSize.bodySm, color: colors.textMuted },
  manageBtn: {
    minWidth: touchTarget.standard,
    height: touchTarget.standard,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
  },
  manageRemove: { backgroundColor: colors.dangerSoft },
  manageRemoveText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.danger },
  manageCancel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.medium, color: colors.textMuted },
});
