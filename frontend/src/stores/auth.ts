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

    const isAuthenticated = computed(() => accessToken.value !== null);

    const login = async (email: string, password: string) => {
        const res = await AuthApi.login(email, password);
        tokenStorage.setTokens({ access: res.accessToken, refresh: res.refreshToken });
    }

    const logout = async () => {
        const refresh = refreshToken.value;
            try {
                if (refresh) await AuthApi.logout(refresh);
            } catch (error) {
                console.error('Failed to revoke refresh token on server', error);
            } finally {
                tokenStorage.clearTokens();
            }
    }

    return { accessToken, refreshToken, isAuthenticated, login, logout };
});