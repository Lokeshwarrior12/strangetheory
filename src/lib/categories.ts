import type { Category } from './types.js';

export const CATEGORIES: Category[] = [
  {
    id: 'cat-physics',
    name: 'Physics & Cosmos',
    slug: 'physics-cosmos',
    brain_region: 'Prefrontal Cortex',
    color: '#38BDF8', // luminous sky cyan
    description: 'Thermodynamics, fine-tuning, cosmic horizons, and counterfactual laws of nature.',
    position: [0.0, 0.55, 1.32],
  },
  {
    id: 'cat-consciousness',
    name: 'Consciousness & Mind',
    slug: 'consciousness-mind',
    brain_region: 'Parietal Lobe',
    color: '#F59E0B', // synapse amber
    description: 'Qualia, split-brain identity, memory compression, and subjective time.',
    position: [0.88, 0.92, -0.18],
  },
  {
    id: 'cat-ethics',
    name: 'Ethics & Society',
    slug: 'ethics-society',
    brain_region: 'Anterior Cingulate',
    color: '#FB7185', // coral rose
    description: 'Moral geometry, collective coordination, intergenerational justice, and trust.',
    position: [-0.82, 0.42, 0.86],
  },
  {
    id: 'cat-time',
    name: 'Time & Paradox',
    slug: 'time-paradox',
    brain_region: 'Temporal Lobe',
    color: '#818CF8', // luminous indigo-violet
    description: 'Closed timelike curves, causal loops, entropy arrows, and pre-commitment.',
    position: [1.18, -0.12, 0.25],
  },
  {
    id: 'cat-biology',
    name: 'Biology & Evolution',
    slug: 'biology-evolution',
    brain_region: 'Hippocampus',
    color: '#34D399', // bioluminescent emerald
    description: 'Convergent intelligence, cellular memory, symbiosis, and planetary ecosystems.',
    position: [-1.14, -0.15, 0.18],
  },
  {
    id: 'cat-systems',
    name: 'Systems & Economics',
    slug: 'systems-economics',
    brain_region: 'Basal Ganglia',
    color: '#2DD4BF', // bright teal
    description: 'Mechanism design, post-scarcity incentives, feedback cascades, and equilibria.',
    position: [0.76, 0.35, 0.85],
  },
  {
    id: 'cat-language',
    name: 'Language & Logic',
    slug: 'language-logic',
    brain_region: "Broca's Area",
    color: '#F472B6', // electric magenta-rose
    description: 'Self-reference, epistemic paradoxes, syntax constraints, and lateral wordplay.',
    position: [-0.86, 0.88, -0.22],
  },
  {
    id: 'cat-computation',
    name: 'AI & Computation',
    slug: 'ai-computation',
    brain_region: 'Neural Core',
    color: '#22D3EE', // electric synapse cyan
    description: 'Compression limits, alignment games, emergent protocols, and undecidability.',
    position: [0.0, 0.12, 0.0],
  },
  {
    id: 'cat-math',
    name: 'Mathematics & Infinity',
    slug: 'mathematics-infinity',
    brain_region: 'Cerebellum',
    color: '#A78BFA', // synapse violet
    description: 'Countable infinities, topological surprises, probability puzzles, and invariants.',
    position: [0.58, -0.68, -1.02],
  },
  {
    id: 'cat-history',
    name: 'History & Counterfactuals',
    slug: 'history-counterfactuals',
    brain_region: 'Occipital Lobe',
    color: '#FBBF24', // warm gold
    description: 'Divergent timelines, civilizational bottlenecks, and counterfactual inventions.',
    position: [-0.52, 0.15, -1.25],
  },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));
