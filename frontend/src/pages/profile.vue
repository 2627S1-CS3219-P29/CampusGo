<script lang="ts" setup>
  import { ref } from 'vue'
  import { z } from 'zod'

  const NICKNAME_MAX_LENGTH = 25

  const profileSchema = z.object({
    nickname: z.string().max(25, 'Name must be 25 characters or fewer.'),
    contact: z.e164('Use international format, e.g. +6581234567.').nullable(),
  })

  const errors = ref<Record<string, string>>({})

  const fields = ref([
    { id: 'name', label: 'Name', type: 'text', value: 'test' },
    { id: 'email', label: 'Email', type: 'email', value: 'dasdsa' },
    { id: 'phone', label: 'Phone', type: 'tel', value: 'dasdas' },
  ])

  const isEditable = ref(false)

  function handleEdit(): void {
    isEditable.value = true
  }

  function handleSave(): void {
    errors.value = {}

    const result = profileSchema.safeParse({
      nickname: fields.value.find(field => field.id === 'name')!.value,
      contact: fields.value.find(field => field.id === 'phone')!.value || null,
    })

    if (!result.success) {
      for (const issue of result.error.issues) {
        const fieldId = issue.path[0] === 'nickname' ? 'name' : 'phone'
        errors.value[fieldId] = issue.message
      }
      return
    }
    // TODO: send result.data to PUT /user/:id.
    // It contains { nickname, contact }.
    // Exit edit mode only after the API request succeeds.
  }

</script>

<template>
  <main class="min-h-full bg-gray-50 px-4 py-8">
    <section
      aria-labelledby="profile-heading"
      class="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow-sm"
    >

      <div class="flex flex-row align-center justify-between bg-white">
        <h1 id="profile-heading" class="text-2xl font-semibold text-gray-900">
          My Profile
        </h1>

        <v-btn aria-label="Edit profile" type="button" @click="handleEdit" append-icon="mdi-pencil" size="30">
        </v-btn>
      </div>

      <p class="mt-2 text-sm text-gray-500">
        View and update your personal details.
      </p>

      <div class="mt-8 space-y-5">
        <div
          v-for="field in fields"
          :key="field.id"
          class="flex flex-col gap-2"
        >
          <label class="text-sm font-medium text-gray-700" :for="field.id">
            {{ field.label }}
          </label>

          <input
            :id="field.id"
            v-model="field.value"
            class="
              w-full rounded-lg border border-solid border-gray-300 bg-white
              px-3 py-2.5 text-base text-gray-900
              read-only:bg-gray-100 read-only:text-gray-600
              read-write:border-violet-400 read-write:bg-violet-50
              focus:border-violet-500 focus:outline-none
              focus:ring-2 focus:ring-violet-200
            "
            :readonly="field.id === 'email' || !isEditable"
            :type="field.type"
          >

        </div>
      </div>
      <div class="mt-8 flex justify-end">
        <v-btn
          color="primary"
          :disabled="!isEditable"
          type="button"
          @click="handleSave"
        >
          Save
        </v-btn>
      </div>
    </section>
  </main>
</template>
