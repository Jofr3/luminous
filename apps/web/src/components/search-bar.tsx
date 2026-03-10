import { useEffect, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";

interface SearchBarProps {
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}

export function SearchBar({ searchParams, setSearchParams }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.value = searchParams.get("q") ?? "";
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const doSearch = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = value.trim();
    if (trimmed) {
      params.set("q", trimmed);
    } else {
      params.delete("q");
    }
    params.delete("offset");
    setSearchParams(params);
  };

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        className="search-bar__input"
        type="text"
        placeholder="Search cards by name..."
        onInput={(e) => {
          if (timerRef.current) {
            window.clearTimeout(timerRef.current);
          }
          const target = e.target as HTMLInputElement;
          timerRef.current = window.setTimeout(() => doSearch(target.value), 150);
        }}
      />
    </div>
  );
}
