// Plugin-bundle scaffolding.
//
// The renderer supports optional markdown-extension bundles that are toggled as
// a unit (see docs/architecture.md → "Plugin Bundle Architecture"). Each bundle
// contributes remark plugins (mdast, before remark-rehype) and/or rehype plugins
// (hast, after rehype-slug but before rehype-sanitize). The processor is rebuilt
// — never patched in place — when the enabled set changes; pipeline.ts memoizes
// one frozen processor per enabled set.
//
// This module is the single registry. It ships with the four documented bundle
// slots wired but empty: enabling/disabling them is a no-op until real plugins
// are added to a bundle's `remarkPlugins` / `rehypePlugins`. That is deliberate
// — the toggle mechanism, persistence, and processor rebuild path are proven and
// tested now, so landing an actual extension later is a one-line registry edit
// with no plumbing changes.

import type { PluggableList } from 'unified'

export type BundleId =
  | 'r1-extended-inline'
  | 'r2-block-extensions'
  | 'r3-callouts'
  | 'r4-image-enhancements'

export interface Bundle {
  id: BundleId
  label: string
  features: string[]
  enabledByDefault: boolean
  // Factories (not shared instances) so each processor build gets fresh plugin
  // references — unified attaches per-processor state to a plugin on `use`.
  remarkPlugins: () => PluggableList
  rehypePlugins: () => PluggableList
}

export const BUNDLES: readonly Bundle[] = [
  {
    id: 'r1-extended-inline',
    label: 'Extended Inline',
    features: ['Superscript (^)', 'Subscript (~)', 'Highlight (==)'],
    enabledByDefault: true,
    remarkPlugins: () => [],
    rehypePlugins: () => [],
  },
  {
    id: 'r2-block-extensions',
    label: 'Block Extensions',
    features: ['Footnotes', 'Definition Lists', 'Abbreviations'],
    enabledByDefault: true,
    remarkPlugins: () => [],
    rehypePlugins: () => [],
  },
  {
    id: 'r3-callouts',
    label: 'Callouts',
    features: ['GitHub-style alert blockquotes (> [!NOTE])'],
    enabledByDefault: true,
    remarkPlugins: () => [],
    rehypePlugins: () => [],
  },
  {
    id: 'r4-image-enhancements',
    label: 'Image Enhancements',
    features: ['Image captions', 'Pandoc-style sizing ({width=N})'],
    enabledByDefault: true,
    remarkPlugins: () => [],
    rehypePlugins: () => [],
  },
] as const

export const BUNDLE_IDS: readonly BundleId[] = BUNDLES.map((b) => b.id)

export function isBundleId(value: string): value is BundleId {
  return (BUNDLE_IDS as readonly string[]).includes(value)
}

export function defaultEnabledBundles(): BundleId[] {
  return BUNDLES.filter((b) => b.enabledByDefault).map((b) => b.id)
}

// Collects the remark/rehype plugin lists contributed by the enabled bundles,
// preserving canonical bundle order for deterministic processor construction.
export function collectBundlePlugins(enabled: readonly BundleId[]): {
  remark: PluggableList
  rehype: PluggableList
} {
  const active = BUNDLES.filter((b) => enabled.includes(b.id))
  return {
    remark: active.flatMap((b) => b.remarkPlugins()),
    rehype: active.flatMap((b) => b.rehypePlugins()),
  }
}
