/**
 * Predefined gym color palettes for white-label theming.
 * Each palette defines a primary + secondary color pair.
 * Surface tinting is auto-derived from the primary hue by themeGenerator.
 */

export const PALETTES = {
  obsidian_amber: {
    name: 'Obsidian & Amber',
    description: 'Warm luxury feel — golden amber on deep navy',
    primary: '#F0A500',
    secondary: '#22D3A7',
    preview: { dark: '#0B0F1A', light: '#FAFAF8' }, // preview surface colors
    tags: ['default', 'luxury', 'warm'],
  },
  electric_night: {
    name: 'Electric Night',
    description: 'Tech-forward indigo for modern gyms',
    primary: '#6366F1',
    secondary: '#34D399',
    preview: { dark: '#0B0B14', light: '#F8F8FC' },
    tags: ['modern', 'tech', 'cool'],
  },
  crimson_power: {
    name: 'Crimson Power',
    description: 'Bold red energy for CrossFit and powerlifting',
    primary: '#EF4444',
    secondary: '#F59E0B',
    preview: { dark: '#140B0B', light: '#FDF8F8' },
    tags: ['bold', 'energy', 'crossfit'],
  },
  ocean_drive: {
    name: 'Ocean Drive',
    description: 'Cool cyan for beach and wellness studios',
    primary: '#06B6D4',
    secondary: '#10B981',
    preview: { dark: '#0B1214', light: '#F8FCFD' },
    tags: ['calm', 'wellness', 'cool'],
  },
  neon_surge: {
    name: 'Neon Surge',
    description: 'Bright cyan and purple for boutique gyms',
    primary: '#22D3EE',
    secondary: '#A78BFA',
    preview: { dark: '#0B1314', light: '#F8FDFE' },
    tags: ['trendy', 'boutique', 'vibrant'],
  },
  forest_iron: {
    name: 'Forest Iron',
    description: 'Natural green for outdoor and functional fitness',
    primary: '#16A34A',
    secondary: '#D4AF37',
    preview: { dark: '#0B140E', light: '#F8FDF9' },
    tags: ['natural', 'outdoor', 'functional'],
  },
  sunset_blaze: {
    name: 'Sunset Blaze',
    description: 'High-energy orange and pink for studios',
    primary: '#F97316',
    secondary: '#EC4899',
    preview: { dark: '#140F0B', light: '#FEFAF8' },
    tags: ['energy', 'studio', 'warm'],
  },
  royal_purple: {
    name: 'Royal Purple',
    description: 'Elegant purple for yoga and premium studios',
    primary: '#8B5CF6',
    secondary: '#F0A500',
    preview: { dark: '#0F0B14', light: '#FAF8FE' },
    tags: ['premium', 'yoga', 'elegant'],
  },
  stealth_mono: {
    name: 'Stealth',
    description: 'Minimalist monochrome for luxury gyms',
    primary: '#E4E4E7',
    secondary: '#71717A',
    preview: { dark: '#0A0A0B', light: '#FAFAFA' },
    tags: ['minimalist', 'luxury', 'monochrome'],
  },
  classic_gold: {
    name: 'Classic Gold',
    description: 'The original TuGymPR gold palette',
    primary: '#D4AF37',
    secondary: '#10B981',
    preview: { dark: '#0B0F14', light: '#FAFAF8' },
    tags: ['classic', 'original'],
  },
};

export const DEFAULT_PALETTE = 'obsidian_amber';

// Get palette by name, fallback to default
export function getPalette(name) {
  return PALETTES[name] || PALETTES[DEFAULT_PALETTE];
}

// Get all palette entries as array for UI rendering
export function getAllPalettes() {
  return Object.entries(PALETTES).map(([key, palette]) => ({
    id: key,
    ...palette,
  }));
}
