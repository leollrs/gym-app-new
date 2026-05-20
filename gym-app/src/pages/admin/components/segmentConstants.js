import {
  Users, Shield, AlertTriangle, Zap, Clock,
  UserPlus, Target, Activity, Flame, Heart, Star, Eye,
} from 'lucide-react';

/**
 * Icon + color + label constants shared by the segment list cards
 * (SegmentListItem), the editor modal (SegmentEditorModal), and the
 * prebuilt suggestion cards (PrebuiltCard).
 *
 * `ICON_MAP` keys are stable strings stored on the segment row so the
 * gym admin can pick any icon for any segment; `ICON_OPTIONS` is the
 * derived render order for the picker.
 */
export const ICON_MAP = {
  users: Users, shield: Shield, 'alert-triangle': AlertTriangle,
  zap: Zap, clock: Clock, 'user-plus': UserPlus, target: Target,
  activity: Activity, flame: Flame, heart: Heart, star: Star, eye: Eye,
};

export const ICON_OPTIONS = Object.keys(ICON_MAP);

// One palette swatch per CSS variable — duplicates here used to cause React
// "two children with the same key" warnings in the segment editor.
export const COLOR_OPTIONS = [
  'var(--color-accent)',
  'var(--color-danger)',
  'var(--color-success)',
  'var(--color-info)',
  'var(--color-coach)',
  'var(--color-warning)',
];
