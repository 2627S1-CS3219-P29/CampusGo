import client from './http'

export interface UserProfile {
  id: number
  nickname: string
  email: string
  contact: string | null
}

export async function getUser(id: string) {
  const response = await client.get<UserProfile>(`/public/user/${id}`)
  return response.data
}

export async function updateUser(
  id: string,
  body: { nickname: string, contact: string | null },
) {
  await client.put(`/public/user/${id}`, body)
}
