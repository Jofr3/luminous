import { component$, Slot } from "@builder.io/qwik";

export default component$(() => {
  return (
    <>
      <header class="site-nav-wrap">
        <nav class="site-nav container">
          <a href="/" class="site-nav__link">Browse</a>
          <a href="/simulator" class="site-nav__link">Simulator</a>
        </nav>
      </header>
      <main class="container">
        <Slot />
      </main>
    </>
  );
});
