import fs from 'node:fs';
import path from 'node:path';
import { parse, type HTMLElement } from 'node-html-parser';
import { normalizeText } from '../utils';
import {memberGroupForSymbolKind, symbolKindGroup} from '../symbolKinds';
import type {
    FRBadge,
    FREntry,
    FRItem,
    FRSignature,
    FRReference,
    FRSourceParser,
    FRToc,
    FRTocItem,
} from '../types';

function modifierInfo(modifier: string) {
    switch (modifier) {
        case 'abstract':
            return { icon: 'symbol-interface', color: 'currentColor', label: 'Abstract member' };
        case 'override':
            return { icon: 'arrow-small-right', color: 'currentColor', label: 'Override member' };
        case 'sealed':
            return { icon: 'shield', color: 'currentColor', label: 'Sealed modifier' };
        case 'async':
            return { icon: 'debug-continue', color: 'currentColor', label: 'Suspend modifier' };
        default:
            return { icon: 'symbol-keyword', color: 'currentColor', label: `${modifier} modifier` };
    }
}

function visibilityInfo(visibility: string) {
    switch (visibility) {
        case 'protected':
            return { icon: 'shield', color: '#75beff', label: 'Protected visibility' };
        case 'private':
            return { icon: 'lock', color: '#f14c4c', label: 'Private visibility' };
        case 'internal':
            return { icon: 'package', color: '#cca700', label: 'Internal visibility' };
        default:
            return { icon: 'eye', color: 'currentColor', label: `${visibility} visibility` };
    }
}

function memberVisibility(member: FRItem): string {
    const sig = member.syntax?.content ?? '';
    if (/\bprivate\b/.test(sig)) return 'private';
    if (/\bprotected\b/.test(sig)) return 'protected';
    if (/\binternal\b/.test(sig)) return 'internal';
    return 'public';
}

function memberModifierTokens(member: FRItem): string[] {
    const sig = member.syntax?.content ?? '';
    const tokens: string[] = [];
    const modifiers = [
        'suspend',
        'open',
        'abstract',
        'override',
        'inline',
        'operator',
        'infix',
        'sealed',
    ];
    for (const modifier of modifiers) {
        if (new RegExp(`\\b${modifier}\\b`).test(sig)) {
            tokens.push(modifier);
        }
    }
    return tokens;
}

function memberBadges(member: FRItem, leading: boolean): FRBadge[] {
    const badges: FRBadge[] = [];
    const visibility = memberVisibility(member);
    if (visibility !== 'public') {
        badges.push({
            key: `visibility-${visibility}`,
            text: visibility,
            ...visibilityInfo(visibility),
        });
    }
    for (const modifier of memberModifierTokens(member)) {
        if (leading && (modifier === 'override' || modifier === 'abstract' || modifier === 'open')) continue;
        const badgeModifier = modifier === 'suspend' ? 'async' : modifier;
        badges.push({
            key: `modifier-${badgeModifier}`,
            text: badgeModifier,
            ...modifierInfo(badgeModifier),
        });
    }
    return badges;
}

function getMemberType(signature: string): string {
    const sig = signature.trim();
    if (sig.startsWith('constructor') || sig.includes(' constructor(')) {
        return 'Constructor';
    }
    if (sig.includes('fun ') || sig.includes('fun(')) {
        return 'Method';
    }
    if (sig.includes('val ') || sig.includes('var ')) {
        return 'Property';
    }
    return 'Method'; // default
}

function extractTypeFromSignature(signature: string, memberType: string): string | undefined {
    const sig = signature.trim();
    if (memberType === 'Property') {
        const colonIndex = sig.indexOf(':');
        if (colonIndex > 0) {
            const afterColon = sig.slice(colonIndex + 1);
            const equalIndex = afterColon.indexOf('=');
            const typeStr = equalIndex > 0 ? afterColon.slice(0, equalIndex) : afterColon;
            return typeStr.trim();
        }
    } else if (memberType === 'Method') {
        const lastParen = sig.lastIndexOf(')');
        if (lastParen > 0) {
            const afterParen = sig.slice(lastParen + 1).trim();
            if (afterParen.startsWith(':')) {
                return afterParen.slice(1).trim();
            }
        }
    }
    return undefined;
}

