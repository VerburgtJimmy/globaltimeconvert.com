<script lang="ts">
  // Homepage hero autocomplete (DESIGN §11 future component).
  //   - Shape inherits from the existing search input (h-14, rounded-xl, hairline).
  //   - Dropdown: hairline border, rounded-xl, divide-hair rows, hover bg-neutral-50.
  //   - 80ms opacity reveal (DESIGN §8 motion budget).
  //   - Loading state = skeleton row (DESIGN §9, never spinners).
  //   - Keyboard: ↑↓ navigate, Enter open, Esc close.
  //   - Global "/" focuses the input (matches the kbd hint already on /).

  interface Hit {
    slug: string;
    name_en: string;
    ascii_name: string;
    country: string;
    timezone_id: string;
  }

  let inputEl: HTMLInputElement | undefined = $state();
  let query = $state('');
  let results = $state<Hit[]>([]);
  let highlighted = $state(0);
  let open = $state(false);
  let loading = $state(false);
  let abort: AbortController | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  async function search(q: string) {
    if (q.trim().length < 2) {
      results = [];
      open = false;
      loading = false;
      return;
    }
    abort?.abort();
    abort = new AbortController();
    loading = true;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: abort.signal,
      });
      if (!res.ok) throw new Error('search failed');
      results = (await res.json()) as Hit[];
      open = true;
      highlighted = 0;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      results = [];
    } finally {
      loading = false;
    }
  }

  function onInput(e: Event) {
    query = (e.target as HTMLInputElement).value;
    clearTimeout(debounce);
    debounce = setTimeout(() => search(query), 150);
  }

  function go(hit: Hit) {
    window.location.href = `/time-in-${hit.slug}`;
  }

  function onKeydown(e: KeyboardEvent) {
    if (!open || results.length === 0) {
      if (e.key === 'Escape') {
        (e.target as HTMLInputElement).blur();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlighted = (highlighted + 1) % results.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = (highlighted - 1 + results.length) % results.length;
    } else if (e.key === 'Enter') {
      const pick = results[highlighted];
      if (pick) {
        e.preventDefault();
        go(pick);
      }
    } else if (e.key === 'Escape') {
      open = false;
    }
  }

  function onBlur() {
    // Delay so click on a result fires before we close the menu.
    setTimeout(() => (open = false), 100);
  }
  function onFocus() {
    if (results.length > 0) open = true;
  }

  $effect(() => {
    function focusKey(e: KeyboardEvent) {
      if (e.key !== '/') return;
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        (ae as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      inputEl?.focus();
    }
    document.addEventListener('keydown', focusKey);
    return () => document.removeEventListener('keydown', focusKey);
  });
</script>

<div class="relative">
  <label class="relative block">
    <span class="sr-only">Search a city</span>
    <svg
      class="pointer-events-none absolute top-1/2 left-4 h-[18px] w-[18px] -translate-y-1/2 text-neutral-400"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.5" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
    <input
      bind:this={inputEl}
      type="text"
      role="combobox"
      aria-expanded={open}
      aria-controls="city-search-listbox"
      aria-autocomplete="list"
      autocomplete="off"
      placeholder="Search a city — Tokyo, São Paulo, Auckland…"
      value={query}
      oninput={onInput}
      onkeydown={onKeydown}
      onblur={onBlur}
      onfocus={onFocus}
      class="h-14 w-full rounded-xl border border-hair bg-white pr-4 pl-12 text-[15px] placeholder:text-neutral-400 focus:border-accent-500 focus:outline-none dark:bg-neutral-950 dark:placeholder:text-neutral-500"
    />
  </label>

  {#if open && (loading || results.length > 0)}
    <ul
      id="city-search-listbox"
      role="listbox"
      class="absolute top-[calc(100%+8px)] right-0 left-0 z-50 overflow-hidden rounded-xl border border-hair bg-white text-left dark:bg-neutral-950"
      style="animation: city-search-fade 80ms ease-out forwards;"
    >
      {#if loading && results.length === 0}
        {#each Array(4) as _, i (i)}
          <li class="border-b border-hair px-4 py-3 last:border-b-0">
            <div class="h-4 w-32 rounded bg-neutral-100 dark:bg-neutral-900/60"></div>
            <div class="mt-2 h-3 w-20 rounded bg-neutral-100 dark:bg-neutral-900/60"></div>
          </li>
        {/each}
      {:else}
        {#each results as r, i (r.slug)}
          <li role="option" aria-selected={i === highlighted}>
            <a
              href={`/time-in-${r.slug}`}
              class={`block border-b border-hair px-4 py-3 last:border-b-0 ${
                i === highlighted ? 'bg-neutral-50 dark:bg-neutral-900/60' : ''
              }`}
              onmouseenter={() => (highlighted = i)}
              onmousedown={(e) => {
                e.preventDefault();
                go(r);
              }}
            >
              <div class="flex items-baseline justify-between gap-3">
                <span class="font-medium text-neutral-900 dark:text-neutral-100">
                  {r.name_en}
                </span>
                <span class="text-[12.5px] text-neutral-500 dark:text-neutral-400">
                  {r.country}
                </span>
              </div>
              <div class="mt-0.5 font-mono text-[12px] text-neutral-400 dark:text-neutral-500">
                {r.timezone_id}
              </div>
            </a>
          </li>
        {/each}
      {/if}
    </ul>
  {/if}
</div>

<style>
  @keyframes city-search-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  /* Reduced-motion handled globally via global.css §8 override. */
</style>
