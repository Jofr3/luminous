import { $, component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { useLocation, useNavigate } from "@builder.io/qwik-city";

export const SearchBar = component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const query = useSignal(loc.url.searchParams.get("q") ?? "");
  const timerRef = useSignal<number>();

  const doSearch = $((value: string) => {
    const params = new URLSearchParams();
    const trimmed = value.trim();
    if (trimmed) {
      params.set("q", trimmed);
    }
    nav(`/?${params.toString()}`);
  });

  // Sync query signal when URL changes (e.g. browser back/forward)
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => loc.url.searchParams.get("q"));
    query.value = loc.url.searchParams.get("q") ?? "";
  });

  return (
    <div class="search-bar">
      <input
        class="search-bar__input"
        type="text"
        placeholder="Search cards by name..."
        value={query.value}
        onInput$={(_, el) => {
          query.value = el.value;
          if (timerRef.value) clearTimeout(timerRef.value);
          timerRef.value = setTimeout(() => doSearch(el.value), 150) as unknown as number;
        }}
      />
    </div>
  );
});
