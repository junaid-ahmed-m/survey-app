import axios, { AxiosError } from 'axios';

export const TOKEN_STORAGE_KEY = 'qr-rewards.admin.token';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 20_000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const isAdminRoute = window.location.pathname.startsWith('/admin');
    if (error.response?.status === 401 && isAdminRoute && !window.location.pathname.includes('login')) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.location.assign('/admin/login');
    }
    return Promise.reject(error);
  },
);

export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

export function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Partial<ApiError> | undefined;
    const rawMessage = data?.message;
    return {
      code: data?.code ?? (error.response?.status === 429 ? 'RATE_LIMITED' : 'NETWORK_ERROR'),
      message: Array.isArray(rawMessage)
        ? rawMessage.join(' ')
        : rawMessage ??
          (error.response?.status === 429
            ? 'Too many attempts. Please wait a moment and try again.'
            : 'We could not reach the server. Please check your connection.'),
      statusCode: error.response?.status ?? 0,
      details: data?.details as Record<string, unknown> | undefined,
    };
  }
  return { code: 'UNKNOWN', message: 'Something went wrong.', statusCode: 0 };
}
