import { component$ } from "@builder.io/qwik";
import { Link, useLocation } from "@builder.io/qwik-city";
import type { PaginationInfo } from "~/lib/types";

interface PaginationProps {
  pagination: PaginationInfo;
}

export const Pagination = component$<PaginationProps>(({ pagination }) => {
  const loc = useLocation();
  const { page, totalPages } = pagination;

  const buildUrl = (targetPage: number) => {
    const params = new URLSearchParams(loc.url.search);
    params.set("page", String(targetPage));
    return `/?${params.toString()}`;
  };

  if (totalPages <= 1) return null;

  return (
    <nav class="pagination">
      {page > 1 ? (
        <Link class="pagination__link" href={buildUrl(page - 1)}>
          Prev
        </Link>
      ) : (
        <span class="pagination__link pagination__link--disabled">Prev</span>
      )}

      <span class="pagination__info">
        {page} / {totalPages}
      </span>

      {page < totalPages ? (
        <Link class="pagination__link" href={buildUrl(page + 1)}>
          Next
        </Link>
      ) : (
        <span class="pagination__link pagination__link--disabled">Next</span>
      )}
    </nav>
  );
});
