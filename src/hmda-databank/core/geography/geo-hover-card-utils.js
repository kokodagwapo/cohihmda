/** Shared positioning for geography hover cards. */

/** Docked geography inspector width */
export const GEO_HOVER_CARD_WIDTH = 340

export const GEO_HOVER_CARD_DOCK = {
  width: GEO_HOVER_CARD_WIDTH,
  left: 14,
  top: 104,
  bottom: 186,
}

/** Legacy cursor-follow clamp (live tracks / fallback). */
export function clampHoverCardPosition(x, y, cardW = GEO_HOVER_CARD_WIDTH, cardH = 420, boundsEl = null) {
  const pad = 12
  let vw
  let vh
  let offsetX = 0
  let offsetY = 0

  if (boundsEl?.getBoundingClientRect) {
    const rect = boundsEl.getBoundingClientRect()
    vw = rect.width
    vh = rect.height
    offsetX = rect.left
    offsetY = rect.top
  } else if (typeof window !== 'undefined') {
    vw = window.innerWidth
    vh = window.innerHeight
  } else {
    vw = 1200
    vh = 800
  }

  let left = x
  let top = y
  if (left + cardW + pad > offsetX + vw) left = Math.max(offsetX + pad, offsetX + vw - cardW - pad)
  if (top + cardH + pad > offsetY + vh) top = Math.max(offsetY + pad, offsetY + vh - cardH - pad)
  if (left < offsetX + pad) left = offsetX + pad
  if (top < offsetY + pad) top = offsetY + pad
  return { left, top }
}
