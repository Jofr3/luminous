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
import { SearchBar } from "~/components/search-bar";
import { fetchCards } from "~/lib/api";
import type { CardListResponse, CardSummary } from "~/lib/types";

const MIN_BATCH = 20;
const MAX_BATCH = 100;
const DEFAULT_BATCH = 40;

export const useCardData = routeLoader$<CardListResponse>(
  async (requestEvent) => {
    const q = requestEvent.query.get("q") || "";
    const category = requestEvent.query.get("category") || "";
    const set = requestEvent.query.get("set") || "";

    return fetchCards({ q, category, set, limit: DEFAULT_BATCH, offset: 0 });
  },
);

export default component$(() => {
  const cardData = useCardData();
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

    const q = loc.url.searchParams.get("q") || "";
    const category = loc.url.searchParams.get("category") || "";
    const set = loc.url.searchParams.get("set") || "";

    try {
      const res = await fetchCards({
        q,
        category,
        set,
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
      <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
        {store.total.toLocaleString()} cards found
      </p>
      <CardGrid cards={store.cards} />
      {store.loading && (
        <div class="load-more-spinner">
          <div class="spinner" />
        </div>
      )}
      <div ref={sentinelRef} style={{ height: "1px" }} />
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