function escapeHtmlAttribute(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function trimDokkaLinkLabel(htmlContent: string, textContent: string): string {
    const text = textContent.trim();
    if (text.includes('.') && !text.includes(' ')) {
        const simpleName = text.split('.').at(-1) ?? text;
        const html = htmlContent.trim();
        if (html.startsWith('<code>') && html.endsWith('</code>')) {
            return `<code>${simpleName}</code>`;
        }
        return simpleName;
    }
    return htmlContent;
}

function normalizeDokkaContentLinks(html: string, resolveLink: ((href: string) => string | undefined) | undefined): string {
    if (!resolveLink || !html.includes('<a')) return html;

    const root = parse(`<div>${html}</div>`);
    for (const link of root.querySelectorAll('a')) {
        const href = link.getAttribute('href') ?? '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) {
            continue;
        }

        const uid = resolveLink(href);
        const label = trimDokkaLinkLabel(link.innerHTML, link.textContent);
        if (uid) {
            link.replaceWith(`<a data-furef-uid="${escapeHtmlAttribute(uid)}">${label}</a>`);
        } else {
            link.replaceWith(label);
        }
    }

    return root.querySelector('div')?.innerHTML ?? html;
}

function hasAncestorClass(element: HTMLElement, className: string) {
    let parent = element.parentNode as HTMLElement | null;
    while (parent) {
        if (parent.classList?.contains(className)) return true;
        parent = parent.parentNode as HTMLElement | null;
    }
    return false;
}

function isPageLevelDokkaSummary(element: HTMLElement) {
    return !hasAncestorClass(element, 'tabbedcontent') && !hasAncestorClass(element, 'table-row');
}

function parseDokkaSignatureParameter(text: string): NonNullable<FRSignature['parameters']>[number] {
    let content = text.trim();
    if (content.endsWith(',')) {
        content = content.slice(0, -1).trim();
    }

    const colonIndex = content.indexOf(':');
    if (colonIndex <= 0) return {id: content, type: undefined};

    let id = content.slice(0, colonIndex).trim();
    // Strip Kotlin parameter modifiers (like vararg, val, var, noinline, crossinline)
    id = id.replace(/^\s*(vararg|noinline|crossinline|val|var)\s+/, '');

    const typeAndDefault = content.slice(colonIndex + 1).trim();
    const defaultMatch = typeAndDefault.match(/\s=\s/);
    if (!defaultMatch || defaultMatch.index === undefined) {
        return {id, type: typeAndDefault || undefined};
    }

    const defaultStart = defaultMatch.index;
    const defaultValue = typeAndDefault.slice(defaultStart + defaultMatch[0].length).trim();

    return {
        id,
        type: typeAndDefault.slice(0, defaultStart).trim() || undefined,
        defaultValue: defaultValue || undefined,
    };
}

