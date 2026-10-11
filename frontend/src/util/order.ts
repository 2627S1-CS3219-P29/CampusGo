import type { Order, OrderStatus, TargetStatus } from '@/api/order'
import axios from 'axios'

export const orderStatusInfo: Record<OrderStatus, { label: string, color: string, icon: string }> = {
  CREATED: { label: 'Waiting for courier', color: 'info', icon: 'mdi-clock-outline' },
  ACCEPTED: { label: 'Courier on the way', color: 'primary', icon: 'mdi-bike-fast' },
  PICKED_UP: { label: 'Picked up', color: 'deep-purple', icon: 'mdi-package-variant-closed' },
  COMPLETED: { label: 'Delivered', color: 'success', icon: 'mdi-check-circle-outline' },
  CANCELLED: { label: 'Cancelled', color: 'grey', icon: 'mdi-close-circle-outline' },
  EXPIRED: { label: 'Expired', color: 'warning', icon: 'mdi-timer-off-outline' },
}

export const ACTIVE_STATUSES: OrderStatus[] = ['CREATED', 'ACCEPTED', 'PICKED_UP']
export const PAST_STATUSES: OrderStatus[] = ['COMPLETED', 'CANCELLED', 'EXPIRED']

export function isActive (status: OrderStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

// the happy path shown as a progress timeline
export const PROGRESS_STEPS: { status: OrderStatus, label: string }[] = [
  { status: 'CREATED', label: 'Requested' },
  { status: 'ACCEPTED', label: 'Accepted' },
  { status: 'PICKED_UP', label: 'Picked up' },
  { status: 'COMPLETED', label: 'Delivered' },
]

// index of the last completed step; -1 when cancelled or expired (off the happy path)
export function progressIndex (status: OrderStatus): number {
  return PROGRESS_STEPS.findIndex(step => step.status === status)
}

// TODO: show nicknames once the user service exposes other users' names
export function personLabel (userId: number | null, myId: number | null): string {
  if (userId === null) {
    return 'Not assigned yet'
  }
  return userId === myId ? 'You' : `User #${userId}`
}

export function formatDateTime (iso: string): string {
  return new Date(iso).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })
}

// e.g. "Expires in 3h 20m", "Expires in 12m", "Expired"
// e.g. "Expires in 3h 20m", "Expires in 12m", "Expires in 45s", "Expired".
// Rounds up, so it never says "Expired" while the errand is still open.
export function formatTimeLeft (expiresAt: string, now = Date.now()): string {
  const seconds = Math.ceil((new Date(expiresAt).getTime() - now) / 1000)
  if (seconds <= 0) {
    return 'Expired'
  }
  if (seconds < 60) {
    return `Expires in ${seconds}s`
  }
  const minutes = Math.ceil(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `Expires in ${hours}h ${minutes % 60}m` : `Expires in ${minutes}m`
}

// an open errand whose time ran out; the order service marks it EXPIRED the next time it is read
export function hasExpired (order: Order, now = Date.now()): boolean {
  return order.status === 'CREATED' && new Date(order.expiresAt).getTime() <= now
}

// milliseconds until the soonest of these open errands expires, or null if none are waiting
export function msUntilNextExpiry (orders: Order[], now = Date.now()): number | null {
  const times = orders
    .filter(o => o.status === 'CREATED')
    .map(o => new Date(o.expiresAt).getTime() - now)
  return times.length > 0 ? Math.max(0, Math.min(...times)) : null
}

export interface OrderAction {
  target: TargetStatus
  label: string
  icon: string
  color: string
  // shown in the confirmation dialog
  confirm: string
}

/**
 * The status changes the viewer may make right now. Mirrors the order service's rules,
 * which still check everything; this only decides which buttons to show.
 */
export function availableActions (order: Order, myId: number | null, isAdmin: boolean, now = Date.now()): OrderAction[] {
  const isRequester = myId !== null && order.requesterId === myId
  const isCourier = myId !== null && order.courierId === myId
  const actions: OrderAction[] = []

  // an open errand whose time ran out can no longer be accepted or cancelled
  if (hasExpired(order, now)) {
    return actions
  }

  if (order.status === 'CREATED' && !isRequester) {
    actions.push({ target: 'ACCEPTED', label: 'Accept errand', icon: 'mdi-hand-okay', color: 'primary', confirm: 'Accept this errand? You will be its courier.' })
  }
  if (order.status === 'ACCEPTED' && isCourier) {
    actions.push({ target: 'PICKED_UP', label: 'Mark as picked up', icon: 'mdi-package-variant-closed', color: 'primary', confirm: 'Have you collected the item from the pickup location?' })
  }
  if (order.status === 'PICKED_UP' && isRequester) {
    actions.push({ target: 'COMPLETED', label: 'Confirm delivery', icon: 'mdi-check-circle-outline', color: 'success', confirm: `Confirm you received the item? ${order.creditBounty} credit${order.creditBounty === 1 ? '' : 's'} will go to the courier.` })
  }
  if (isActive(order.status) && (isRequester || isAdmin)) {
    actions.push({ target: 'CANCELLED', label: 'Cancel errand', icon: 'mdi-close-circle-outline', color: 'error', confirm: 'Cancel this errand? Your reserved credits will be released.' })
  }
  return actions
}

/**
 * A readable message from a failed API call: the server's error (with the first
 * field message, if any), or the fallback when there is no response body.
 */
export function apiErrorMessage (error: unknown, fallback: string): string {
  const data = axios.isAxiosError(error) ? error.response?.data : undefined
  if (!data?.error) {
    return fallback
  }
  const fieldMessage = data.fields ? Object.values<string[]>(data.fields)[0]?.[0] : undefined
  return fieldMessage ?? data.error
}

// how long an errand waits for a courier; the order service allows 15 min to 24 h
export const EXPIRY_OPTIONS: { title: string, value: number }[] = [
  { title: '30 minutes', value: 30 },
  { title: '1 hour', value: 60 },
  { title: '2 hours', value: 120 },
  { title: '4 hours', value: 240 },
  { title: '12 hours', value: 720 },
  { title: '24 hours', value: 1440 },
]

// the order service's default, and the original fixed expiry
export const DEFAULT_EXPIRY_MINUTES = 1440
