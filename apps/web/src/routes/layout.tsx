import { component$, Slot } from "@builder.io/qwik";

export default component$(() => {
  return (
    <>
      <header>
        <div class="container">
          <h1>
            Luminous<span>Pokemon TCG Browser</span>
          </h1>
        </div>
      </header>
      <main class="container">
        <Slot />
      </main>
    </>
  );
});