function parseHtmlFile(
    filePath: string,
    isTypePage: boolean = false,
    resolveLink?: (href: string) => string | undefined,
    currentFqn?: string,
): {
    signature: string;
    summary: string | undefined;
    parameters: FRSignature['parameters'] | undefined;
    supertypes: string[];
} {
    if (!fs.existsSync(filePath)) {
        return { signature: '', summary: undefined, parameters: undefined, supertypes: [] };
    }
    const html = fs.readFileSync(filePath, 'utf8');
    const root = parse(html);

    // 1. Signature
    const symbolEl = root.querySelector('.symbol.monospace');
    let signature = '';
    if (symbolEl) {
        signature = symbolEl.textContent?.trim() || '';
        // Replace multiple whitespaces/newlines with a single space
        signature = signature.replace(/\s+/g, ' ');
    }

    // 2. KDoc summary
    const summaryEl = root
        .querySelectorAll('.main-content .cover .brief, .main-content .cover p.paragraph, .main-content .platform-hinted .brief, .main-content .platform-hinted p.paragraph')
        .find(isPageLevelDokkaSummary);

    let summary: string | undefined = undefined;
    if (summaryEl) {
        summary = normalizeDokkaContentLinks(summaryEl.innerHTML.trim(), resolveLink);
    }

    // 3. Parameters
    const params: NonNullable<FRSignature['parameters']> = [];

    if (symbolEl && !isTypePage) {
        // Parse from signature (.parameter). Dokka emits defaults inline as `name: Type = value`.
        const paramEls = symbolEl.querySelectorAll('.parameter');
        const signatureParams = paramEls.map(el => parseDokkaSignatureParameter(el.textContent ?? ''));
        // Parse descriptions from parameter table
        const descMap = new Map<string, string>();
        const tableHeader = root.querySelectorAll('h4.tableheader').find(el => el.textContent?.trim() === 'Parameters');
        if (tableHeader) {
            let nextEl = tableHeader.nextElementSibling;
            while (nextEl && nextEl.tagName !== 'DIV') {
                nextEl = nextEl.nextElementSibling;
            }
            if (nextEl && nextEl.classList.contains('table')) {
                const rows = nextEl.querySelectorAll('.table-row');
                for (const row of rows) {
                    const nameEl = row.querySelector('u');
                    const descEl = row.querySelector('.title p.paragraph, .title');
                    if (nameEl && descEl) {
                        descMap.set(
                            nameEl.textContent?.trim() || '',
                            normalizeDokkaContentLinks(descEl.innerHTML.trim() || '', resolveLink),
                        );
                    }
                }
            }
        }

        // Merge signature parameters with descriptions
        for (const sigParam of signatureParams) {
            params.push({
                id: sigParam.id,
                type: sigParam.type,
                defaultValue: sigParam.defaultValue,
                description: sigParam.id ? descMap.get(sigParam.id) || undefined : undefined,
            });
        }
    }

    // 4. Supertypes
    const supertypes: string[] = [];
    if (symbolEl && isTypePage && resolveLink) {
        const linkEls = symbolEl.querySelectorAll('a');
        for (const linkEl of linkEls) {
            const href = linkEl.getAttribute('href');
            if (href) {
                const uid = resolveLink(href);
                if (uid && uid !== currentFqn) {
                    supertypes.push(uid);
                }
            }
        }
    }

    return {
        signature,
        summary: summary || undefined,
        parameters: params.length > 0 ? params : undefined,
        supertypes,
    };
}

function classifyType(signature: string, name: string, parentType: string | null, typeMap: Map<string, string>): string {
    if (parentType && typeMap.get(parentType) === 'Enum') {
        return 'EnumMember';
    }
    const sig = signature.trim();
    // Companion objects: Dokka names them "Companion", nested inside a class, with an "object" signature.
    // The literal text "companion object" does NOT appear in Dokka HTML signatures.
    if (name === 'Companion' && /\bobject\b/.test(sig) && parentType) {
        return 'CompanionObject';
    }
    // Fallback for the rare case Dokka does include the keyword
    if (/\bcompanion object\b/.test(sig)) {
        return 'CompanionObject';
    }
    if (sig.startsWith("object ")) {
        return 'KotlinObject';
    }

    if (sig.startsWith('interface ') || sig.includes(' interface ')) {
        return 'Interface';
    }
    if (sig.startsWith('enum ') || sig.includes(' enum ')) {
        return 'Enum';
    }
    return 'Class';
}

/**
 * Detects a Kotlin extension receiver in a signature like:
 *   fun SomeType.methodName(...)  or  fun some.pkg.Type<T>.method(...)
 * Returns the receiver type string if found, or undefined.
 */
