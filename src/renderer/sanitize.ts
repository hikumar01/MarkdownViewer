import { defaultSchema } from 'rehype-sanitize'
import type { Options } from 'rehype-sanitize'

const existingAll = (defaultSchema.attributes?.['*'] ?? []) as string[]

export const sanitizeOptions: Options = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,

    '*': [
      ...existingAll,
      // Shiki inlines all syntax token colors as `style` attributes on <span>
      // elements — blocking `style` would break syntax highlighting entirely.
      'style',
      // GFM task lists use .task-list-item; heading anchors use class names;
      // blocking class breaks GFM rendering.
      'class',
      'id',
    ],
  },
}
