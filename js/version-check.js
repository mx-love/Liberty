function normalizeVersionManifest(value) {
    if (!value || typeof value !== 'object') return null;
    const version = typeof value.version === 'string' ? value.version.trim() : '';
    if (!version) return null;
    return {
        name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Liberty',
        version,
        commit: typeof value.commit === 'string' && value.commit.trim() ? value.commit.trim() : null,
        branch: typeof value.branch === 'string' && value.branch.trim() ? value.branch.trim() : null,
        buildTime: typeof value.buildTime === 'string' && value.buildTime.trim() ? value.buildTime.trim() : null,
    };
}

async function fetchVersionManifest() {
    const response = await fetch('/version.json', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`version manifest returned HTTP ${response.status}`);
    const manifest = normalizeVersionManifest(await response.json());
    if (!manifest) throw new Error('version manifest is invalid');
    return manifest;
}

function formatBuildTime(value) {
    if (!value) return null;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function createVersionElement(manifest) {
    const element = document.createElement('p');
    element.className = 'text-gray-500 text-sm mt-1 text-center md:text-left';

    const label = manifest
        ? `版本: ${manifest.name} ${manifest.version}`
        : '版本: Liberty（版本信息不可用）';
    element.appendChild(document.createTextNode(label));

    if (manifest) {
        const details = [];
        if (manifest.commit) details.push(`commit ${manifest.commit}`);
        if (manifest.branch) details.push(manifest.branch);
        const buildTime = formatBuildTime(manifest.buildTime);
        if (buildTime) details.push(`build ${buildTime}`);
        if (details.length) {
            const metadata = document.createElement('span');
            metadata.className = 'text-gray-600 ml-1';
            metadata.textContent = `(${details.join(' · ')})`;
            element.appendChild(metadata);
        }
    }

    return element;
}

function displayVersionElement(element) {
    const footerElement = document.querySelector('.footer p.text-gray-500.text-sm');
    if (footerElement) {
        footerElement.insertAdjacentElement('afterend', element);
        return;
    }
    const footerContainer = document.querySelector('.footer .container');
    const target = footerContainer?.querySelector('div');
    if (target) target.appendChild(element);
}

async function addVersionInfoToFooter() {
    try {
        displayVersionElement(createVersionElement(await fetchVersionManifest()));
    } catch {
        displayVersionElement(createVersionElement(null));
    }
}

document.addEventListener('DOMContentLoaded', addVersionInfoToFooter);
