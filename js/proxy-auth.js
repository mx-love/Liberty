/**
 * Issues short-lived, method/target-bound capabilities for the metadata proxy.
 * Authentication is carried by an HttpOnly same-origin session cookie. No
 * password verifier or signing secret is exposed to this module or proxy URLs.
 */
(function () {
    const TOKEN_ENDPOINT = '/api/proxy-token';
    const CAPABILITY_REFRESH_MARGIN_MS = 5000;
    const capabilityCache = new Map();

    function getProxyTarget(proxyUrl) {
        try {
            const parsed = new URL(proxyUrl, window.location.origin);
            if (!parsed.pathname.startsWith('/proxy/')) return '';
            return decodeURIComponent(parsed.pathname.slice('/proxy/'.length));
        } catch (error) {
            return '';
        }
    }

    function cachedCapability(key) {
        const cached = capabilityCache.get(key);
        if (!cached || cached.expiresAt <= Date.now() + CAPABILITY_REFRESH_MARGIN_MS) {
            capabilityCache.delete(key);
            return null;
        }
        return cached;
    }

    async function requestCapability(target, method) {
        const key = `${method}\n${target}`;
        const cached = cachedCapability(key);
        if (cached) return cached;

        const response = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'same-origin',
            cache: 'no-store',
            body: JSON.stringify({ target, method }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Proxy authorization failed');
        }
        const capability = {
            expiresAt: Number(data.expiresAt),
            nonce: String(data.nonce || ''),
            signature: String(data.signature || ''),
        };
        if (!Number.isSafeInteger(capability.expiresAt) || !capability.nonce || !capability.signature) {
            throw new Error('Invalid proxy authorization response');
        }
        capabilityCache.set(key, capability);
        return capability;
    }

    async function addAuthToProxyUrl(url, method = 'GET') {
        const target = getProxyTarget(url);
        if (!target) return url;
        const normalizedMethod = String(method || 'GET').toUpperCase();
        const capability = await requestCapability(target, normalizedMethod);
        const authorized = new URL(url, window.location.origin);
        authorized.searchParams.set('pxe', String(capability.expiresAt));
        authorized.searchParams.set('pxn', capability.nonce);
        authorized.searchParams.set('pxs', capability.signature);
        return authorized.pathname + authorized.search;
    }

    function clearAuthCache() {
        capabilityCache.clear();
    }

    window.addEventListener('storage', (event) => {
        if (
            event.key === 'userPassword'
            || event.key === 'passwordVerified'
            || event.key === window.PASSWORD_CONFIG?.localStorageKey
        ) {
            clearAuthCache();
        }
    });

    window.ProxyAuth = {
        addAuthToProxyUrl,
        clearAuthCache,
    };
})();
