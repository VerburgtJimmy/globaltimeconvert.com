<script lang="ts">
  // Time slider (DESIGN §11 future component, §8 motion budget).
  //   - Track 3px high, neutral-200/800 background, accent-500 fill left of handle.
  //   - Handle 24px circle, hairline border + soft accent halo.
  //   - Hour ticks every 3h, taller at 0/6/12/18/24.
  //   - 30-min snap.
  //   - ≤120ms transform on handle/fill (disabled while dragging for 1:1 feedback).
  //   - Keyboard: arrows ±30min, shift+arrows ±1h, Home/End.
  //   - SSR-safe: initial anchor passed in as a prop so server + client render
  //     identically before hydration.

  interface Props {
    fromTz: string;
    toTz: string;
    fromCity: string;
    toCity: string;
    /** Wall-clock minute in fromTz (0–1410, must be a multiple of 30). */
    initialAnchorMin: number;
    /**
     * Page locale — drives the 12h vs 24h readout style. English uses
     * AM/PM ("2:30 PM"); every other locale uses 24h ("14:30").
     */
    lang?: string;
  }

  let { fromTz, toTz, fromCity, toCity, initialAnchorMin, lang = 'en' }: Props = $props();
  const ampm = lang === 'en';

  function fmtClock(h: number, mm: number): string {
    if (!ampm) {
      return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const sfx = h < 12 ? 'AM' : 'PM';
    return `${h12}:${String(mm).padStart(2, '0')} ${sfx}`;
  }

  const STEP = 30;
  const RANGE = 1440; // minutes in a day

  // Capture the initial-only value (the prop's initial-render value is exactly
  // what we want; subsequent user drags own the state). The svelte-ignore
  // comment suppresses the false-positive `state_referenced_locally` warning.
  // svelte-ignore state_referenced_locally
  let anchorMin = $state(initialAnchorMin);
  let trackEl: HTMLDivElement;
  let dragging = $state(false);

  // ---------------------------------------------------------------------------
  // Conversion math — given anchorMin in fromTz, what's the wall-clock in toTz?
  // ---------------------------------------------------------------------------
  function offsetMin(date: Date, tz: string): number {
    const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const local = new Date(date.toLocaleString('en-US', { timeZone: tz }));
    return Math.round((local.getTime() - utc.getTime()) / 60_000);
  }

  function todayIn(tz: string): { y: number; m: number; d: number } {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
    return { y: y!, m: m!, d: d! };
  }

  function periodLabel(hour: number, weekday: string): string {
    const part =
      hour < 5 ? 'night' :
      hour < 12 ? 'morning' :
      hour < 17 ? 'afternoon' :
      hour < 21 ? 'evening' : 'night';
    return `${weekday} ${part}`;
  }

  function aReadout(min: number) {
    const h = Math.floor(min / 60);
    const mm = min % 60;
    const today = todayIn(fromTz);
    const utc = Date.UTC(today.y, today.m - 1, today.d, h, mm);
    const moment = new Date(utc - offsetMin(new Date(utc), fromTz) * 60_000);
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: fromTz,
      weekday: 'long',
    }).format(moment);
    return {
      moment,
      str: fmtClock(h, mm),
      hint: periodLabel(h, weekday),
    };
  }

  function bReadout(aMoment: Date, aWeekday: string) {
    // Always extract hour/minute in 24h form so the day-shift / period-label
    // logic stays simple; we re-format for display via fmtClock.
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: toTz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'long',
    });
    const parts = fmt.formatToParts(aMoment);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const h = Number.parseInt(get('hour'), 10);
    const mm = Number.parseInt(get('minute'), 10);
    const weekday = get('weekday');
    const dayShift = weekday !== aWeekday;
    return {
      str: fmtClock(h, mm),
      hint: periodLabel(h, weekday) + (dayShift ? ' (next day)' : ''),
    };
  }

  let aOut = $derived.by(() => aReadout(anchorMin));
  let aWeekday = $derived(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fromTz,
      weekday: 'long',
    }).format(aOut.moment),
  );
  let bOut = $derived(bReadout(aOut.moment, aWeekday));
  let pct = $derived((anchorMin / RANGE) * 100);

  // ---------------------------------------------------------------------------
  // Pointer interaction — pointer events handle mouse + touch + pen uniformly.
  // ---------------------------------------------------------------------------
  function snapFromClientX(clientX: number): number {
    if (!trackEl) return anchorMin;
    const rect = trackEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const m = Math.round((ratio * RANGE) / STEP) * STEP;
    return Math.min(m, RANGE - STEP);
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    anchorMin = snapFromClientX(e.clientX);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    anchorMin = snapFromClientX(e.clientX);
  }
  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onKey(e: KeyboardEvent) {
    let dx = 0;
    const big = e.shiftKey;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') dx = big ? 60 : STEP;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') dx = big ? -60 : -STEP;
    else if (e.key === 'Home') {
      e.preventDefault();
      anchorMin = 0;
      return;
    } else if (e.key === 'End') {
      e.preventDefault();
      anchorMin = RANGE - STEP;
      return;
    }
    if (dx === 0) return;
    e.preventDefault();
    anchorMin = Math.max(0, Math.min(RANGE - STEP, anchorMin + dx));
  }

  function resetToNow() {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: fromTz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const [hh, mm] = fmt.format(new Date()).split(':').map(Number);
    anchorMin = Math.round((hh! * 60 + mm!) / STEP) * STEP;
  }
