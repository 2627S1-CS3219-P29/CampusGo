import client from './http'

export interface UserProfile {
  id: number
  nickname: string
  email: string
  contact: string | null
}

// a user as listed for admins (GET /user), with their roles and when they joined
export interface UserSummary extends UserProfile {
  roles: string[]
  // timestamp text from the user service; read it with parseTimestamp (util/user)
  createdAt: string
}

// every user; admins only
export async function listUsers () {
  const response = await client.get<UserSummary[]>('/public/user/user')
  return response.data
}

// one user with their roles and join date; admins can look up anyone
export async function getUserSummary (id: number | string) {
  const response = await client.get<UserSummary>(`/public/user/user/${id}`)
  return response.data
}

export async function getUser (id: string) {
  const response = await client.get<UserProfile>(`/public/user/user/${id}`)
  return response.data
}

export async function updateUser (
  id: string,
  body: { nickname: string, contact: string | null },
) {
  await client.put(`/public/user/user/${id}`, body)
}
