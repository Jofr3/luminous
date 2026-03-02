import { component$ } from "@builder.io/qwik";
import { routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
import { CardGrid } from "~/components/card-grid";
import { Pagination } from "~/components/pagination";
import { SearchBar } from "~/components/search-bar";
import { fetchCards } from "~/lib/api";
import type { CardListResponse } from "~/lib/types";

export const useCardData = routeLoader$<CardListResponse>(async (requestEvent) => {
  const page = Number(requestEvent.query.get("page")) || 1;
  const q = requestEvent.query.get("q") || "";
  const category = requestEvent.query.get("category") || "";
  const set = requestEvent.query.get("set") || "";

  return fetchCards({ page, limit: 40, q, category, set });
});

export default component$(() => {
  const cardData = useCardData();
  const { data: cards, pagination } = cardData.value;

  return (
    <div>
      <SearchBar />
      <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
        {pagination.total.toLocaleString()} cards found — Page {pagination.page} of{" "}
        {pagination.totalPages}
      </p>
      <CardGrid cards={cards} />
      <Pagination pagination={pagination} />
    </div>
  );
});

export const head: DocumentHead = {
  title: "Luminouse — Pokemon TCG Browser",
  meta: [
    {
      name: "description",
      content: "Browse and search the Pokemon Trading Card Game collection",
    },
  ],
};
