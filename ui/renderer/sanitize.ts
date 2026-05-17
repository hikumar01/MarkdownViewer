import { defaultSchema } from 'rehype-sanitize'
import type { Options } from 'rehype-sanitize'

const existingAll = (defaultSchema.attributes?.['*'] ?? []) as string[]

// Helpers to merge per-element allow-lists without dropping defaults.
const elem = (tag: string) =>
  [...((defaultSchema.attributes?.[tag] ?? []) as string[])]

export const sanitizeOptions: Options = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,

    '*': [
      ...existingAll,
      // GFM task lists use .task-list-item; heading anchors use class names;
      // blocking className breaks GFM rendering. rehype-sanitize uses HAST
      // property names ('className'), not HTML attribute names ('class').
      'className',
      // 'style' is intentionally NOT allowed globally — see span/pre below.
      // 'id' is intentionally NOT allowed globally — see h1-h6 below.
    ],

    // Shiki inlines all syntax token colors as `style` on <span> elements and
    // background colors as `style` on <pre>. Allow only on these two tags.
    span: [...elem('span'), 'style'],
    pre:  [...elem('pre'),  'style', 'className'],

    // Allow id on headings only — used for in-page anchor navigation.
    h1: [...elem('h1'), 'id'],
    h2: [...elem('h2'), 'id'],
    h3: [...elem('h3'), 'id'],
    h4: [...elem('h4'), 'id'],
    h5: [...elem('h5'), 'id'],
    h6: [...elem('h6'), 'id'],
  },

  protocols: {
    ...defaultSchema.protocols,
    // markdownviewer:// is the custom scheme used by the Rust protocol handler
    // to serve local images. Without this, rehype-sanitize strips the scheme
    // from every img src, silently breaking all relative local images.
    src: [...(defaultSchema.protocols?.src ?? []), 'markdownviewer'],
  },
}
