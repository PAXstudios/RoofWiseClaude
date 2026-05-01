// Default barrel — Metro picks `.native.tsx` on iOS/Android, `.web.tsx` on web.
// This file exists so non-platform-aware imports still resolve in TypeScript.
export { default } from './StormHistoryMap.native';
