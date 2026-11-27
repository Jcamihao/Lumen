import { sanitizeExternalText } from '../../text/sanitize';

export function categoryLabel(category: { name: string } | null | undefined) {
  return category?.name ? sanitizeExternalText(category.name) : undefined;
}
