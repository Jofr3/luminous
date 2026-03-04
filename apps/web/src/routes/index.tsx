import {
  $,
  component$,
  useSignal,
  useStore,
  useTask$,
  useVisibleTask$,
} from "@builder.io/qwik";
import {
  routeLoader$,
  useLocation,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { CardGrid } from "~/components/card-grid";
import { FilterSidebar } from "~/components/filter-sidebar";
import { SearchBar } from "~/components/search-bar";
import { fetchCards, fetchFilters } from "~/lib/api";
import type {
  CardListResponse,
  CardSummary,
  FilterOptions,
  SetSummary,
} from "~/lib/types";

const MIN_BATCH = 20;
const MAX_BATCH = 100;
const DEFAULT_BATCH = 40;

const API_URL = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";

/** All filter param keys that should be forwarded to the API */
const FILTER_KEYS = [
  "q",
  "category",
  "set",
  "rarity",
  "stage",
  "trainer_type",
  "energy_type",
  "retreat",
  "hp_min",
  "hp_max",
  "types",
  "weakness",
  "resistance",
  "legal_standard",
  "legal_expanded",
] as const;

function collectFilterParams(searchParams: URLSearchParams) {
  const result: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const val = searchParams.get(key);
    if (val) result[key] = val;
  }
  return result;
}

export const useCardData = routeLoader$<CardListResponse>(
  async (requestEvent) => {
    const params = collectFilterParams(requestEvent.url.searchParams);
    return fetchCards({ ...params, limit: DEFAULT_BATCH, offset: 0 });
  },
);

export const useFilterOptions = routeLoader$<FilterOptions>(async () => {
  return fetchFilters();
});

export const useSetsData = routeLoader$<SetSummary[]>(async () => {
  const res = await fetch(`${API_URL}/api/sets`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
});

export default component$(() => {
  const cardData = useCardData();
  const filterOptions = useFilterOptions();
  const setsData = useSetsData();
  const loc = useLocation();

  const store = useStore<{
    cards: CardSummary[];
    total: number;
    hasMore: boolean;
    offset: number;
    loading: boolean;
  }>({
    cards: [],
    total: 0,
    hasMore: false,
    offset: 0,
    loading: false,
  });

  const sentinelRef = useSignal<HTMLDivElement>();

  // Sync store from routeLoader whenever URL params change (SSR + client nav)
  useTask$(({ track }) => {
    track(() => cardData.value);
    store.cards = [...cardData.value.data];
    store.total = cardData.value.total;
    store.hasMore = cardData.value.hasMore;
    store.offset = cardData.value.data.length;
    store.loading = false;
  });

  const loadMore = $(async (batchSize: number = DEFAULT_BATCH) => {
    if (store.loading || !store.hasMore) return;
    store.loading = true;

    const params = collectFilterParams(loc.url.searchParams);

    try {
      const res = await fetchCards({
        ...params,
        limit: batchSize,
        offset: store.offset,
      });
      store.cards = [...store.cards, ...res.data];
      store.offset = store.offset + res.data.length;
      store.hasMore = res.hasMore;
      store.total = res.total;
    } finally {
      store.loading = false;
    }
  });

  // Track scroll speed and load adaptive batch sizes
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const el = sentinelRef.value;
    if (!el) return;

    let lastScrollY = window.scrollY;
    let lastTime = performance.now();
    let speed = 0; // px/s

    const onScroll = () => {
      const now = performance.now();
      const dt = now - lastTime;
      if (dt > 0) {
        speed = (Math.abs(window.scrollY - lastScrollY) / dt) * 1000;
      }
      lastScrollY = window.scrollY;
      lastTime = now;
    };

    window.addEventListener("scroll", onScroll, { passive: true });

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          // Map speed to batch size: slow scroll → small batch, fast → large
          const t = Math.min(speed / 3000, 1); // normalize: 0–3000 px/s → 0–1
          const batch = Math.round(MIN_BATCH + t * (MAX_BATCH - MIN_BATCH));
          loadMore(batch);
        }
      },
      { rootMargin: "800px" },
    );

    observer.observe(el);
    cleanup(() => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    });
  });

  return (
    <div>
      <SearchBar />
      <div class="browse-layout">
        <FilterSidebar
          filterOptions={filterOptions.value}
          sets={setsData.value}
        />
        <main class="browse-main">
          <div class="browse-status">
            <span class="browse-status__count">
              {store.cards.length} of {store.total} cards
            </span>
          </div>
          <CardGrid cards={store.cards} />
          {store.loading && (
            <div class="load-more-spinner">
              <div class="spinner" />
            </div>
          )}
          <div ref={sentinelRef} style={{ height: "1px" }} />
        </main>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Luminous — Pokemon TCG Browser",
  meta: [
    {
      name: "description",
      content:
        "Browse and search the Pokemon Trading Card Game collection",
    },
  ],
};
