(function () {
    window.LibertyUtils = window.LibertyUtils || {};

    function safeJsonParse(value, fallback = null) {
        try {
            if (value === null || value === undefined || value === '') return fallback;
            return JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    }

    function readStorage(key, fallback = null) {
        try {
            return safeJsonParse(localStorage.getItem(key), fallback);
        } catch (error) {
            return fallback;
        }
    }

    function writeStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.warn(`[Storage] Failed to write ${key}`, error);
            return false;
        }
    }

    function readStringStorage(key, fallback = '') {
        try {
            const value = localStorage.getItem(key);
            return value === null || value === undefined ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function writeStringStorage(key, value) {
        try {
            localStorage.setItem(key, String(value ?? ''));
            return true;
        } catch (error) {
            console.warn(`[Storage] Failed to write ${key}`, error);
            return false;
        }
    }

    function removeStorage(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            return false;
        }
    }

    window.LibertyUtils.storage = {
        safeJsonParse,
        readStorage,
        writeStorage,
        readStringStorage,
        writeStringStorage,
        removeStorage
    };
})();
