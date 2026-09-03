// Retired route. The standalone Hail Tracer and the Map tab were two maps
// that fetched storms once around a fixed centre and never again — the owner
// asked for one map that behaves like a real map, with the tracer's UI. That
// map is the Map tab, now "Storm Tracer". This file keeps old deep links and
// any cached Home tiles working.
import { Redirect } from 'expo-router';

export default function HailTracerRedirect() {
  return <Redirect href={{ pathname: '/(tabs)/map', params: { filter: 'storms' } } as any} />;
}
