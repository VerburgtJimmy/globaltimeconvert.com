<script lang="ts">
  // Theme toggle (DESIGN §11 future component, §13 a11y).
  // Lives right of the "Donate" link in the header. Toggles the .dark class
  // on <html> and persists the override in localStorage.
  // Anti-flash is handled by the inline script in Layout.astro head.

  let isDark = $state<boolean>(false);

  $effect(() => {
    // Read the resolved theme class set by the anti-flash script.
    isDark = document.documentElement.classList.contains('dark');

    // Sync if the OS preference changes AND there is no stored override.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        isDark = e.matches;
        document.documentElement.classList.toggle('dark', isDark);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  function toggle() {
    isDark = !isDark;
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    } catch {
      /* localStorage unavailable — toggle still works for the session */
    }
  }
</script>

<button
  type="button"
  onclick={toggle}
  aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
  aria-pressed={isDark}
  class="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
>
  {#if isDark}
    <!-- Moon — currentColor, 1.5 stroke (DESIGN §6) -->
    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  {:else}
    <!-- Sun — currentColor, 1.5 stroke -->
    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  {/if}
</button>
