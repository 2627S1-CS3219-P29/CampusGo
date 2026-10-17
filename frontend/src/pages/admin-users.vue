<!-- Admin only: every user, each linking to their errand history -->
<template>
  <v-container class="py-6" max-width="1000">
    <div class="d-flex flex-wrap align-center justify-space-between ga-2 mb-4">
      <h1 class="text-h5 font-weight-bold">Users</h1>

      <span v-if="!isLoading" class="text-body-2 text-medium-emphasis">
        {{ users.length }} user{{ users.length === 1 ? '' : 's' }}
      </span>
    </div>

    <v-skeleton-loader v-if="isLoading" type="list-item-avatar-two-line@6" />

    <v-empty-state
      v-else-if="users.length === 0"
      icon="mdi-account-group-outline"
      text="Users show up here once they register."
      title="No users yet"
    />

    <!-- One row per user, newest first; opens their errand history -->
    <v-card v-else rounded="lg" variant="outlined">
      <v-list lines="two">
        <template v-for="(user, i) in users" :key="user.id">
          <v-divider v-if="i > 0" />

          <v-list-item :to="{ name: 'admin-user', params: { id: user.id } }">
            <template #prepend>
              <user-avatar :name="user.nickname" />
            </template>

            <v-list-item-title class="d-flex flex-wrap align-center ga-2">
              {{ user.nickname }}
              <span class="text-caption text-medium-emphasis">#{{ user.id }}</span>
              <v-chip v-if="user.roles.includes('admin')" color="primary" label size="x-small">Admin</v-chip>
            </v-list-item-title>

            <v-list-item-subtitle>
              {{ user.email }}<span v-if="user.contact"> · {{ user.contact }}</span>
            </v-list-item-subtitle>

            <template #append>
              <span class="text-caption text-medium-emphasis d-none d-sm-inline">Joined {{ formatDate(user.createdAt) }}</span>
              <v-icon class="ml-2" color="grey">mdi-chevron-right</v-icon>
            </template>
          </v-list-item>
        </template>
      </v-list>
    </v-card>
  </v-container>
</template>

<script lang="ts" setup>
  import { onMounted, ref } from 'vue'
  import { listUsers, type UserSummary } from '@/api/user'
  import UserAvatar from '@/components/UserAvatar.vue'
  import { useAlertStore } from '@/stores/alerts'
  import { apiErrorMessage } from '@/util/order'
  import { formatDate, parseTimestamp } from '@/util/user'

  const alertStore = useAlertStore()

  const users = ref<UserSummary[]>([])
  const isLoading = ref(true)

  onMounted(async () => {
    try {
      const all = await listUsers()
      // newest first, so recent sign-ups are easy to find. Sorts the fresh response in place:
      // toSorted() is not in this project's TypeScript lib yet
      // eslint-disable-next-line unicorn/no-array-sort
      users.value = all.sort((a, b) => parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt))
    } catch (error) {
      console.error('Error loading users', error)
      alertStore.error(apiErrorMessage(error, 'Could not load users'))
    } finally {
      isLoading.value = false
    }
  })
</script>
