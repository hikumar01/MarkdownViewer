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
      // blocking class breaks GFM rendering.
      'class',
      // 'style' is intentionally NOT allowed globally — see span/pre below.
      // 'id' is intentionally NOT allowed globally — see h1-h6 below.
    ],

    // Shiki inlines all syntax token colors as `style` on <span> elements and
    // background colors as `style` on <pre>. Allow only on these two tags.
    span: [...elem('span'), 'style'],
    pre:  [...elem('pre'),  'style'],

    // Allow id on headings only — used for in-page anchor navigation.
    h1: [...elem('h1'), 'id'],
    h2: [...elem('h2'), 'id'],
    h3: [...elem('h3'), 'id'],
    h4: [...elem('h4'), 'id'],
    h5: [...elem('h5'), 'id'],
    h6: [...elem('h6'), 'id'],
  },
}
