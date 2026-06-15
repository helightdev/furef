export function uidToSegment(uid: string): string {
    return uid
        .replace(/`(\d+)/g, '-$1')
        .replace(/[{}()[\],]/g, '-')
        .replace(/[^a-zA-Z0-9_.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

export function uidAnchor(uid: string) {
    return uidToSegment(uid);
}

export function trimSlashes(value: string) {
    return value.replace(/^\/+|\/+$/g, '');
}

export function pathSegments(value: string) {
    return trimSlashes(value).split('/').filter(Boolean);
}

export function joinUrl(...parts: Array<string | undefined>) {
    const [first = '', ...rest] = parts;
    const normalizedFirst = first.startsWith('/') ? `/${trimSlashes(first)}` : trimSlashes(first);
    const suffix = rest.map((part) => trimSlashes(part ?? '')).filter(Boolean).join('/');

    if (!suffix) return normalizedFirst || '/';
    if (!normalizedFirst || normalizedFirst === '/') return `/${suffix}`;
    return `${normalizedFirst}/${suffix}`;
}

export function sectionId(title: string) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function uidToFileName(uid: string): string {
    return `${uid.replace(/`(\d+)/g, '-$1')}.yml`;
}

export function normalizeText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length > 0 ? text : undefined;
}