function parseExtensionReceiver(signature: string): string | undefined {
    // Match: fun <optionalTypeParams> ReceiverType.functionName( or <
    // We want to capture everything between "fun " and the final ".name("
    const match = signature.match(/\bfun\s+(?:<[^>]*>\s+)?((?:[\w.<>?, ]+\.)+)([\w]+)\s*[<(]/);
    if (!match) return undefined;
    // match[1] is "ReceiverType." (with trailing dot), strip it
    const receiver = match[1].replace(/\.$/, '').trim();
    // Sanity: must contain at least one word character
    if (!receiver || !/\w/.test(receiver)) return undefined;
    return receiver;
}

function getDokkaItemSymbolKind(item: FRItem, parentType?: string, parentSymbolKind?: string): string {
    const sig = item.syntax?.content ?? '';

    if (item.type === 'Constructor' && parentSymbolKind) return parentSymbolKind;
    if (parentType === 'Enum' && item.type === 'Field') return 'EnumMember';

    if (item.type === 'Class') {
        if (/\babstract class\b/.test(sig)) return 'AbstractClass';
        if (/\bsealed class\b/.test(sig)) return 'SealedClass';
        // companion object is handled separately; regular objects get their own Kotlin-specific kind
        if (/\bobject\b/.test(sig) && !/\bcompanion object\b/.test(sig)) return 'KotlinObject';
    }
    if (item.type === 'Method') {
        // Extension receiver check first (before other modifiers)
        if (parseExtensionReceiver(sig)) return 'ExtensionMethod';
        // override always wins — an overriding method is never abstract/virtual visually
        if (/\boverride\b/.test(sig)) return 'MethodOverride';
        // explicitly abstract → must be implemented
        if (/\babstract\b/.test(sig)) return 'MethodAbstract';
        // open → may be overridden but doesn't force it
        if (/\bopen\b/.test(sig)) return 'MethodVirtual';
        // interface methods without a body are implicitly abstract
        if (parentType === 'Interface') return 'MethodAbstract';
    }
    return item.type ?? 'misc';
}

function memberSymbolText(member: FRItem, parentType?: string): string | undefined {
    if (member.type === 'Constructor') return 'Constructor';
    if (member.type !== 'Method') return undefined;

    const sig = member.syntax?.content ?? '';
    if (parseExtensionReceiver(sig)) return 'Extension Method';

    const tokens = memberModifierTokens(member);
    // override always wins
    if (tokens.includes('override')) return 'Overridden Method';
    if (tokens.includes('abstract')) return 'Abstract Method';
    if (tokens.includes('open')) return 'Virtual Method';
    // interface methods without an explicit body are implicitly abstract
    if (parentType === 'Interface') return 'Abstract Method';

    return undefined;
}

function decorateItem(item: FRItem, parentType?: string, parentSymbolKind?: string): FRItem {
    const sig = item.syntax?.content ?? '';
    const valueType = extractTypeFromSignature(sig, item.type ?? '');
    const symbolKind = getDokkaItemSymbolKind(item, parentType, parentSymbolKind);
    const groupSymbolKind = item.type === 'Constructor' ? 'Constructor' : symbolKind;

    // For extension methods, prepend a synthetic "this: ReceiverType" parameter (no description —
    // its role is obvious from the type and the ExtensionMethod icon).
    let syntax = item.syntax;
    if (symbolKind === 'ExtensionMethod' && syntax) {
        const receiver = parseExtensionReceiver(sig);
        if (receiver) {
            const existingParams = syntax.parameters ?? [];
            syntax = {
                ...syntax,
                parameters: [
                    { id: 'this', type: receiver },
                    ...existingParams,
                ],
            };
        }
    }

    const isMember = item.type === 'Constructor' || item.type === 'Method' || item.type === 'Property' || item.type === 'Field' || item.type === 'Event' || item.type === 'Operator';
    const group = item.type === 'Namespace'
        ? symbolKindGroup('Namespace')
        : isMember
            ? memberGroupForSymbolKind(groupSymbolKind)
            : symbolKindGroup(groupSymbolKind);

    return {
        ...item,
        display: {
            ...item.display,
            kind: item.type,
            group,
            ...(isMember ? {memberGroup: group} : {}),
            symbolKind,
            symbolText: memberSymbolText(item, parentType),
            badges: memberBadges(item, false),
            leadingBadges: memberBadges(item, true),
            isStatic: item.display?.isStatic ?? false,
            valueType,
            signature: syntax,
            hasDetails: Boolean(
                normalizeText(item.summary) ||
                syntax?.parameters?.some(p => normalizeText(p.description)),
            ),
        },
    };
}

function buildReferences(
    packages: Set<string>,
    typesMap: Map<string, { fqn: string; name: string; location: string; signature: string; parent: string; children: string[] }>,
    typeKinds: Map<string, string>,
): Record<string, FRReference> {
    const references: Record<string, FRReference> = {};
    const aliases = new Map<string, Set<string>>();

    function addAlias(alias: string | undefined, uid: string) {
        const key = alias?.trim();
        if (!key || key === uid) return;
        const values = aliases.get(key) ?? new Set<string>();
        values.add(uid);
        aliases.set(key, values);
    }

    packages.forEach(pkg => {
        references[pkg] = { uid: pkg, name: pkg, fullName: pkg, isExternal: false };
    });

    for (const [fqn, typeInfo] of typesMap.entries()) {
        if (typeKinds.get(fqn) === 'CompanionObject') continue;

        references[fqn] = { uid: fqn, name: typeInfo.name, fullName: fqn, isExternal: false };
        addAlias(typeInfo.name, fqn);

        const pkg = [...packages]
            .filter((candidate) => fqn === candidate || fqn.startsWith(`${candidate}.`))
            .sort((a, b) => b.length - a.length)[0];
        const relativeName = pkg ? fqn.slice(pkg.length + 1) : undefined;
        if (relativeName) {
            const parts = relativeName.split('.');
            for (let index = 0; index < parts.length - 1; index++) {
                addAlias(parts.slice(index).join('.'), fqn);
            }
        }
    }

    for (const [alias, uids] of aliases.entries()) {
        if (uids.size !== 1 || references[alias]) continue;
        const uid = [...uids][0];
        const ref = references[uid];
        if (ref) references[alias] = ref;
    }

    return references;
}

export const parseDokkaDirectory: FRSourceParser = (dokkaDir) => {
    const indexHtmlPath = path.join(dokkaDir, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
        throw new Error(`Dokka index.html not found at ${indexHtmlPath}`);
    }
    const indexContent = fs.readFileSync(indexHtmlPath, 'utf8');
    const root = parse(indexContent);
    const packages = new Set<string>();

    const links = root.querySelectorAll('a');
    for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.endsWith('/index.html') && !href.startsWith('../') && href !== 'index.html') {
            const cleanPkgName = link.textContent?.trim();
            if (cleanPkgName) {
                packages.add(cleanPkgName);
            }
        }
    }

    const pagesJsonPath = path.join(dokkaDir, 'scripts', 'pages.json');
    if (!fs.existsSync(pagesJsonPath)) {
        throw new Error(`Dokka pages.json not found at ${pagesJsonPath}`);
    }
    const pagesData = JSON.parse(fs.readFileSync(pagesJsonPath, 'utf8')) as Array<{
        name: string;
        description: string;
        location: string;
        searchKeys?: string[];
    }>;
    const locationToUid = new Map<string, string>();
    const packageLocations = new Map<string, string>();
    for (const item of pagesData) {
        const normalizedLocation = path.posix.normalize(item.location);
        locationToUid.set(normalizedLocation, item.description);
        if (packages.has(item.description)) {
            packageLocations.set(item.description, normalizedLocation);
        }
    }

    function resolveDokkaLink(currentLocation: string, href: string): string | undefined {
        const [hrefPath] = href.split('#');
        if (!hrefPath) return undefined;

        const baseDir = path.posix.dirname(currentLocation);
        const normalized = path.posix.normalize(path.posix.join(baseDir, decodeURIComponent(hrefPath)));
        const candidates = [
            normalized,
            normalized.endsWith('/') ? `${normalized}index.html` : `${normalized}/index.html`,
            normalized.replace(/\/+$/g, ''),
        ];

        for (const candidate of candidates) {
            const uid = locationToUid.get(candidate);
            if (uid) return uid;
        }

        return undefined;
    }

    function getPackagePrefix(fqn: string): string | null {
        const parts = fqn.split('.');
        for (let i = parts.length; i > 0; i--) {
            const prefix = parts.slice(0, i).join('.');
            if (packages.has(prefix)) {
                return prefix;
            }
        }
        return null;
    }

    /**
     * Dokka uses directory-style URLs, so both type pages *and* function/property pages
     * end with "/index.html".  We distinguish them by the display name (item.name),
     * which carries the Kotlin signature prefix.
     */
    function isMemberPage(displayName: string): boolean {
        const s = displayName.trimStart();
        return (
            s.startsWith('fun ') ||
            s.startsWith('val ') ||
            s.startsWith('var ') ||
            s.startsWith('constructor')
        );
    }

    // First, map all discovered types
    const typesMap = new Map<string, { fqn: string; name: string; location: string; signature: string; parent: string; children: string[] }>();
    const typeKinds = new Map<string, string>();

    // Pass 1: Identify all types
    // Note: Dokka uses directory URLs, so function/property pages also end with
    // "/index.html".  Exclude them here; they are handled in the member pass below.
    for (const item of pagesData) {
        if (item.location.endsWith('/index.html') && !packages.has(item.description) && !isMemberPage(item.name)) {
            const fqn = item.description;
            const pkg = getPackagePrefix(fqn);
            if (!pkg) continue;

            const rel = fqn.slice(pkg.length + 1);
            const relParts = rel.split('.');
            const parentFqn = relParts.length > 1 ? pkg + '.' + relParts.slice(0, -1).join('.') : pkg;

            typesMap.set(fqn, {
                fqn,
                name: relParts[relParts.length - 1],
                location: item.location,
                signature: item.name,
                parent: parentFqn,
                children: []
            });
        }
    }

    // Pass 2: Classify all types so we can identify EnumMembers correctly
    let hasChanged = true;
    let passes = 0;

    while (hasChanged && passes++ < 10) {
        hasChanged = false;

        for (const [fqn, typeInfo] of typesMap.entries()) {
            const kind = classifyType(
                typeInfo.signature,
                typeInfo.name,
                typeInfo.parent,
                typeKinds,
            );

            if (typeKinds.get(fqn) !== kind) {
                typeKinds.set(fqn, kind);
                hasChanged = true;
            }
        }
    }

    // Identify companion objects: map companionFqn -> parentClassFqn
    const companionParentMap = new Map<string, string>();
    for (const [fqn] of typesMap.entries()) {
        if (typeKinds.get(fqn) === 'CompanionObject') {
            // The parent FQN is everything before the last segment
            const lastDot = fqn.lastIndexOf('.');
            if (lastDot > 0) {
                companionParentMap.set(fqn, fqn.slice(0, lastDot));
            }
        }
    }

    // Set up helper structure for tree hierarchy
    const tree: Record<string, { uid: string; children: string[] }> = {};
    packages.forEach(pkg => {
        tree[pkg] = { uid: pkg, children: [] };
    });
    for (const [fqn, typeInfo] of typesMap.entries()) {
        tree[fqn] = { uid: fqn, children: [] };
    }

    // Group types/members to parents
    const typeEntriesMap = new Map<string, FRItem>();
    const memberItemsMap = new Map<string, FRItem[]>(); // parentFqn -> members

    // Collect companion object supertype info: companionFqn -> { inheritance, implements }
    const companionSupertypeMap = new Map<string, { inheritance: string[]; implements: string[] }>();
    for (const [fqn] of typesMap.entries()) {
        if (typeKinds.get(fqn) !== 'CompanionObject') continue;
        const typeInfo = typesMap.get(fqn)!;
        const sig = (typeInfo.signature ?? '').trim();
        // Parse supertypes from companion object signature: "companion object Name : SuperA, SuperB"
        const colonIdx = sig.indexOf(':');
        if (colonIdx > 0) {
            const afterColon = sig.slice(colonIdx + 1).trim();
            // Simple split on commas for supertype names
            const supertypes = afterColon.split(',').map(s => s.trim()).filter(Boolean);
            companionSupertypeMap.set(fqn, { inheritance: [], implements: supertypes });
        } else {
            companionSupertypeMap.set(fqn, { inheritance: [], implements: [] });
        }
    }

    // Assign enum values as members of their parent enum type
    for (const [fqn, typeInfo] of typesMap.entries().toArray()) {
        if (typeKinds.get(fqn) !== 'EnumMember') continue;

        const member: FRItem = decorateItem({
            uid: fqn,
            id: typeInfo.name,
            parent: typeInfo.parent,
            name: typeInfo.name,
            fullName: fqn,
            type: 'Field',
        }, 'Enum');

        if (!memberItemsMap.has(typeInfo.parent)) {
            memberItemsMap.set(typeInfo.parent, []);
        }

        memberItemsMap.get(typeInfo.parent)!.push(member);
        typesMap.delete(fqn); // remove from typesMap
    }

    // Populate type entries
    for (const [fqn, typeInfo] of typesMap.entries()) {
        // Skip companion objects — they are not standalone type pages
        if (typeKinds.get(fqn) === 'CompanionObject') continue;

        const filePath = path.join(dokkaDir, typeInfo.location);
        const parsed = parseHtmlFile(filePath, true, (href) => resolveDokkaLink(typeInfo.location, href), fqn);
        const kind = typeKinds.get(fqn) || 'Class';

        // Collect companion supertypes to attach to this class
        const companionImplements: string[] = [];
        for (const [companionFqn, parentFqn] of companionParentMap.entries()) {
            if (parentFqn === fqn) {
                const info = companionSupertypeMap.get(companionFqn);
                if (info) {
                    companionImplements.push(...info.implements);
                }
            }
        }

        const item: FRItem = {
            uid: fqn,
            id: typeInfo.name,
            parent: typeInfo.parent,
            name: typeInfo.name,
            fullName: fqn,
            type: kind,
            summary: parsed.summary,
            syntax: {
                content: parsed.signature || typeInfo.signature,
                parameters: parsed.parameters,
            },
            inheritance: (() => {
                const inheritanceList: string[] = [];
                if (parsed.supertypes) {
                    for (const supertype of parsed.supertypes) {
                        const superKind = typeKinds.get(supertype);
                        if (superKind !== 'Interface') {
                            inheritanceList.push(supertype);
                        }
                    }
                }
                return inheritanceList.length > 0 ? inheritanceList : undefined;
            })(),
            implements: (() => {
                const implementsList = [...companionImplements];
                if (parsed.supertypes) {
                    for (const supertype of parsed.supertypes) {
                        const superKind = typeKinds.get(supertype);
                        if (superKind === 'Interface') {
                            implementsList.push(supertype);
                        }
                    }
                }
                return implementsList.length > 0 ? implementsList : undefined;
            })(),
        };

        typeEntriesMap.set(fqn, decorateItem(item));

        // Link in tree
        if (tree[typeInfo.parent]) {
            tree[typeInfo.parent].children.push(fqn);
        }
    }

    // Populate members
    // Includes both classic single-file pages (not ending in /index.html) and
    // directory-style function/property pages that also end in /index.html.
    for (const item of pagesData) {
        const isMember = !item.location.endsWith('/index.html') ||
            (!packages.has(item.description) && isMemberPage(item.name));
        if (isMember) {
            const fqn = item.description;
            const pkg = getPackagePrefix(fqn);
            if (!pkg) continue;

            const rel = fqn.slice(pkg.length + 1);
            const relParts = rel.split('.');
            const parentFqn = relParts.length > 1 ? pkg + '.' + relParts.slice(0, -1).join('.') : pkg;

            // If this member's direct parent is a companion object, reroute it to the
            // grandparent class as a static member instead.
            const isCompanionChild = typeKinds.get(parentFqn) === 'CompanionObject';
            const effectiveParentFqn = isCompanionChild
                ? (companionParentMap.get(parentFqn) ?? parentFqn)
                : parentFqn;

            const filePath = path.join(dokkaDir, item.location);
            const parsed = parseHtmlFile(filePath, false, (href) => resolveDokkaLink(item.location, href));
            const memberType = getMemberType(item.name);
            const effectiveParentTypeInfo = typesMap.get(effectiveParentFqn);
            const effectiveParentType = typeKinds.get(effectiveParentFqn);
            const effectiveParentSymbolKind = effectiveParentTypeInfo
                ? getDokkaItemSymbolKind({
                    uid: effectiveParentFqn,
                    type: effectiveParentType,
                    syntax: {content: effectiveParentTypeInfo.signature},
                })
                : effectiveParentType;

            const memberItem: FRItem = decorateItem({
                uid: fqn,
                id: relParts[relParts.length - 1],
                parent: effectiveParentFqn,
                name: relParts[relParts.length - 1],
                fullName: fqn,
                type: memberType,
                summary: parsed.summary,
                syntax: {
                    content: parsed.signature || item.name,
                    parameters: parsed.parameters,
                },
                // Mark as static when originating from a companion object
                ...(isCompanionChild ? { display: { isStatic: true } } : {}),
            }, effectiveParentType, effectiveParentSymbolKind);

            // When companion child, override isStatic in the decorated item
            const finalMemberItem: FRItem = isCompanionChild
                ? { ...memberItem, display: { ...memberItem.display, isStatic: true } }
                : memberItem;

            if (!memberItemsMap.has(effectiveParentFqn)) {
                memberItemsMap.set(effectiveParentFqn, []);
            }
            memberItemsMap.get(effectiveParentFqn)!.push(finalMemberItem);

            // Add to effective parent's children list (not companion's)
            if (!isCompanionChild && tree[parentFqn]) {
                tree[parentFqn].children.push(fqn);
            } else if (isCompanionChild && tree[effectiveParentFqn]) {
                tree[effectiveParentFqn].children.push(fqn);
            }
        }
    }

    const references = buildReferences(packages, typesMap, typeKinds);

    // Generate entries
    const entries: FREntry[] = [];

    // 1. Package entries
    for (const pkg of packages) {
        const packageFilePath = path.join(dokkaDir, 'krescent-core', pkg, 'index.html');
        const packageLocation = packageLocations.get(pkg) ?? `krescent-core/${pkg}/index.html`;
        const parsed = parseHtmlFile(packageFilePath, true, (href) => resolveDokkaLink(packageLocation, href), pkg);

        const packageItem: FRItem = decorateItem({
            uid: pkg,
            id: pkg,
            name: pkg,
            fullName: pkg,
            type: 'Namespace',
            summary: parsed.summary,
        });

        // Namespace members are the types directly under this package
        const namespaceMembers: FRTocItem[] = tree[pkg].children
            .filter(childUid => typesMap.has(childUid))
            .map(childUid => {
                const typeNode = typesMap.get(childUid)!;
                const kind = typeKinds.get(childUid) || 'Class';
                const decoratedNode = typeEntriesMap.get(childUid);
                const symbolKind = decoratedNode?.display?.symbolKind ?? kind;
                return {
                    uid: childUid,
                    name: typeNode.name,
                    type: kind,
                    display: {
                        kind,
                        group: symbolKindGroup(symbolKind),
                        symbolKind,
                    }
                };
            });

        // Package-level functions/properties
        const packageMembers = memberItemsMap.get(pkg) || [];

        entries.push({
            item: packageItem,
            members: packageMembers,
            namespaceMembers,
            references,
            filePath: packageFilePath,
        });
    }

    // 2. Type entries
    for (const [fqn, typeItem] of typeEntriesMap.entries()) {
        const typeInfo = typesMap.get(fqn)!;
        const filePath = path.join(dokkaDir, typeInfo.location);

        const members = memberItemsMap.get(fqn) || [];

        // Any nested types are namespaceMembers of this class page (skip companion objects — they are flattened into members)
        const nestedTypes: FRTocItem[] = tree[fqn].children
            .filter(childUid => typesMap.has(childUid) && typeKinds.get(childUid) !== 'CompanionObject')
            .map(childUid => {
                const nestedTypeNode = typesMap.get(childUid)!;
                const kind = typeKinds.get(childUid) || 'Class';
                const decoratedNode = typeEntriesMap.get(childUid);
                const symbolKind = decoratedNode?.display?.symbolKind ?? kind;
                return {
                    uid: childUid,
                    name: nestedTypeNode.name,
                    type: kind,
                    display: {
                        kind,
                        group: symbolKindGroup(symbolKind),
                        symbolKind,
                    }
                };
            });

        entries.push({
            item: typeItem,
            members,
            namespaceMembers: nestedTypes,
            references,
            filePath,
        });
    }

    // Build recursive TOC
    function buildTocItem(uid: string): FRTocItem {
        const isPackage = packages.has(uid);
        const node = typesMap.get(uid);
        const name = isPackage ? uid : (node ? node.name : uid.split('.').at(-1) || uid);
        const type = isPackage ? 'Namespace' : (typeKinds.get(uid) || 'Class');

        const childrenUids = tree[uid]?.children.filter(childUid => typesMap.has(childUid)) || [];
        const childItems = childrenUids.map(childUid => buildTocItem(childUid));

        const decoratedNode = typeEntriesMap.get(uid);
        const symbolKind = decoratedNode?.display?.symbolKind ?? type;

        return {
            uid,
            name,
            type,
            display: {
                kind: type,
                group: type === 'Namespace' ? symbolKindGroup('Namespace') : symbolKindGroup(symbolKind),
                symbolKind,
            },
            items: childItems.length > 0 ? childItems : undefined,
        };
    }

    const tocItems = Array.from(packages).sort().map(pkg => buildTocItem(pkg));
    const toc: FRToc = { items: tocItems };

    const inferredLocalPrefixes = entries
        .filter((entry) => entry.item.type === 'Namespace')
        .map((entry) => `${entry.item.uid}.`);

    return {
        toc,
        entries,
        inferredLocalPrefixes,
    };
};
