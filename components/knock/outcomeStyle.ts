// Outcome → theme colour / glyph. The one place the pure outcome table's
// token NAMES become token VALUES, so lib/services/knockOutcomes.ts stays
// free of the react-native import that theme/tokens.ts carries.

import type { IoniconName } from '@/components/ui/IconChip';
import type { KnockOutcome } from '@/lib/models/types';
import { outcomeMeta } from '@/lib/services/knockOutcomes';
import { colors } from '@/theme/tokens';

export function outcomeColor(outcome: KnockOutcome | string): string {
  return colors[outcomeMeta(outcome).tone];
}

export function outcomeIcon(outcome: KnockOutcome | string): IoniconName {
  return outcomeMeta(outcome).icon as IoniconName;
}
