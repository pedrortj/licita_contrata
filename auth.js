const TOKEN_KEY = 'access_token';

export function getToken() {
	return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function setToken(token, remember = false) {
	const storage = remember ? localStorage : sessionStorage;
	storage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
	sessionStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(TOKEN_KEY);
	sessionStorage.removeItem('logado');
	localStorage.removeItem('logado');
}

export function redirectToLogin() {
	if (!window.location.pathname.endsWith('/login.html')) {
		window.location.replace('login.html');
	}
}

export function requireAuthentication() {
	const token = getToken();
	if (!token) {
		redirectToLogin();
		return null;
	}

	return token;
}
