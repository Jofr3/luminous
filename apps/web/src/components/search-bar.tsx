import { $, component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { useLocation, useNavigate } from "@builder.io/qwik-city";

export const SearchBar = component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const inputRef = useSignal<HTMLInputElement>();
  const timerRef = useSignal<number>();
  const selfNav = useSignal(false);

  const doSearch = $((value: string) => {
    const params = new URLSearchParams(loc.url.searchParams.toString());
    const trimmed = value.trim();
    if (trimmed) {
      params.set("q", trimmed);
    } else {
      params.delete("q");
    }
    params.delete("offset");
    selfNav.value = true;
    nav(`/?${params.toString()}`);
  });

  // Sync input value only on external URL changes (browser back/forward)
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => loc.url.searchParams.get("q"));
    if (selfNav.value) {
      selfNav.value = false;
      return;
    }
    const el = inputRef.value;
    if (el) {
      el.value = loc.url.searchParams.get("q") ?? "";
    }
  });

  return (
    <div class="search-bar">
      <input
        ref={inputRef}
        class="search-bar__input"
        type="text"
        placeholder="Search cards by name..."
        onInput$={(_, el) => {
          if (timerRef.value) clearTimeout(timerRef.value);
          timerRef.value = setTimeout(() => doSearch(el.value), 150) as unknown as number;
        }}
      />
    </div>
  );
});