</script>

<section class="mx-auto max-w-4xl border-t border-hair px-6 py-12">
  <div class="mb-5 flex items-baseline justify-between">
    <h2 class="eyebrow">Pick a time</h2>
    <button
      type="button"
      onclick={resetToNow}
      class="text-[12px] text-neutral-500 transition-colors hover:text-accent-600 dark:text-neutral-400"
    >
      Reset to now
    </button>
  </div>

  <div class="rounded-2xl border border-hair p-7 sm:p-8">
    <!-- Track (entire surface is the slider; the handle just visualizes position) -->
    <div
      bind:this={trackEl}
      role="slider"
      tabindex="0"
      aria-label={`Convert ${fromCity} time to ${toCity} time`}
      aria-valuemin={0}
      aria-valuemax={RANGE - STEP}
      aria-valuenow={anchorMin}
      aria-valuetext={`${aOut.str} in ${fromCity}`}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onkeydown={onKey}
      class="relative h-10 cursor-pointer touch-none select-none"
    >
      <!-- background track -->
      <div class="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-neutral-200 dark:bg-neutral-800"></div>
      <!-- accent fill -->
      <div
        class={`absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full bg-accent-500 ${dragging ? '' : 'tween'}`}
        style:width={`${pct}%`}
      ></div>
      <!-- hour ticks (every 3h taller) -->
      <div class="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between">
        {#each Array(25) as _, i (i)}
          <span
            class={`block w-px ${i % 3 === 0 ? 'h-2' : 'h-1'} bg-neutral-300 dark:bg-neutral-700`}
          ></span>
        {/each}
      </div>
      <!-- handle -->
      <div
        class={`pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-hair bg-white shadow-[0_0_0_4px_oklch(0.62_0.19_252_/_0.18)] dark:bg-neutral-100 ${dragging ? '' : 'tween'}`}
        style:left={`${pct}%`}
      ></div>
    </div>

    <!-- hour labels -->
    <div class="tnum mt-3 flex justify-between text-[11px] text-neutral-400 dark:text-neutral-500">
      <span>00</span>
      <span class="hidden sm:inline">03</span>
      <span>06</span>
      <span class="hidden sm:inline">09</span>
      <span>12</span>
      <span class="hidden sm:inline">15</span>
      <span>18</span>
      <span class="hidden sm:inline">21</span>
      <span>24</span>
    </div>

    <!-- readouts -->
    <div class="mt-7 grid grid-cols-2 gap-6">
      <div>
        <div class="eyebrow mb-1.5">{fromCity}</div>
        <div class="display-time text-2xl tnum">{aOut.str}</div>
        <div class="mt-1 text-[12.5px] text-neutral-500 dark:text-neutral-400">{aOut.hint}</div>
      </div>
      <div>
        <div class="eyebrow mb-1.5">{toCity}</div>
        <div class="display-time text-2xl tnum">{bOut.str}</div>
        <div class="mt-1 text-[12.5px] text-neutral-500 dark:text-neutral-400">{bOut.hint}</div>
      </div>
    </div>
  </div>
</section>

<style>
  /* DESIGN §8: ≤120ms transform on handle/fill, disabled while dragging for
   * 1:1 feedback. Reduced-motion handled globally in global.css. */
  .tween {
    transition: left 100ms ease, width 100ms ease;
  }
</style>
