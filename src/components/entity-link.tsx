import React from 'react';
import {resolveSymbolKind} from '../symbolKinds';
import type {FREntry, FRItem, FRSourceMode, ResolvedFRSourceOptions} from '../types';
import {joinUrl, normalizeText, trimSlashes, uidAnchor, uidToSegment} from '../utils';

export type FREntityLinkProps = {
    path?: string;
    uid: string;
    baseUrl?: string;
    mode?: FRSourceMode;
    kind?: string;
    label?: React.ReactNode;
    summary?: React.ReactNode;
    className?: string;
};

type FREntityLinkData = {
    href: string;
    uid: string;
    kind?: string;
    label?: string;
    summary?: string;
};

const entityRegistry = new Map<string, FREntityLinkData>();

function entityHref({path = '', uid, baseUrl = '', mode = 'pages'}: Pick<FREntityLinkProps, 'path' | 'uid' | 'baseUrl' | 'mode'>) {
    const root = joinUrl(baseUrl, path || 'reference');
    if (mode === 'single') return `${root}#${uidAnchor(uid)}`;
    return joinUrl(root, uidToSegment(uid));
}

function registryKey(path: string, uid: string) {
    return `${trimSlashes(path)}::${uid}`;
}

function registryPaths(config: ResolvedFRSourceOptions) {
    return [
        trimSlashes(joinUrl(config.baseUrl, config.path)),
        trimSlashes(config.path),
    ];
}

function itemKind(item: FRItem) {
    return item.display?.symbolKind ?? item.display?.kind ?? item.type;
}

function itemLabel(item: FRItem) {
    return item.name ?? item.id ?? item.uid.split('.').at(-1) ?? item.uid;
}

function textSummary(value: string | undefined) {
    return normalizeText(value?.replace(/<[^>]+>/g, ' '));
}

function registerEntity(path: string, data: FREntityLinkData) {
    entityRegistry.set(registryKey(path, data.uid), data);
}

function uidMatchScore(requestedUid: string, candidateUid: string) {
    const requested = requestedUid.toLowerCase();
    const requestedSegment = uidToSegment(requestedUid).toLowerCase();
    const candidate = candidateUid.toLowerCase();
    const candidateSegment = uidToSegment(candidateUid).toLowerCase();
    const values = new Set([candidate, candidateSegment]);

    if (values.has(requested) || values.has(requestedSegment)) return 0;
    if ([...values].some((value) => value.endsWith(`.${requested}`) || value.endsWith(`.${requestedSegment}`))) return 1;
    if ([...values].some((value) => value.endsWith(requested) || value.endsWith(requestedSegment))) return 2;
    if ([...values].some((value) => value.includes(requested) || value.includes(requestedSegment))) return 3;

    return undefined;
}

function bestEntityMatch(matches: FREntityLinkData[]) {
    return matches
        .sort((left, right) => left.uid.length - right.uid.length || left.href.length - right.href.length)
        .at(0);
}

function resolveEntityFromEntries(entries: Array<[string, FREntityLinkData]>, uid: string) {
    const matches = entries
        .map(([, value]) => ({value, score: uidMatchScore(uid, value.uid)}))
        .filter((match): match is {value: FREntityLinkData; score: number} => match.score !== undefined)
        .sort((left, right) => (
            left.score - right.score
            || left.value.uid.length - right.value.uid.length
            || left.value.href.length - right.value.href.length
        ));

    const bestScore = matches[0]?.score;
    if (bestScore === undefined) return undefined;

    return bestEntityMatch(matches.filter((match) => match.score === bestScore).map((match) => match.value));
}

export function registerFREntitySource(config: ResolvedFRSourceOptions, entries: FREntry[]) {
    const paths = registryPaths(config);

    for (const key of entityRegistry.keys()) {
        if (paths.some((path) => key.startsWith(`${path}::`))) {
            entityRegistry.delete(key);
        }
    }

    for (const entry of entries) {
        const itemHref = entityHref({path: config.path, uid: entry.item.uid, baseUrl: config.baseUrl, mode: config.mode});
        const itemData: FREntityLinkData = {
            href: itemHref,
            uid: entry.item.uid,
            kind: itemKind(entry.item),
            label: itemLabel(entry.item),
            summary: textSummary(entry.item.summary),
        };

        for (const path of paths) registerEntity(path, itemData);

        for (const member of entry.members) {
            const memberData: FREntityLinkData = {
                href: itemHref,
                uid: member.uid,
                kind: itemKind(member),
                label: itemLabel(member).split('(')[0],
                summary: textSummary(member.summary),
            };

            for (const path of paths) registerEntity(path, memberData);
        }
    }
}

