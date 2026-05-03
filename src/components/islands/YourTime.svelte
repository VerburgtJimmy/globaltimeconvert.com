<script lang="ts">
  // Client-side "your time" island (Phase 6).
  //
  // Privacy-by-design: detection runs entirely on the client via
  // Intl.DateTimeFormat().resolvedOptions().timeZone. The server never
  // learns the user's timezone — pages stay edge-cacheable across users.
  //
  // Brief delay (~50ms post-hydration) is acceptable; the SSR fallback
  // shows a hairline skeleton so layout doesn't shift.

  interface Props {
    /** ISO UTC moment to convert (e.g. "9 AM Miami today"). */
    momentIso: string;
    /**
     * Optional source label for context, e.g. "9 AM in Miami" — included
     * inline so the line reads "9 AM in Miami is X:XX in your timezone".
     */
    sourceLabel?: string;
  }

  let { momentIso, sourceLabel }: Props = $props();

  let userTz = $state<string | null>(null);
  let displayTime = $state('');
  let displayDate = $state('');
  let dayShift = $state<'before' | 'same' | 'after'>('same');

  $effect(() => {
    try {
      userTz = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      userTz = 'UTC';
    }

    const at = new Date(momentIso);
    if (Number.isNaN(at.getTime())) return;

    const fmtTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: userTz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const fmtDate = new Intl.DateTimeFormat('en-US', {
      timeZone: userTz,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    displayTime = fmtTime.format(at);
    displayDate = fmtDate.format(at);

    // Day-shift detection vs the source moment's UTC date.
    const utcWeekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
    }).format(at);
    const userWeekday = new Intl.DateTimeFormat('en-US', {
      timeZone: userTz,
      weekday: 'short',
    }).format(at);
    if (userWeekday !== utcWeekday) {
      // Determine direction by comparing wall-clock dates.
      const utcDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(at);
      const userDate = new Intl.DateTimeFormat('en-CA', { timeZone: userTz }).format(at);
      dayShift = userDate < utcDate ? 'before' : 'after';
    } else {
      dayShift = 'same';
    }
  });
</script>

<section class="rounded-2xl border border-hair p-7">
  <div class="mb-4 flex items-baseline justify-between">
    <span class="eyebrow">Your time</span>
    {#if userTz}
      <span class="font-mono text-[12px] text-neutral-400 dark:text-neutral-500">{userTz}</span>
    {/if}
  </div>

  {#if userTz && displayTime}
    <div class="display-time text-5xl leading-none sm:text-6xl">{displayTime}</div>
    <p class="mt-3 text-[14px] text-neutral-500 dark:text-neutral-400">
      {displayDate}
      {#if dayShift !== 'same'}
        <span class="text-accent-600">
          {dayShift === 'after' ? '(next day)' : '(previous day)'}
        </span>
      {/if}
    </p>
    {#if sourceLabel}
      <p class="mt-4 text-[13.5px] text-neutral-500 dark:text-neutral-400">
        {sourceLabel} in your timezone.
      </p>
    {/if}
  {:else}
    <!-- Skeleton: matches the eventual layout's height to prevent CLS. -->
    <div class="h-[60px] w-40 rounded bg-neutral-100 dark:bg-neutral-900/60 sm:h-[72px]"></div>
    <div class="mt-3 h-4 w-56 rounded bg-neutral-100 dark:bg-neutral-900/60"></div>
  {/if}
</section>
