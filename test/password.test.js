import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

for (const page of ['index', 'player']) {
    test(`password modal works on ${page} without assuming homepage-only DOM`, () => {
        const element = () => ({ style: {}, value: '', classList: { add() {}, remove() {} }, focus() {} });
        const elements = { passwordModal: { ...element(), querySelector: () => element() },
            passwordInput: element(), passwordError: element() };
        if (page === 'index') Object.assign(elements, { doubanArea: element(), passwordCancelBtn: element() });
        let doubanCalls = 0;
        const context = vm.createContext({
            window: { __ENV__: { PASSWORD: 'a'.repeat(64) } },
            document: { getElementById: id => elements[id] || null, addEventListener() {} },
            localStorage: { getItem: () => 'true' }, setTimeout: fn => fn(),
            initDouban: () => { doubanCalls++; },
        });
        vm.runInContext(readFileSync(new URL('../js/password.js', import.meta.url), 'utf8'), context);
        context.showPasswordModal();
        assert.equal(elements.passwordModal.style.display, 'flex');
        context.hidePasswordModal();
        assert.equal(elements.passwordModal.style.display, 'none');
        assert.equal(doubanCalls, page === 'index' ? 1 : 0);
    });
}
