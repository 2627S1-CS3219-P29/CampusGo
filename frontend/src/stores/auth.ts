import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import * as tokenStorage from '@/auth/tokenStorage';
import * as AuthApi from '@/api/auth';

export const useAuthStore = defineStore("auth", () => {
    const initialTokens = tokenStorage.getTokens();
    const accessToken = ref<string | null>(initialTokens?.access ?? null);
    const refreshToken = ref<string | null>(initialTokens?.refresh ?? null);
    tokenStorage.onTokensChanged(tokens => {
        accessToken.value = tokens?.access ?? null
        refreshToken.value = tokens?.refresh ?? null
    });

    const userId = computed<string | null>(() => {
        if (!accessToken.value) return null;

        try {
            const encoded = accessToken.value.split('.')[1];
            if (!encoded) return null;

            const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
            const payload = JSON.parse(atob(padded));

            return typeof payload.sub === 'string' ? payload.sub : null;
        } catch {
            return null;
        }
    });

    const isAuthenticated = computed(() => accessToken.value !== null);

    const login = async (email: string, password: string) => {
        const res = await AuthApi.login(email, password);
        tokenStorage.setTokens({ access: res.accessToken, refresh: res.refreshToken });
    }

    const logout = async () => {
        tokenStorage.clearTokens();
    }

    return { accessToken, refreshToken, userId, isAuthenticated, login, logout };
});