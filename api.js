import { clearToken, getToken, redirectToLogin } from './auth.js';

const API_BASE_URL = 'https://licita-e-extrai.onrender.com';

function parseResponseBody(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = ['Bearer', token].join(' ');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });
  const payload = parseResponseBody(await response.text());

  if (response.status === 401) {
    clearToken();
    redirectToLogin();
  }

  if (!response.ok) {
    const details =
      payload?.detail ||
      payload?.message ||
      payload?.error ||
      payload?.errors ||
      `Erro ${response.status} na API.`;
    const error = new Error(typeof details === 'string' ? details : JSON.stringify(details));
    error.status = response.status;
    error.path = path;
    throw error;
  }

  return payload;
}