function resolveEntity({path, uid, baseUrl}: Pick<FREntityLinkProps, 'path' | 'uid' | 'baseUrl'>) {
    if (path) {
        return entityRegistry.get(registryKey(joinUrl(baseUrl, path), uid))
            ?? entityRegistry.get(registryKey(path, uid))
            ?? resolveEntityFromEntries(
                [...entityRegistry.entries()].filter(([key]) => (
                    key.startsWith(`${trimSlashes(joinUrl(baseUrl, path))}::`)
                    || key.startsWith(`${trimSlashes(path)}::`)
                )),
                uid,
            );
    }

    return resolveEntityFromEntries([...entityRegistry.entries()], uid);
}

function symbolKey(kind: string | undefined) {
    return kind?.toLowerCase() ?? 'misc';
}

function entityLabel(uid: string, label: React.ReactNode | undefined) {
    return label ?? uid.split('.').at(-1) ?? uid;
}

function symbolInfo(kind: string | undefined) {
    return resolveSymbolKind(kind);
}

function entityLinkTitle() {
    return 'Open Reference';
}

export function FREntityCodeLink({path, uid, baseUrl, mode, label, className}: FREntityLinkProps) {
    const entity = resolveEntity({path, uid, baseUrl});

    return (
        <a
            href={entity?.href ?? entityHref({path, uid, baseUrl, mode})}
            className={className}
            title={entityLinkTitle()}
        >
            <code>{entityLabel(uid, label ?? entity?.label)}</code>
        </a>
    );
}

export function FREntitySymbolLink({path, uid, baseUrl, mode, kind, label, className}: FREntityLinkProps) {
    const entity = resolveEntity({path, uid, baseUrl});
    const resolvedKind = kind ?? entity?.kind;
    const info = symbolInfo(resolvedKind);

    return (
        <a
            href={entity?.href ?? entityHref({path, uid, baseUrl, mode})}
            className={`inline-flex items-baseline gap-[0.3em] rounded border bg-fd-muted px-[0.35em] align-baseline font-mono text-[0.85em] font-medium leading-tight no-underline hover:bg-fd-accent ${className ?? ''}`}
            style={{color: info.color}}
            title={entityLinkTitle()}
        >
            <i className={`codicon codicon-${info.icon} inline-block w-[1em] translate-y-[0.2em] text-center text-[1em] leading-none ml-0.5 mr-0.5`} aria-hidden="true"/>
            <span className="furef-breakable docfx-breakable text-current pr-0.5">{entityLabel(uid, label ?? entity?.label)}</span>
        </a>
    );
}

export function FREntityCardLink({path, uid, baseUrl, mode, kind, label, summary, className}: FREntityLinkProps) {
    const entity = resolveEntity({path, uid, baseUrl});
    const resolvedKind = kind ?? entity?.kind;
    const resolvedSummary = summary ?? entity?.summary;
    const info = symbolInfo(resolvedKind);

    return (
        <div className={`not-prose overflow-hidden rounded-lg border bg-fd-card text-sm ${className ?? ''}`}>
            <a
                href={entity?.href ?? entityHref({path, uid, baseUrl, mode})}
                className="flex items-center gap-3 bg-fd-muted/50 px-3 py-2 no-underline hover:bg-fd-accent"
                title={entityLinkTitle()}
            >
                <span
                    className="furef-tree-label docfx-tree-label inline-flex items-center gap-1.5"
                    data-furef-symbol={symbolKey(resolvedKind)}
                    data-docfx-symbol={symbolKey(resolvedKind)}
                    style={{
                        '--docfx-symbol-color': info.color,
                        color: info.color,
                    } as React.CSSProperties}
                >
                    <i className={`codicon codicon-${info.icon} inline-flex w-4 justify-center text-sm leading-none`} aria-hidden="true"/>
                    <span className="furef-breakable docfx-breakable min-w-0 flex-1 translate-y-0.5 font-mono font-medium text-current">
                        {entityLabel(uid, label ?? entity?.label)}
                    </span>
                </span>
                {resolvedKind ? <span className="ml-auto shrink-0 text-xs text-fd-muted-foreground">{info.label}</span> : null}
            </a>
            {resolvedSummary ? <div className="border-t px-3 py-2 text-sm text-fd-muted-foreground">{resolvedSummary}</div> : null}
        </div>
    );
}
