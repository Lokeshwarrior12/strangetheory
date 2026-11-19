export const APP_NAME = 'StrangeTheory';
export const APP_TAGLINE = 'Structured thought experiments & lateral riddles';
export const APP_DESCRIPTION =
  'A dark-mode intellectual observatory where thinkers publish structured thought experiments, test edge cases through three analytical lenses, and solve spoiler-protected riddles.';
export const LEGAL_LAST_UPDATED = 'November 16, 2026';
export const DEFAULT_CONTACT_EMAIL =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CONTACT_EMAIL) ||
  'support@strangetheory.app';

export const FOCUS_LIMITS = {
  HOME_FEATURED: 1,
  HOME_TRENDING: 6,
  HOME_RECENT: 6,
  HOME_FOR_YOU: 6,
  EXPLORE_PAGE_SIZE: 12,
  COMMENTS_PAGE_SIZE: 5,
  NOTIFICATIONS_MAX: 20,
  MAX_COLLECTIONS_PER_USER: 10,
  MAX_ITEMS_PER_COLLECTION: 50,
  MAX_BRAIN_BADGES: 12,
  BRAIN_BADGES_PREVIEW: 3,
  MAX_COMMENT_LENGTH: 1000,
  MAX_INTRO_LENGTH: 280,
  MAX_ACTIVE_CATEGORIES: 2,
  GRAPH_MAX_NODES: 150,
  DAILY_PUBLISH_LIMIT: 2,
  HOURLY_COMMENT_LIMIT: 30,
  NEW_ACCOUNT_COMMENT_LIMIT: 5,
  HOURLY_REACTION_LIMIT: 120,
  DAILY_REPORT_LIMIT: 10,
  NEW_ACCOUNT_HOURS: 24,
} as const;

export const COVER_PRESETS = [
  { label: 'Neural Synapse', url: '/covers/cover_neural_synapse_1794881588195.jpg' },
  { label: 'Quantum Lattice', url: '/covers/cover_quantum_lattice_1794881588323.jpg' },
  { label: 'Temporal Pendulum', url: '/covers/cover_temporal_pendulum_1794881589067.jpg' },
  { label: 'Babel Archive', url: '/covers/cover_babel_archive_1794881590081.jpg' },
  { label: 'Cosmic Horizon', url: '/covers/cover_cosmos_horizon_1794879385285.jpg' },
  { label: 'Brass Astrolabe', url: '/covers/cover_time_paradox_1794879386636.jpg' },
  { label: 'Optical Prism', url: '/covers/cover_consciousness_prism_1794879386697.jpg' },
  { label: 'Geometric Polyhedra', url: '/covers/cover_riddle_polyhedra_1794879386576.jpg' },
] as const;

export const PERSPECTIVES = ['Past', 'Present', 'Future', 'Timeless'] as const;
export const THINKING_STYLES = ['Science-backed', 'Plausible', 'Speculative', 'Wild imagination'] as const;

export const REPORT_REASONS = [
  'Harassment or personal attack',
  'Spam, promotional link, or automated noise',
  'Plagiarism or unattributed copy',
  'Misinformation presented as established fact',
  'Riddle spoiler posted outside the Answers thread',
  'Off-topic or low-effort disruption',
] as const;
