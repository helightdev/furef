import fs from 'node:fs';
import path from 'node:path';
import {load} from 'js-yaml';
import {parse} from 'node-html-parser';
import {normalizeText} from '../utils';
import {memberGroupForSymbolKind, symbolKindGroup} from '../symbolKinds';
import type {DocfxItem, DocfxReference, DocfxSignature, DocfxToc, DocfxTocItem} from './types';
import type {
    FRBadge,
    FREntry,
    FRItem,
    FRReference,
    FRSignature,
    FRSourceParser,
    FRToc,
    FRTocItem,
} from '../types';

const memberTypes = new Set(['Constructor', 'Field', 'Property', 'Method', 'Event', 'Operator']);

type DocfxFile = {
    items?: DocfxItem[];
    references?: DocfxReference[];
};

function readYamlFile<T>(filePath: string): T {
    return load(fs.readFileSync(filePath, 'utf8')) as T;
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(value: string) {
    return escapeHtml(value).replace(/"/g, '&quot;');
}

function decodeDocfxUid(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function stripUidParameters(value: string) {
    return decodeDocfxUid(value)
        .replace(/\(.*\)/g, '')
        .replace(/\{.*\}/g, '')
        .replace(/<.*>/g, '')
        .replace(/`+\d+/g, '');
}

function simpleTypeName(uid: string) {
    return stripUidParameters(uid).split('.').at(-1) ?? uid;
}

function docfxXrefLabel(uid: string, knownTypes: Set<string>) {
    const decodedUid = decodeDocfxUid(uid);
    const uidWithoutParameters = stripUidParameters(uid);
    if (knownTypes.has(uid) || knownTypes.has(decodedUid) || knownTypes.has(uidWithoutParameters)) {
        return simpleTypeName(uid);
    }

    const ownerUid = uidWithoutParameters.split('.').slice(0, -1).join('.');
    const memberName = uidWithoutParameters.split('.').at(-1);
    if (ownerUid && memberName && knownTypes.has(ownerUid)) {
        return `${simpleTypeName(ownerUid)}.${memberName}`;
    }

    return simpleTypeName(uid);
}

function looksLikeQualifiedSymbol(value: string) {
    return /^[A-Za-z_][\w`]*(?:\.[A-Za-z_][\w`]*)+(?:[({<].*)?$/.test(decodeDocfxUid(value));
}

function normalizeDocfxContentLinks(value: string | undefined, knownTypes: Set<string>): string | undefined {
    if (!value || !value.includes('<xref')) return value;

    const root = parse(`<div>${value}</div>`);
    for (const xref of root.querySelectorAll('xref')) {
        const uid = xref.getAttribute('href') ?? xref.getAttribute('uid') ?? '';
        if (!uid) {
            xref.replaceWith(xref.innerHTML);
            continue;
        }

        const xrefContent = xref.innerHTML.trim();
        const xrefText = xref.textContent.trim();
        const label = xrefContent && xrefText !== uid && !looksLikeQualifiedSymbol(xrefText)
            ? xrefContent
            : escapeHtml(docfxXrefLabel(uid, knownTypes));
        xref.replaceWith(`<a data-furef-uid="${escapeHtmlAttribute(uid)}">${label}</a>`);
    }

    return root.querySelector('div')?.innerHTML ?? value;
}

function normalizeDocfxSignature(signature: DocfxSignature | undefined, knownTypes: Set<string>): FRSignature | undefined {
    if (!signature) return signature;

    return {
        ...signature,
        parameters: signature.parameters?.map((param) => ({
            ...param,
            description: normalizeDocfxContentLinks(param.description, knownTypes),
        })),
        typeParameters: signature.typeParameters?.map((param) => ({
            ...param,
            description: normalizeDocfxContentLinks(param.description, knownTypes),
        })),
        return: signature.return ? {
            ...signature.return,
            description: normalizeDocfxContentLinks(signature.return.description, knownTypes),
        } : undefined,
    };
}

function normalizeDocfxItemContent(item: DocfxItem, knownTypes: Set<string>): FRItem {
    return {
        ...item,
        id: normalizeDocfxMethodName(item.id),
        name: normalizeDocfxMethodName(item.name),
        nameWithType: normalizeDocfxMethodName(item.nameWithType),
        fullName: normalizeDocfxMethodName(item.fullName),
        summary: normalizeDocfxContentLinks(item.summary, knownTypes),
        remarks: normalizeDocfxContentLinks(item.remarks, knownTypes),
        syntax: normalizeDocfxSignature(item.syntax, knownTypes),
    };
}

function normalizeDocfxMethodName(value: string | undefined): string | undefined {
    return value?.replace(/(^|\.)(?:implicit|explicit)\s+operator\s+/g, '$1').trim();
}

function normalizeDocfxReference(ref: DocfxReference): FRReference {
    return {
        ...ref,
        name: normalizeDocfxMethodName(ref.name),
        fullName: normalizeDocfxMethodName(ref.fullName),
    };
}

function normalizeDocfxTocItem(item: DocfxTocItem): FRTocItem {
    return {
        ...item,
        name: normalizeDocfxMethodName(item.name),
        items: item.items?.map(normalizeDocfxTocItem),
    };
}

function flattenTocItems(items: FRTocItem[] | undefined): FRTocItem[] {
    return (items ?? []).flatMap((item) => [item, ...flattenTocItems(item.items)]);
}

function namespaceMembersFromToc(toc: FRToc) {
    const members = new Map<string, FRTocItem[]>();

    for (const item of flattenTocItems(toc.items)) {
        if (!item.uid) continue;
        if (item.items && item.items.length > 0) {
            members.set(item.uid, item.items);
        }
    }

    return members;
}

function declarationTokens(member: FRItem) {
    return member.syntax?.content?.split(/\s+/) ?? [];
}

function actualMemberType(member: FRItem): string | undefined {
    if (member.syntax?.return?.type) return member.syntax.return.type;
    if (member.type === 'Constructor') return undefined;

    const declaration = member.syntax?.content;
    if (!declaration) return member.type === 'Method' ? 'void' : member.parent?.split('.').at(-1);

    if (member.type === 'Method' || member.type === 'Operator') {
        const beforeParameters = declaration.split('(')[0]?.trim();
        const tokens = beforeParameters?.split(/\s+/) ?? [];
        if (tokens.includes('operator')) return tokens.at(-1);
        if (tokens.length >= 2) return tokens.at(-2);
    }

    const memberName = (member.id ?? member.name)?.split('(')[0];
    if (memberName) {
        const index = declaration.indexOf(`${memberName}(`);
        if (index > 0) return declaration.slice(0, index).trim().split(/\s+/).at(-1);

        const memberIndex = declaration.indexOf(` ${memberName}`);
        if (memberIndex > 0) return declaration.slice(0, memberIndex).trim().split(/\s+/).at(-1);
    }

    if (member.type === 'Method') return 'void';
    return undefined;
}

function memberSymbolKind(member: FRItem, parentType?: string, parentSymbolKind?: string) {
    const tokens = declarationTokens(member);
    if (member.type === 'Constructor' && parentSymbolKind) return parentSymbolKind;
    if (parentType === 'Enum' && member.type === 'Field') return 'EnumMember';
    if (member.type === 'Field' && tokens.includes('const')) return 'Constant';
    if (member.isExtensionMethod) return 'ExtensionMethod';
    if (member.type === 'Method' || member.type === 'Operator') {
        // override always wins — an overriding method is never abstract/virtual from the reader's perspective
        if (tokens.includes('override')) return 'MethodOverride';
        // explicitly abstract → must be implemented by subtypes
        if (tokens.includes('abstract')) return 'MethodAbstract';
        // virtual → can be overridden but not required
        if (tokens.includes('virtual')) return 'MethodVirtual';
        // interface methods without a body are implicitly abstract
        if (parentType === 'Interface' && !tokens.includes('static')) return 'MethodAbstract';
    }
    return getDocfxItemSymbolKind(member);
}

function memberSymbolText(member: FRItem, parentType?: string) {
    if (member.type === 'Constructor') return 'Constructor';
    if (member.isExtensionMethod) return 'Extension Method';
    if (member.type !== 'Method') return undefined;

    const tokens = new Set(declarationTokens(member));
    // override always wins
    if (tokens.has('override')) return 'Overridden Method';
    if (tokens.has('abstract')) return 'Abstract Method';
    if (tokens.has('virtual')) return 'Virtual Method';

    // interface methods without an explicit body are implicitly abstract
    if (parentType === 'Interface' && !tokens.has('static')) return 'Abstract Method';

    return undefined;
}

function modifierInfo(modifier: string) {
    switch (modifier) {
        case 'static':
            return {icon: 'pinned', color: 'currentColor', label: 'Static modifier'};
        case 'abstract':
            return {icon: 'symbol-interface', color: 'currentColor', label: 'Abstract member'};
        case 'virtual':
            return {icon: 'references', color: 'currentColor', label: 'Virtual member'};
        case 'override':
            return {icon: 'arrow-small-right', color: 'currentColor', label: 'Override member'};
        case 'readonly':
            return {icon: 'lock-small', color: 'currentColor', label: 'Read-only member'};
        case 'sealed':
            return {icon: 'shield', color: 'currentColor', label: 'Sealed modifier'};
        case 'async':
            return {icon: 'debug-continue', color: 'currentColor', label: 'Async modifier'};
        case 'extern':
            return {icon: 'globe', color: 'currentColor', label: 'External modifier'};
        case 'unsafe':
            return {icon: 'warning', color: 'currentColor', label: 'Unsafe modifier'};
        case 'new':
            return {icon: 'star', color: 'currentColor', label: 'New modifier'};
        case 'partial':
            return {icon: 'extensions', color: 'currentColor', label: 'Partial modifier'};
        case 'volatile':
            return {icon: 'pulse', color: 'currentColor', label: 'Volatile modifier'};
        default:
            return {icon: 'symbol-keyword', color: 'currentColor', label: `${modifier} modifier`};
    }
}

function visibilityInfo(visibility: string) {
    switch (visibility) {
        case 'protected':
            return {icon: 'shield', color: '#75beff', label: 'Protected visibility'};
        case 'private':
            return {icon: 'lock', color: '#f14c4c', label: 'Private visibility'};
        case 'internal':
            return {icon: 'package', color: '#cca700', label: 'Internal visibility'};
        default:
            return {icon: 'eye', color: 'currentColor', label: `${visibility} visibility`};
    }
}

function memberModifierTokens(member: FRItem) {
    const tokens = declarationTokens(member);
    const modifiers: string[] = [];

    if (modifiers.includes("implicit operator")) {
        modifiers.push("implicit operator");
    } else if (modifiers.includes("explicit operator")) {
        modifiers.push("explicit operator");
    }

    for (const modifier of [
        'static',
        'abstract',
        'virtual',
        'override',
        'readonly',
        'sealed',
        'async',
        'extern',
        'unsafe',
        'new',
        'partial',
        'volatile',
    ]) {
        if ((member.isExtensionMethod || member.type === 'Operator') && modifier === 'static') continue;
        if (tokens.includes(modifier)) modifiers.push(modifier);
    }

    return modifiers;
}

function memberBadges(member: FRItem, leading: boolean): FRBadge[] {
    const tokens = new Set(declarationTokens(member));
    const badges: FRBadge[] = [];

    for (const visibility of ['private', 'protected', 'internal']) {
        if (!tokens.has(visibility)) continue;
        badges.push({
            key: `visibility-${visibility}`,
            text: visibility,
            ...visibilityInfo(visibility),
        });
    }

    for (const modifier of memberModifierTokens(member)) {
        if (leading && (modifier === 'override' || modifier === 'virtual' || modifier === 'abstract')) continue;
        badges.push({
            key: `modifier-${modifier}`,
            text: modifier,
            ...modifierInfo(modifier),
        });
    }

    return badges;
}

function hasMemberDetails(member: FRItem) {
    const valueType = actualMemberType(member);

    return Boolean(
        normalizeText(member.summary) ||
        normalizeText(member.remarks) ||
        (member.type !== 'Method' && member.syntax?.typeParameters?.some((param) => normalizeText(param.description))) ||
        member.syntax?.parameters?.some((param) => normalizeText(param.description)) ||
        (
            valueType &&
            valueType !== 'void' &&
            (member.type === 'Method' || member.type === 'Operator') &&
            normalizeText(member.syntax?.return?.description)
        ),
    );
}

function getDocfxItemSymbolKind(item: FRItem): string {
    if (item.type === 'Class') {
        const content = item.syntax?.content ?? '';
        if (content.includes('static class')) return 'StaticClass';
        if (content.includes('abstract class')) return 'AbstractClass';
        if (content.includes('sealed class')) return 'SealedClass';
    }
    return item.type ?? 'misc';
}

function decorateItem(item: FRItem, parentType?: string, parentSymbolKind?: string): FRItem {
    let valueType = actualMemberType(item);
    let signature = item.syntax;
    const symbolKind = memberSymbolKind(item, parentType, parentSymbolKind);
    const groupSymbolKind = item.type === 'Constructor' ? 'Constructor' : symbolKind;
    const isMember = memberTypes.has(item.type ?? '');
    const group = item.type === 'Namespace'
        ? symbolKindGroup('Namespace')
        : isMember
            ? memberGroupForSymbolKind(groupSymbolKind)
            : symbolKindGroup(groupSymbolKind);
    if (symbolKind === "EnumMember") {
        valueType = undefined;
        if (signature) signature.return = undefined;
    }

    return {
        ...item,
        display: {
            ...item.display,
            kind: item.type,
            group,
            ...(isMember ? {memberGroup: group} : {}),
            symbolKind: symbolKind,
            symbolText: memberSymbolText(item, parentType),
            badges: memberBadges(item, false),
            leadingBadges: memberBadges(item, true),
            isStatic: memberModifierTokens(item).includes('static'),
            valueType,
            signature,
            hasDetails: hasMemberDetails(item),
        },
    };
}

function decorateTocItems(items: FRTocItem[] | undefined): FRTocItem[] | undefined {
    return items?.map((item) => {
        const symbolKind = getDocfxItemSymbolKind({uid: item.uid ?? item.name ?? 'unknown', type: item.type});
        return {
            ...item,
            display: {
                ...item.display,
                kind: item.type,
                group: item.type === 'Namespace' ? symbolKindGroup('Namespace') : symbolKindGroup(symbolKind),
                symbolKind,
            },
            items: decorateTocItems(item.items),
        };
    });
}

function restructureTocItems(items: FRTocItem[] | undefined, typeParentMap: Map<string, string>): FRTocItem[] | undefined {
    if (!items) return undefined;
    
    const restructured = items.map(item => {
        if (item.type === 'Namespace' && item.items) {
            return {
                ...item,
                items: restructureTocItems(item.items, typeParentMap)
            };
        }
        return item;
    });

    // Group items in this level by nested classes
    const itemMap = new Map<string, FRTocItem>();
    const roots: FRTocItem[] = [];

    for (const item of restructured) {
        if (item.uid) {
            itemMap.set(item.uid, { ...item, items: item.items ?? [] });
        } else {
            roots.push(item);
        }
    }

    for (const item of restructured) {
        if (!item.uid) continue;
        const mappedItem = itemMap.get(item.uid)!;
        const parentUid = typeParentMap.get(item.uid);

        if (parentUid && itemMap.has(parentUid)) {
            const parentItem = itemMap.get(parentUid)!;
            if (!parentItem.items) parentItem.items = [];
            parentItem.items.push(mappedItem);
        } else {
            roots.push(mappedItem);
        }
    }

    function cleanEmptyItems(itemsList: FRTocItem[]): FRTocItem[] {
        return itemsList.map(it => {
            const res = { ...it };
            if (res.items && res.items.length === 0) {
                delete res.items;
            } else if (res.items) {
                res.items = cleanEmptyItems(res.items);
            }
            return res;
        });
    }

    return cleanEmptyItems(roots);
}

function readEntries(
    docfxDir: string,
    files: string[],
    namespaceMembersByUid: Map<string, FRTocItem[]>,
    knownTypes: Set<string>,
): FREntry[] {
    return files
        .map((file) => {
            const filePath = path.join(docfxDir, file);
            const doc = readYamlFile<DocfxFile>(filePath);
            const normalizedItems = doc.items?.map((item) => normalizeDocfxItemContent(item, knownTypes)) ?? [];
            const rawItem = normalizedItems.find((candidate) => !memberTypes.has(candidate.type ?? ''));
            const item = rawItem ? decorateItem(rawItem) : undefined;
            if (!item) return undefined;

            return {
                item,
                members: normalizedItems.filter(
                    (candidate) => candidate.parent === item.uid && memberTypes.has(candidate.type ?? ''),
                ).map((member) => decorateItem(member, item.type, item.display?.symbolKind)),
                namespaceMembers: namespaceMembersByUid.get(item.uid) ?? [],
                references: Object.fromEntries((doc.references ?? []).map((ref) => [ref.uid, normalizeDocfxReference(ref)])),
                filePath,
            };
        })
        .filter((entry): entry is FREntry => Boolean(entry));
}

export const parseDocfxDirectory: FRSourceParser = (docfxDir) => {
    const files = fs.readdirSync(docfxDir).filter((file) => file.endsWith('.yml') && file !== 'toc.yml');
    
    // Pass 1: Scan files to collect all known type UIDs and their types
    const knownTypes = new Set<string>();
    const uidToType = new Map<string, string>();
    for (const file of files) {
        const filePath = path.join(docfxDir, file);
        const doc = readYamlFile<DocfxFile>(filePath);
        const rawItem = doc.items?.find((candidate) => !memberTypes.has(candidate.type ?? ''));
        if (rawItem?.uid) {
            knownTypes.add(rawItem.uid);
            if (rawItem.type) {
                uidToType.set(rawItem.uid, rawItem.type);
            }
        }
    }

    // Pass 2: Map child type UIDs to parent type UIDs (skipping Namespace types)
    const typeParentMap = new Map<string, string>();
    for (const uid of knownTypes) {
        const type = uidToType.get(uid);
        if (type === 'Namespace') continue;

        let current = uid;
        while (true) {
            const lastDot = current.lastIndexOf('.');
            if (lastDot <= 0) break;
            current = current.slice(0, lastDot);
            if (knownTypes.has(current) && uidToType.get(current) !== 'Namespace') {
                typeParentMap.set(uid, current);
                break;
            }
        }
    }

    // Pass 3: Load and restructure TOC
    const rawToc = readYamlFile<DocfxToc>(path.join(docfxDir, 'toc.yml'));
    const normalizedTocItems = rawToc.items?.map(normalizeDocfxTocItem);
    const restructuredItems = restructureTocItems(normalizedTocItems, typeParentMap);
    const decoratedItems = decorateTocItems(restructuredItems);
    const toc: FRToc = { items: decoratedItems };

    // Pass 4: Build namespaceMembers maps
    const namespaceMembersByUid = namespaceMembersFromToc(toc);

    // Pass 5: Read all entries
    const entries = readEntries(docfxDir, files, namespaceMembersByUid, knownTypes);
    const inferredLocalPrefixes = entries
        .filter((entry) => entry.item.type === 'Namespace')
        .map((entry) => `${entry.item.uid}.`);

    return {
        toc,
        entries,
        inferredLocalPrefixes,
    };
};
