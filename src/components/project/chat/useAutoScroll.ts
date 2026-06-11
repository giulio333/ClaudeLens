import { useCallback, useLayoutEffect, useRef } from 'react'
import type { UIEvent, WheelEvent } from 'react'

/** How close to the bottom (px) still counts as "anchored" — wide enough to
 *  absorb sub-line layout jitter, narrow enough that deliberately scrolling
 *  away wins over an incoming pin. */
const NEAR_BOTTOM_PX = 200

/** Bottom-pinning for a chat feed, robust across MIN/FULL densities and any
 *  content that changes height after mount (streamed tokens, tool cards
 *  expanding when their result lands, collapsed tool runs growing in place,
 *  markdown/code highlighting, late font reflows).
 *
 *  Why not effects keyed on message counts + smooth scrollIntoView:
 *  - height changes with a stable count (a tool_result filling its card, a
 *    "N tools" badge absorbing one more) never fired the old effects;
 *  - a smooth scroll is interruptible mid-stream, and the scroll events of the
 *    animation itself read as "user scrolled away" (>threshold), silently
 *    disabling all subsequent pins — the "opens not quite at the bottom" bug.
 *
 *  Design:
 *  - A ResizeObserver on the transcript column re-pins on EVERY content growth
 *    while the user is anchored, whatever caused it.
 *  - Pins are instant (`scrollTop = scrollHeight`), so the scroll events they
 *    produce land exactly at the bottom and re-read as "anchored".
 *  - The user detaches by scrolling up — wheel-up detaches immediately,
 *    scrollbar/keyboard once past the threshold (an upward move at constant
 *    content height is unambiguously the user; pins only ever scroll down) —
 *    and re-attaches by returning near the bottom. A shrink-clamp scroll event
 *    (content got shorter) keeps the anchor: the browser clamps to the bottom.
 *  - Attaching the observer through a ref callback pins synchronously when the
 *    transcript column (re)mounts, so opening a chat paints already at the
 *    bottom — no smooth slide from the top, no stopping short. */
export function useChatAutoScroll(resetKey: string) {
  const feedRef = useRef<HTMLElement | null>(null)
  /** Whether the feed should follow the bottom. Exposed so sibling effects
   *  (the density toggle) can choose between "back to bottom" and "keep the
   *  active turn in view". */
  const followRef = useRef(true)
  const lastPosRef = useRef({ top: 0, height: 0 })
  const observerRef = useRef<ResizeObserver | null>(null)

  const pin = useCallback(() => {
    const feed = feedRef.current
    if (feed) feed.scrollTop = feed.scrollHeight
  }, [])

  // Ref callback for the transcript column: observe its size for as long as it
  // is mounted. The column only exists once messages render, so the attach pin
  // is the "chat just opened" anchor (and the "back from an overlay" one).
  const innerRef = useCallback(
    (el: HTMLElement | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null
      if (!el) return
      const ro = new ResizeObserver(() => {
        if (followRef.current) pin()
      })
      ro.observe(el)
      observerRef.current = ro
      if (followRef.current) pin()
    },
    [pin]
  )

  // Switching session while mounted: re-arm the anchor and jump. The refetch
  // that follows resizes the column, so the observer settles the final pin.
  useLayoutEffect(() => {
    followRef.current = true
    lastPosRef.current = { top: 0, height: 0 }
    pin()
  }, [resetKey, pin])

  // Wheel-up is always the user (pins only ever scroll down): detach right
  // away, so a stream of growing content can't tug the view back down between
  // wheel ticks.
  const onWheel = useCallback((e: WheelEvent<HTMLElement>) => {
    if (e.deltaY < 0) followRef.current = false
  }, [])

  const onScroll = useCallback((e: UIEvent<HTMLElement>) => {
    const el = e.currentTarget
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    // Lower position at the same content height = the user scrolled up
    // (scrollbar drag, keys). With the height changed it's growth or a
    // shrink-clamp instead — those keep the plain proximity rule.
    const scrolledUp =
      el.scrollHeight === lastPosRef.current.height && el.scrollTop < lastPosRef.current.top
    followRef.current = scrolledUp ? false : nearBottom
    lastPosRef.current = { top: el.scrollTop, height: el.scrollHeight }
  }, [])

  return { feedRef, innerRef, followRef, pin, onScroll, onWheel }
}
