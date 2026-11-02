import { Badge } from "@/components/ui/badge";

export interface SpecialtyTagsProps {
  tags: readonly string[];
  /** Names the list for a screen reader when it sits in a cell or a card with no heading of its own. */
  label?: string | undefined;
}

/**
 * A technician's specialties as small tags. A tag can be 40 characters with no space in it, so each
 * one may shrink to the width it is given and break anywhere (`break-words` alone would keep its
 * longest word whole and widen the page, which only a long enough tag shows).
 */
export function SpecialtyTags({ tags, label }: SpecialtyTagsProps) {
  return (
    <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={label}>
      {tags.map((tag) => (
        <li key={tag} className="min-w-0 max-w-full">
          <Badge
            tone="neutral"
            className="max-w-full shrink whitespace-normal [overflow-wrap:anywhere]"
          >
            {tag}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
