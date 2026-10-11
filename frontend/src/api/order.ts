// Frontend API client for the order service. The errand pages call these
// functions instead of using HTTP directly.
import client from './http'

export const ORDER_STATUSES = ['CREATED', 'ACCEPTED', 'PICKED_UP', 'COMPLETED', 'CANCELLED', 'EXPIRED'] as const
export type OrderStatus = typeof ORDER_STATUSES[number]

// statuses a user can move an order to; CREATED and EXPIRED are only set by the service
export type TargetStatus = 'ACCEPTED' | 'PICKED_UP' | 'COMPLETED' | 'CANCELLED'

// open: errands a courier can accept; requested: mine; delivering: I am the courier; all: admins only
export type OrderScope = 'open' | 'requested' | 'delivering' | 'all'

export interface Order {
  // UUID
  id: string
  idempotencyKey: string | null
  // user ids from the user service
  requesterId: number
  courierId: number | null
  // every pickup is a registered supplier
  supplierId: number
  // snapshot of the supplier when the order was made, e.g. "Printer @ Com 2, Com 2, Level 1"
  pickupLocation: string
  dropoffLocation: string
  itemDescription: string
  creditBounty: number
  additionalDetails: string | null
  status: OrderStatus
  // ISO 8601
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export interface OrderQuery {
  scope: OrderScope
  // only these statuses; all when left out
  statuses?: OrderStatus[]
  // 1-based, 20 orders per page
  page: number
}

// same shape as the supplier list
export interface OrderPage {
  data: Order[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPage: number
  }
}

// body of POST /orders; the requester and pickup text are set by the order service
export interface OrderInput {
  supplierId: number
  dropoffLocation: string
  itemDescription: string
  creditBounty: number
  additionalDetails: string | null
  // how long to wait for a courier (15 min to 24 h); the order service defaults to 24 h
  expiresInMinutes?: number
}

export async function listOrders (query: OrderQuery) {
  const params: Record<string, string> = {
    scope: query.scope,
    page: String(query.page),
  }
  if (query.statuses?.length) {
    params.status = query.statuses.join(',')
  }

  const response = await client.get<OrderPage>('/public/order/orders', { params })
  return response.data
}

export async function getOrder (id: string) {
  const response = await client.get<Order>(`/public/order/orders/${id}`)
  return response.data
}

/**
 * Creates an errand as the signed-in user. The idempotency key makes a retried
 * submit (e.g. double click, dropped connection) return the same order instead of a duplicate.
 */
export async function createOrder (body: OrderInput, idempotencyKey: string) {
  const response = await client.post<Order | { order: Order, deduplicated: true }>(
    '/public/order/orders',
    body,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  )
  return 'deduplicated' in response.data ? response.data.order : response.data
}

export async function updateOrderStatus (id: string, targetStatus: TargetStatus) {
  const response = await client.patch<Order>(`/public/order/orders/${id}/status`, { targetStatus })
  return response.data
}
