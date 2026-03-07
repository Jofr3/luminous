import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CardGrid } from "~/components/card-grid";
import { FilterSidebar } from "~/components/filter-sidebar";
import { SearchBar } from "~/components/search-bar";
import { API_URL, fetchCards, fetchFilters } from "~/lib/api";
import type {
  CardSummary,
  FilterOptions,
  SetSummary,
} from "~/lib/types";

const MIN_BATCH = 20;
const MAX_BATCH = 100;
const DEFAULT_BATCH = 40;

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

const emptyFilters: FilterOptions = {
  categories: [],
  rarities: [],
  stages: [],
  trainer_types: [],
  energy_types: [],
  types: [],
  weaknesses: [],
  resistances: [],
  retreats: [],
  hp: { min: 0, max: 0 },
  regulation_marks: [],
};

export function BrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(emptyFilters);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetchFilters().then(setFilterOptions).catch(console.error);
    void fetch(`${API_URL}/api/sets`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((json) => setSets(json.data ?? []))
      .catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = collectFilterParams(searchParams);

    void fetchCards({ ...params, limit: DEFAULT_BATCH, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        setCards(res.data);
        setOffset(res.data.length);
        setTotal(res.total);
        setHasMore(res.hasMore);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const loadMore = useCallback(
    async (batchSize = DEFAULT_BATCH) => {
      if (loading || !hasMore) return;
      setLoading(true);
      const params = collectFilterParams(searchParams);
      try {
        const res = await fetchCards({ ...params, limit: batchSize, offset });
        setCards((prev) => [...prev, ...res.data]);
        setOffset((prev) => prev + res.data.length);
        setHasMore(res.hasMore);
        setTotal(res.total);
      } finally {
        setLoading(false);
      }
    },
    [hasMore, loading, offset, searchParams],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    let lastScrollY = window.scrollY;
    let lastTime = performance.now();
    let speed = 0;

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
        if (!entries[0].isIntersecting) return;
        const t = Math.min(speed / 3000, 1);
        const batch = Math.round(MIN_BATCH + t * (MAX_BATCH - MIN_BATCH));
        void loadMore(batch);
      },
      { rootMargin: "800px" },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [loadMore]);

  return (
    <div>
      <SearchBar searchParams={searchParams} setSearchParams={setSearchParams} />
      <div className="browse-layout">
        <FilterSidebar
          filterOptions={filterOptions}
          sets={sets}
          searchParams={searchParams}
          setSearchParams={setSearchParams}
        />
        <main className="browse-main">
          <div className="browse-status">
            <span className="browse-status__count">
              {cards.length} of {total} cards
            </span>
          </div>
          <CardGrid cards={cards} />
          {loading && (
            <div className="load-more-spinner">
              <div className="spinner" />
            </div>
          )}
          <div ref={sentinelRef} style={{ height: "1px" }} />
        </main>
      </div>
    </div>
  );
}
