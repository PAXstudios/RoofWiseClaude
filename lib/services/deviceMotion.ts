// Thin wrapper around expo-sensors + expo-location to surface live pitch,
// roll, and altitude. Spec section "Device Motion & Sensors".

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import * as Location from 'expo-location';

export type MotionSample = {
  pitchDegrees: number;       // 0° = phone flat, 90° = vertical
  rollDegrees: number;
  yawDegrees: number;
};

const UPDATE_INTERVAL_MS = 33; // ~30 Hz

export function useDeviceMotion(): MotionSample {
  const [sample, setSample] = useState<MotionSample>({
    pitchDegrees: 0,
    rollDegrees: 0,
    yawDegrees: 0,
  });

  useEffect(() => {
    let mounted = true;
    let sub: { remove: () => void } | null = null;

    (async () => {
      const available = await DeviceMotion.isAvailableAsync();
      if (!available || !mounted) return;
      DeviceMotion.setUpdateInterval(UPDATE_INTERVAL_MS);
      sub = DeviceMotion.addListener(({ rotation }) => {
        if (!mounted || !rotation) return;
        setSample({
          pitchDegrees: Math.abs((rotation.beta * 180) / Math.PI),
          rollDegrees: (rotation.gamma * 180) / Math.PI,
          yawDegrees: ((rotation.alpha * 180) / Math.PI + 360) % 360,
        });
      });
    })();

    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);

  return sample;
}

export function useAltitudeFeet(): number | null {
  const [alt, setAlt] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        if (req.status !== 'granted' || !mounted) return;
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 5, timeInterval: 5000 },
        ({ coords }) => {
          if (!mounted) return;
          if (typeof coords.altitude === 'number') {
            setAlt(coords.altitude * 3.28084);
          }
        },
      );
    })();

    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);

  return alt;
}

// -----------------------------------------------------------------------------
// Compass heading — the instrument that actually knows which way the phone
// points.
//
// NOT `MotionSample.yawDegrees`. That value is DeviceMotion's `rotation.alpha`,
// which on iOS is attitude relative to an ARBITRARY reference frame chosen when
// the sensor starts — it is "how far have I turned since I opened the camera",
// not "which way am I facing". The capture HUD read it as a compass for months
// and printed "expected S" hints that were noise; more importantly, nothing
// safe could be built on it, which is why every photo defaulted to South.
//
// `Location.watchHeadingAsync` reports true north (magnetic north when the
// device cannot compute declination) with an accuracy grade. That is what a
// roof slope's orientation is measured against.
// -----------------------------------------------------------------------------

export type CompassHeading = {
  /** 0–360, clockwise from north. */
  degrees: number;
  /** `true` north when the device could compute it, else magnetic. */
  reference: 'true' | 'magnetic';
  /**
   * expo-location's 0–3 grade: 3 is high. Below `COMPASS_USABLE_ACCURACY` the
   * reading is shown but must not tag evidence on its own.
   */
  accuracy: number;
};

/** Below this the compass is a hint, not an instrument. */
export const COMPASS_USABLE_ACCURACY = 2;

/**
 * Live compass, or null when inactive, on web, unavailable, or before the
 * first fix. Subscribes only while `active` — pass focus × app-state so the
 * magnetometer stops on blur.
 */
export function useCompassHeading(active: boolean): CompassHeading | null {
  const [heading, setHeading] = useState<CompassHeading | null>(null);

  useEffect(() => {
    if (!active || Platform.OS === 'web') {
      setHeading(null);
      return;
    }
    let mounted = true;
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      try {
        // Heading itself needs no permission, but TRUE north does — without
        // location permission trueHeading comes back -1 and we fall back to
        // magnetic, which is still a compass.
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          await Location.requestForegroundPermissionsAsync().catch(() => undefined);
        }
        if (!mounted) return;
        sub = await Location.watchHeadingAsync((h) => {
          if (!mounted) return;
          const hasTrue = typeof h.trueHeading === 'number' && h.trueHeading >= 0;
          const deg = hasTrue ? h.trueHeading : h.magHeading;
          if (typeof deg !== 'number' || !Number.isFinite(deg) || deg < 0) return;
          setHeading({
            degrees: ((deg % 360) + 360) % 360,
            reference: hasTrue ? 'true' : 'magnetic',
            accuracy: typeof h.accuracy === 'number' ? h.accuracy : 0,
          });
        });
      } catch {
        // No magnetometer, or the module refused — the caller sees null and
        // falls back to asking the inspector, never to guessing.
      }
    })();

    return () => {
      mounted = false;
      sub?.remove();
    };
  }, [active]);

  return heading;
}
