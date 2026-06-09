// Thin wrapper around expo-sensors + expo-location to surface live pitch,
// roll, and altitude. Spec section "Device Motion & Sensors".

import { useEffect, useState } from 'react';
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
