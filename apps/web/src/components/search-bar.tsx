import { component$, useSignal } from "@builder.io/qwik";
import { useLocation, useNavigate } from "@builder.io/qwik-city";

export const SearchBar = component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const query = useSignal(loc.url.searchParams.get("q") ?? "");

  return (
    <form
      class="search-bar"
      preventdefault:submit
      onSubmit$={() => {
        const params = new URLSearchParams();
        if (query.value.trim()) {
          params.set("q", query.value.trim());
        }
        nav(`/?${params.toString()}`);
      }}
    >
      <input
        class="search-bar__input"
        type="text"
        placeholder="Search cards by name..."
        bind:value={query}
      />
      <button class="search-bar__button" type="submit">
        Search
      </button>
    </form>
  );
});
