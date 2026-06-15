import path from 'node:path';
import React from 'react';
import {source as createSource} from 'fumadocs-core/source';
import {NodeType, parse as parseHtml} from 'node-html-parser';
import type {Root, Node as PageTreeNode} from 'fumadocs-core/page-tree';
import type {HTMLElement, Node as HtmlNode, TextNode} from 'node-html-parser';
import {parseDocfxDirectory} from './docfx';
import {parseDokkaDirectory} from './dokka';
import {registerFREntitySource} from './components/entity-link';
import {groupMembers, resolveSymbolKind, symbolKindGroup, TOC_GROUP_PRIORITY} from './symbolKinds';
import {
    joinUrl,
    normalizeText,
    pathSegments,
    sectionId,
    trimSlashes,
    uidAnchor,
    uidToFileName,
    uidToSegment
} from './utils';
import type {
    FRSourceParser,
    FREntry,
    FRItem,
    FRPageData,
    FRReference,
    FRSourceContextValue,
    FRSourceOptions,
    ResolvedFRSourceOptions,
    FRToc,
    FRTocItem,
} from './types';

const defaultFurefOptions: ResolvedFRSourceOptions = {
    dir: path.join(process.cwd(), 'docfx'),
    mode: 'pages',
    title: 'API',
    baseUrl: '',
    path: 'api',
    navigation: {
        root: 'folder',
        namespaces: 'folder',
    },
    localUidPrefixes: [],
    hiddenUidPrefixes: [],
    externalLinkPrefixes: {},
    collapseAllMembers: false,
    expandable: true,
    hierarchicalNamespaces: true,
    showSummaryInList: true,
    compactTreeNames: false,
    memberStyle: 'table',
};

type DeclarationBadge = {
    key: string;
    text: string;
    icon: string;
    color: string;
    label: string;
};

export function isFRPageData(data: unknown): data is FRPageData {
    return Boolean(data && typeof data === 'object' && 'type' in data && (data.type === 'furef' || data.type === 'docfx'));
}

function furefRootUrl(config: ResolvedFRSourceOptions) {
    return joinUrl(config.baseUrl, config.path);
}

function uidToUrl(uid: string, config: ResolvedFRSourceOptions): string {
    if (config.mode === 'single') return `${furefRootUrl(config)}#${uidAnchor(uid)}`;
    return joinUrl(config.baseUrl, config.path, uidToSegment(uid));
}

function symbolInfo(kind: string | undefined) {
    return resolveSymbolKind(kind);
}

function visibilityInfo(visibility: string) {
    switch (visibility) {
        case 'protected':
            return {icon: 'shield', color: 'var(--furef-color-protected, #75beff)', label: 'Protected visibility'};
        case 'private':
            return {icon: 'lock', color: 'var(--furef-color-private, #f14c4c)', label: 'Private visibility'};
        case 'internal':
            return {icon: 'package', color: 'var(--furef-color-internal, #cca700)', label: 'Internal visibility'};
        default:
            return {icon: 'eye', color: 'currentColor', label: `${visibility} visibility`};
    }
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
            return {icon: 'history', color: 'currentColor', label: 'Async modifier'};
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

function symbolKey(kind: string | undefined) {
    return kind?.toLowerCase() ?? 'misc';
}

function BreakableText({value, suppressCamel = false}: { value: string; suppressCamel?: boolean }) {
    const parts: React.ReactNode[] = [];
    const genericStart = value.indexOf('<');

    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        const previous = value[index - 1];
        const next = value[index + 1];
        const camelBoundary =
            !suppressCamel &&
            (genericStart < 0 || index > genericStart) &&
            index > 0 &&
            /[A-Z]/.test(char) &&
            next !== '<' &&
            ((previous && /[a-z0-9]/.test(previous)) || (previous && /[A-Z]/.test(previous) && next && /[a-z]/.test(next)));

        if (camelBoundary || char === '<' || char === '{') {
            parts.push(<wbr key={`before-${index}`}/>);
        }

        parts.push(char);

        if (['.', '/', '\\', ','].includes(char)) {
            parts.push(<wbr key={`after-${index}`}/>);
        }
    }

    return parts;
}

export function SymbolBadge({
                                kind,
                                showText = true,
                                customText = undefined,
                            }: {
    kind: string | undefined;
    customText?: string;
    showText?: boolean;
}) {
    const info = symbolInfo(kind);
    const text = customText ?? info.label ?? kind ?? 'Symbol';

    return (
        <span
            className="inline-flex items-center gap-1.5 font-mono text-[0.85em] font-medium leading-none"
            style={{color: info.color}}
            title={text}
            aria-label={text}
        >
      <i className={`codicon codicon-${info.icon} inline-flex w-4 justify-center text-sm leading-none`}
         aria-hidden="true"/>
            {showText && kind ? <span>{text}</span> : null}
    </span>
    );
}

function TreeLabel({
                       kind,
                       compact = false,
                       children,
                   }: {
    kind: string | undefined;
    compact?: boolean;
    children: React.ReactNode;
}) {
    const info = symbolInfo(kind);

    return (
        <span
            className={`furef-tree-label docfx-tree-label inline-flex items-center ${compact ? 'gap-1 text-[0.9em] leading-tight' : 'gap-1.5'}`}
            data-furef-symbol={symbolKey(kind)}
            data-docfx-symbol={symbolKey(kind)}
            style={{'--docfx-symbol-color': info.color} as React.CSSProperties}
        >
      <SymbolBadge kind={kind} showText={false}/>
      <span className="furef-breakable docfx-breakable min-w-0">{typeof children === 'string' ?
          <BreakableText value={children}/> : children}</span>
    </span>
    );
}

function code({
                  children,
                  compact = false,
                  plain = false,
              }: {
    children: React.ReactNode;
    compact?: boolean;
    plain?: boolean;
}) {
    const className = plain
        ? 'furef-breakable docfx-breakable font-mono !text-current'
        : compact
            ? 'furef-breakable docfx-breakable font-mono text-[0.85em] text-current'
            : 'furef-breakable docfx-breakable rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[0.85em] text-current';

    if (plain) {
        return (
            <span className={className}>
        {typeof children === 'string' ? <BreakableText value={children}/> : children}
      </span>
        );
    }

    return (
        <code className={className}>
            {typeof children === 'string' ? <BreakableText value={children}/> : children}
        </code>
    );
}

function Badge({children}: { children: React.ReactNode }) {
    return (
        <span className="rounded border bg-fd-muted px-2 py-0.5 text-xs font-medium text-fd-muted-foreground">
      {children}
    </span>
    );
}

function DeclarationBadge({badge, showText = true, color,}: {
    badge: DeclarationBadge;
    showText?: boolean;
    color?: string;
}) {
    return (
        <span
            className={
                showText
                    ? 'inline-flex items-center gap-1.5 font-mono font-medium leading-none'
                    : 'inline-flex size-4 items-center justify-center leading-none'
            }
            style={{color: color ?? badge.color}}
            title={badge.label}
            aria-label={badge.label}
        >
      <i className={`codicon codicon-${badge.icon} inline-flex w-4 justify-center text-sm leading-none`}
         aria-hidden="true"/>
            {showText ? <span>{badge.text}</span> : null}
    </span>
    );
}

function Section({id, title, children}: {
    id: string;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section id={id} className="scroll-m-24">
            <h2>{title}</h2>
            {children}
        </section>
    );
}

function SymbolLinkList({items, emptyText, context, depth = 0, references}: {
    items: FRTocItem[];
    emptyText: string;
    context: FRSourceContextValue;
    depth?: number;
    references?: Record<string, FRReference>;
}) {
    const sortedItems = sortTocItems(items);

    if (sortedItems.length === 0) {
        if (depth === 0) {
            return <p className="text-sm text-fd-muted-foreground">{emptyText}</p>;
        }
        return null;
    }

    const isCardStyle = context.config.memberStyle === 'card';

    if (isCardStyle && depth === 0) {
        return (
            <div className="not-prose text-sm flex flex-col gap-3 my-6">
                {sortedItems.map((item, index) => {
                    if (!item.uid) return null;

                    const kind = context.uidToSymbolKind.get(item.uid) ?? item.type;
                    const childNamespaces = item.items?.filter(child => (child.display?.group ?? child.type) === 'Namespaces') ?? [];

                    return (
                        <div key={`${item.uid}-${index}`} className="rounded-lg border bg-fd-card overflow-hidden">
                            <a
                                className="flex items-center gap-3 px-3 py-2 no-underline bg-fd-muted/50 hover:bg-fd-accent"
                                style={{paddingLeft: `${(depth + 1) * 0.75}rem`}}
                                href={uidToUrl(item.uid, context.config)}
                            >
                                <SymbolBadge kind={kind} showText={false}/>
                                <span className="min-w-0 flex-1 font-mono font-medium text-current">
                                    <BreakableText value={item.name ?? item.uid}/>
                                </span>
                                {kind ? (
                                    <span className="shrink-0 text-xs text-fd-muted-foreground">
                                        {symbolInfo(kind).label}
                                    </span>
                                ) : null}
                            </a>
                            {context.config.showSummaryInList && item.display?.summary && (
                                <div
                                    className="px-3 py-2 border-t"
                                    style={{paddingLeft: `${(depth + 1) * 0.75 + 1.75}rem`}}
                                >
                                    <FRContent text={item.display.summary} refs={references ?? {}} context={context}/>
                                </div>
                            )}
                            {childNamespaces.length > 0 && (
                                <SymbolLinkList
                                    items={childNamespaces}
                                    emptyText=""
                                    context={context}
                                    depth={depth + 1}
                                    references={references}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        );
    }

    return (
        <div className={`not-prose text-sm ${depth === 0 ? 'my-6 overflow-hidden rounded-lg border bg-fd-card' : ''}`}>
            {sortedItems.map((item, index) => {
                if (!item.uid) return null;

                const kind = context.uidToSymbolKind.get(item.uid) ?? item.type;
                const childNamespaces = item.items?.filter(child => (child.display?.group ?? child.type) === 'Namespaces') ?? [];

                return (
                    <div key={`${item.uid}-${index}`} className={depth === 0 ? 'border-b last:border-b-0' : ''}>
                        <a
                            className="flex items-center gap-3 px-3 py-2 no-underline bg-fd-muted/50 hover:bg-fd-accent"
                            style={{paddingLeft: `${(depth + 1) * 0.75}rem`}}
                            href={uidToUrl(item.uid, context.config)}
                        >
                            <SymbolBadge kind={kind} showText={false}/>
                            <span className="min-w-0 flex-1 font-mono font-medium text-current">
                                <BreakableText value={item.name ?? item.uid}/>
                            </span>
                            {kind ? (
                                <span className="shrink-0 text-xs text-fd-muted-foreground">
                                    {symbolInfo(kind).label}
                                </span>
                            ) : null}
                        </a>
                        {context.config.showSummaryInList && item.display?.summary && (
                            <div
                                className="px-3 py-2 border-t"
                                style={{paddingLeft: `${(depth + 1) * 0.75 + 1.75}rem`}}
                            >
                                <FRContent text={item.display.summary} refs={references ?? {}} context={context}/>
                            </div>
                        )}
                        {childNamespaces.length > 0 && (
                            <SymbolLinkList
                                items={childNamespaces}
                                emptyText=""
                                context={context}
                                depth={depth + 1}
                                references={references}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function namespaceMemberGroupTitle(type: string | undefined) {
    return type ?? 'Members';
}

function groupNamespaceMembers(items: FRTocItem[], config: ResolvedFRSourceOptions = defaultFurefOptions) {
    const sortedItems = sortTocItems(items);

    if (config.collapseAllMembers) {
        return [{title: 'Members', items: sortedItems}];
    }

    return Array.from(Map.groupBy(sortedItems, (item) => namespaceMemberGroupTitle(item.display?.group ?? item.type)), ([title, group]) => ({
        title,
        items: group,
    }));
}

function NamespaceMemberSections({items, baseId, config, context, references}: {
    items: FRTocItem[];
    baseId: string;
    config?: ResolvedFRSourceOptions;
    context: FRSourceContextValue;
    references?: Record<string, FRReference>;
}) {
    const activeConfig = config ?? defaultFurefOptions;
    const groups = groupNamespaceMembers(items, activeConfig);

    if (items.length === 0) {
        return (
            <Section id={`${baseId}-members`} title="Members">
                <SymbolLinkList items={[]} emptyText="No members were found in this namespace." context={context}
                                references={references}/>
            </Section>
        );
    }

    return (
        <>
            {groups.map((group) => (
                <Section id={`${baseId}-${sectionId(group.title)}`} title={group.title} key={group.title}>
                    <SymbolLinkList items={group.items} emptyText="No members were found in this namespace."
                                    context={context} references={references}/>
                </Section>
            ))}
        </>
    );
}

function linkForType(
    type: string | undefined,
    refs: Record<string, FRReference>,
    context: FRSourceContextValue,
) {
    if (!type) return undefined;
    const ref = refs[type];
    if (ref?.href?.startsWith('http')) return ref.href;
    if (ref?.isExternal && ref.href) return ref.href;
    if (ref?.uid && context.localUids.has(ref.uid)) return uidToUrl(ref.uid, context.config);

    const localUid = resolveLocalUid(type, context);
    if (localUid) return uidToUrl(localUid, context.config);

    return externalLinkForUid(ref?.uid ?? type, context.config);
}

function linkForUid(uid: string, refs: Record<string, FRReference>, context: FRSourceContextValue) {
    const ref = refs[uid];
    if (ref?.href?.startsWith('http')) return ref.href;
    if (ref?.isExternal && ref.href) return ref.href;
    if (context.localUids.has(uid)) return uidToUrl(uid, context.config);

    const memberOwner = findMemberOwnerUid(uid);
    if (memberOwner && context.localUids.has(memberOwner)) return uidToUrl(memberOwner, context.config);

    return externalLinkForUid(ref?.uid ?? uid, context.config);
}

function externalLinkForUid(uid: string | undefined, config: ResolvedFRSourceOptions) {
    if (!uid) return undefined;

    const match = Object.entries(config.externalLinkPrefixes)
        .filter(([prefix]) => prefix.length > 0 && (uid === prefix || uid.startsWith(prefix)))
        .at(0);

    if (!match) return undefined;

    const [prefix, target] = match;
    if (typeof target === 'function') return target(uid, prefix);

    const suffix = uid.slice(prefix.length).replace(/^[./]+/g, '');
    return suffix ? joinUrl(target, suffix) : target;
}

function findMemberOwnerUid(uid: string) {
    const parenIndex = uid.indexOf('(');
    const searchable = parenIndex >= 0 ? uid.slice(0, parenIndex) : uid;
    const dotIndex = searchable.lastIndexOf('.');
    return dotIndex > 0 ? searchable.slice(0, dotIndex) : undefined;
}

function resolveLocalUid(type: string, context: FRSourceContextValue) {
    if (context.localUids.has(type)) return type;
    if (type.length === 1 || !type.includes('.')) return undefined;
    if (
        context.config.localUidPrefixes.length > 0 &&
        !context.config.localUidPrefixes.some((prefix) => type === prefix.slice(0, -1) || type.startsWith(prefix))
    ) {
        return undefined;
    }

    return [...context.localUids].find((uid) => uid.startsWith(`${type}\``));
}

function renderLinkedLabel(label: string, href: string | undefined, compact = false, plain = false) {
    const content = code({children: label, compact, plain});
    return href ? (
        <a
            className={`underline decoration-fd-muted-foreground/40 underline-offset-2 hover:decoration-current ${plain ? 'text-current!' : ''}`}
            href={href}
        >
            {content}
        </a>
    ) : (
        content
    );
}

function splitTopLevel(value: string) {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (char === '{' || char === '<') depth++;
        if (char === '}' || char === '>') depth--;
        if (char === ',' && depth === 0) {
            parts.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }

    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
}

function splitGenericType(type: string) {
    const start = type.indexOf('{');
    if (start < 0 || !type.endsWith('}')) return undefined;

    return {
        outer: type.slice(0, start),
        inner: splitTopLevel(type.slice(start + 1, -1)),
    };
}

function splitAngleGenericType(type: string) {
    const start = type.indexOf('<');
    if (start < 0 || !type.endsWith('>')) return undefined;

    return {
        outer: type.slice(0, start),
        inner: splitTopLevel(type.slice(start + 1, -1)),
    };
}

function normalizeRenderedType(type: string) {
    return type
        .trim()
        .replace(/\s+/g, ' ')
        // .replace(/^suspend\s+/, '')
        // .replace(/^(in|out)\s+/, '')
        // .replace(/\s*&\s*Any\b/g, '')
        .replace(/\?+$/g, '');
}

function renderType(
    type: string | undefined,
    refs: Record<string, FRReference>,
    context: FRSourceContextValue,
    compact = false,
    plain = false,
): React.ReactNode {
    if (!type) return undefined;
    if (type.startsWith("{") && type.endsWith("}")) {
        type = type.slice(1, -1);
    }
    const nullableSuffix = type.trim().match(/\?+$/)?.[0] ?? '';
    type = normalizeRenderedType(type);

    const generic = splitGenericType(type) ?? splitAngleGenericType(type);

    if (generic) {
        const outerLabel = refs[generic.outer]?.name ?? lastTypeSegment(generic.outer) ?? generic.outer;
        const outerHref = linkForType(generic.outer, refs, context);

        if (outerLabel.length > 0) {

            const content = (
                <span>
        {outerHref ? (
            <a
                className={`underline decoration-fd-muted-foreground/40 underline-offset-2 hover:decoration-current ${plain ? 'text-current!' : ''}`}
                href={outerHref}
            >
                <BreakableText value={outerLabel} suppressCamel/>
            </a>
        ) : (
            <BreakableText value={outerLabel} suppressCamel/>
        )}
                    <wbr/>
                    {'<'}
                    {generic.inner.map((inner, index) => (
                        <React.Fragment key={`${inner}-${index}`}>
                            {index > 0 ? (
                                <>
                                    {','}
                                    <wbr/>
                                </>
                            ) : null}
                            {renderType(inner, refs, context, true, true)}
                        </React.Fragment>
                    ))}
                    {'>'}
                    {nullableSuffix}
      </span>
            );

            if (plain) {
                return (<span className="furef-breakable docfx-breakable font-mono text-current!">{content}</span>);
            }

            return (
                <code
                    className={
                        compact
                            ? 'furef-breakable docfx-breakable font-mono text-[0.85em]'
                            : 'furef-breakable docfx-breakable rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[0.85em]'
                    }
                >
                    {content}
                </code>
            );
        }
    }

    const label = `${refs[type]?.name ?? lastTypeSegment(type) ?? type}${nullableSuffix}`;
    return renderLinkedLabel(label, linkForType(type, refs, context), compact, plain);
}

function ParameterDefault({value}: { value: string | undefined }) {
    if (!value) return null;

    return (
        <>
            <span className="text-fd-muted-foreground"> = </span>
            {code({children: value, compact: true, plain: true})}
        </>
    );
}

function lastTypeSegment(type: string | undefined) {
    return type?.split('.').at(-1);
}

function FRContent({text, refs, context, inline = false,}: {
    text: string | undefined;
    refs: Record<string, FRReference>;
    context: FRSourceContextValue;
    inline?: boolean;
}) {
    if (!text) return null;

    if (!text.includes('<') && !text.includes('&')) {
        return <>{text}</>;
    }

    function renderTag(name: string, props: Record<string, string>, children: React.ReactNode[], key: string, forceInline = false) {
        switch (name) {
            case 'p':
                if (inline || forceInline) return <React.Fragment key={key}>{children}</React.Fragment>;
                return <p key={key} className="mb-4 last:mb-0">{children}</p>;
            case 'code':
                return <code key={key}
                             className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[0.85em] text-current">{children}</code>;
            case 'em':
            case 'i':
                return <em key={key}>{children}</em>;
            case 'strong':
            case 'b':
                return <strong key={key}>{children}</strong>;
            case 'br':
                return <br key={key}/>;
            case 'hr':
                return <hr key={key} className="my-4"/>;
            case 'ul':
                return <ul key={key} className="list-disc pl-6 mb-4">{children}</ul>;
            case 'ol':
                return <ol key={key} className="list-decimal pl-6 mb-4">{children}</ol>;
            case 'li':
                return <li key={key} className="mb-1">{children}</li>;
            case 'a': {
                const uid = props['data-furef-uid'] ? decodeURIComponent(props['data-furef-uid']) : undefined;
                const href = uid ? linkForUid(uid, refs, context) : props.href;
                if (!href) return <React.Fragment key={key}>{children}</React.Fragment>;
                return <a key={key} href={href}
                          className="underline decoration-fd-muted-foreground/40 underline-offset-2 hover:decoration-current">{children}</a>;
            }
            default:
                return <React.Fragment key={key}>{children}</React.Fragment>;
        }
    }

    function renderNode(node: HtmlNode, key: string, forceInline = false): React.ReactNode {
        if (node.nodeType === NodeType.TEXT_NODE) {
            return (node as TextNode).text;
        }

        if (node.nodeType !== NodeType.ELEMENT_NODE) return null;

        const element = node as HTMLElement;
        const name = element.rawTagName.toLowerCase();
        const children = element.childNodes.map((child, index) => renderNode(child, `${key}-${index}`));
        return renderTag(name, element.attributes, children, key, forceInline);
    }

    const root = parseHtml(`<div>${text}</div>`);
    const wrapper = root.querySelector('div');
    const childNodes = wrapper?.childNodes ?? root.childNodes;

    // Auto-inline the first paragraph to avoid leading dead space
    let firstPSeen = false;
    const nodes = Array.from(childNodes).map((node, index) => {
        const isFirstP = !firstPSeen &&
            node.nodeType === NodeType.ELEMENT_NODE &&
            (node as HTMLElement).rawTagName.toLowerCase() === 'p';
        if (isFirstP) firstPSeen = true;
        return renderNode(node, `node-${index}`, isFirstP);
    });

    return <span>{nodes}</span>;
}

function normalizePathForCompare(value: string) {
    return value.replaceAll('\\', '/').replace(/\/+$/g, '');
}

function trimSourcePath(sourcePath: string, basePath?: string) {
    const activeBasePath = basePath ?? defaultFurefOptions.sourceBasePath;
    if (!activeBasePath) return sourcePath.replace(/\\/g, '/').replace(/^\/+/g, '');

    const normalizedSource = sourcePath.replace(/\\/g, '/');
    const normalizedBase = activeBasePath.replace(/\\/g, '/').replace(/\/+$/g, '');
    const index = normalizedSource.toLowerCase().indexOf(normalizedBase.toLowerCase());
    if (index < 0) return normalizedSource.replace(/^\/+/g, '');

    return normalizedSource.slice(index + normalizedBase.length).replace(/^\/+/g, '');
}

function hasMemberDetails(member: FRItem) {
    if (member.display?.hasDetails !== undefined) return member.display.hasDetails;
    const signature = member.display?.signature ?? member.syntax;
    return Boolean(
        normalizeText(member.summary) ||
        normalizeText(member.remarks) ||
        signature?.parameters?.some((param) => normalizeText(param.description)),
    );
}

function MemberDetails({member, refs, context,}: {
    member: FRItem;
    refs: Record<string, FRReference>;
    context: FRSourceContextValue;
}) {
    if (!hasMemberDetails(member)) return null;

    const description = normalizeText(member.summary);
    const remarks = normalizeText(member.remarks);
    const signature = member.display?.signature ?? member.syntax;
    const parameters = signature?.parameters ?? [];
    const typeParameters = signature?.typeParameters ?? [];
    const valueType = member.display?.valueType ?? signature?.return?.type;
    const badges = member.display?.badges ?? [];

    const documentedParameters = parameters
        .filter((param) => normalizeText(param.description));
    const documentedTypeParameters = typeParameters
        .filter((param) => normalizeText(param.description));

    return (
        <div className="grid gap-4 p-3 border-t">
            {description ? <FRContent text={description} refs={refs} context={context}/> : null}
            {remarks ? <div className="flex-col flex">
                <span className="font-medium text-fd-muted-foreground mb-1">Remarks</span>
                <FRContent text={remarks} refs={refs} context={context}/>
            </div> : null}

            {documentedTypeParameters.length > 0 ? (
                <div className="grid gap-2">
                    <p className="text-xs font-medium uppercase text-fd-muted-foreground">Type Parameters</p>
                    {documentedTypeParameters.map((param, index) => (
                        <div className="flex flex-wrap items-baseline gap-1.5"
                             key={`${param.id ?? 'type-param'}-${index}`}>
                            <code className="font-mono">{param.id}</code>
                            <span className="inline-flex min-w-0 items-baseline gap-1.5">
                                <span className="shrink-0 text-fd-muted-foreground">-</span>
                                <span><FRContent text={param.description} refs={refs} context={context} inline/></span>
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}

            {parameters.length > 0 && documentedParameters.length > 0 ? (
                <div className="grid gap-2">
                    <p className="text-xs font-medium uppercase text-fd-muted-foreground mb-0 mt-0">Parameters</p>
                    {documentedParameters.map((param, index) => (
                        <div className="min-w-0" key={`${param.id ?? 'param'}-${index}`}>
                            <span className="min-w-0 break-words">
                                <span className="inline-flex min-w-0 flex-wrap items-baseline gap-1.5">
                                    <span className="font-mono">{param.id ?? 'value'}</span>
                                    {param.type ? (
                                        <>
                                            <span className="text-fd-muted-foreground">:</span>
                                            {renderType(param.type, refs, context, true)}
                                        </>
                                    ) : null}
                                </span>
                                <span className="text-fd-muted-foreground">{'\u00a0-\u00a0'}</span>
                                <FRContent text={param.description} refs={refs} context={context} inline/>
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}

            {valueType && signature?.return?.description && valueType !== 'void' ? (
                <div className="flex flex-wrap items-baseline gap-1.5">
                    <p className="text-xs font-medium uppercase text-fd-muted-foreground mb-0 mt-0">Returns</p>
                    {renderType(valueType, refs, context, true)}
                    {normalizeText(signature.return.description) ? (
                        <span className="inline-flex min-w-0 items-baseline gap-1.5">
                            <span className="shrink-0 text-fd-muted-foreground">-</span>
                            <span><FRContent text={signature.return.description} refs={refs} context={context} inline/></span>
                        </span>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function MemberTable({members, refs, kind, parentType, config, context,}: {
    members: FRItem[];
    refs: Record<string, FRReference>;
    kind: string;
    parentType?: string;
    config?: ResolvedFRSourceOptions;
    context: FRSourceContextValue;
}) {
    const activeConfig = config ?? defaultFurefOptions;
    const isCardStyle = activeConfig.memberStyle === 'card';
    const containerClass = isCardStyle
        ? "@container flex flex-col gap-4 my-6"
        : "@container my-6 overflow-hidden rounded-lg border bg-fd-card text-sm";
    const itemClass = isCardStyle
        ? "rounded-lg border bg-fd-card text-sm overflow-hidden"
        : "border-b last:border-b-0";

    return (
        <div className={containerClass}>
            {members.map((member, memberIndex) => {
                const signature = member.display?.signature ?? member.syntax;
                const valueType = member.display?.valueType ?? signature?.return?.type;
                const badges = member.display?.leadingBadges ?? [];
                const symbolKind = member.display?.symbolKind ?? member.display?.kind ?? member.type;
                const symbolText = member.display?.symbolText;
                const symbol = symbolInfo(symbolKind);
                const parameters = signature?.parameters ?? [];
                const canExpand = activeConfig.expandable && hasMemberDetails(member);

                const summaryContent = (<>
	            <span className="min-w-0 flex-1 flex-wrap font-mono font-medium"
                      style={{color: symbol.color}}>
                    <span className="inline-flex align-middle items-center gap-1.5 mr-2 whitespace-nowrap pb-0.5">
	                <SymbolBadge kind={symbolKind} showText={false} customText={symbolText}/>
                        {badges.map((badge) => (
                            <DeclarationBadge badge={badge} showText={false} color={symbol.color} key={badge.key}/>
                        ))}
                    </span>
                    <span className="furef-breakable docfx-breakable min-w-0 text-current!">
                         {(member.name ?? member.id ?? member.uid).split('(')[0]}
                        {member.type === 'Method' || member.type === 'Constructor' || member.type === 'Operator' ? (
                            <>
                                <span className={'text-fd-foreground'}>
                                    {'('}
                                    {parameters.map((param, index) => (
                                        <React.Fragment key={`${param.id ?? 'param'}-${index}`}>
                                            {index > 0 && ', '}
                                            <span className={'text-fd-primary'}>{param.id ?? 'value'}</span>
                                            <span>: </span>
                                            {param.type && (
                                                <span
                                                    className={'text-fd-foreground'}>{renderType(param.type, refs, context, true, true)}</span>
                                            )}
                                            <ParameterDefault value={param.defaultValue}/>
                                        </React.Fragment>
                                    ))}
                                    {')'}
                                </span>
                            </>
                        ) : null}
                        {valueType && (
                            <span className="text-fd-foreground font-normal">
                                : {renderType(valueType, refs, context, false, true)}
                            </span>
                        )}
                    </span>
                </span></>
                );

                const expandIndicator = (
                    <span
                        className="ml-auto inline-flex size-4 shrink-0 items-center justify-center text-fd-muted-foreground transition-transform group-open:rotate-90"
                        aria-hidden="true"
                    >
                        <i className="codicon codicon-chevron-right text-sm leading-none"/>
                    </span>
                );

                if (!activeConfig.expandable) {
                    return (
                        <div className={itemClass} key={`${member.uid}-${memberIndex}`}>
                            <div className="flex items-center gap-x-8 md:gap-8 gap-y-2 px-3 py-2 bg-fd-muted/50">
                                {summaryContent}
                            </div>
                            <MemberDetails member={member} refs={refs} context={context}/>
                        </div>
                    );
                }

                if (!canExpand) {
                    return (
                        <div className={itemClass} key={`${member.uid}-${memberIndex}`}>
                            <div className="flex items-center gap-3 px-3 py-2 bg-fd-muted/50">
                                {summaryContent}
                            </div>
                        </div>
                    );
                }

                return (
                    <details className={`group ${itemClass}`} key={`${member.uid}-${memberIndex}`}>
                        <summary
                            className="flex list-none cursor-pointer items-center gap-3 px-3 py-2 bg-fd-muted/50 hover:bg-fd-accent [&::-webkit-details-marker]:hidden">
                            {summaryContent}
                            {expandIndicator}
                        </summary>
                        <MemberDetails member={member} refs={refs} context={context}/>
                    </details>
                );
            })}
        </div>
    );
}

export function SourceLabel({source, config,}: {
    source: FRItem['source'];
    config?: ResolvedFRSourceOptions;
}) {
    const activeConfig = config ?? defaultFurefOptions;
    if (!source?.path) return null;

    const trimmedPath = trimSourcePath(source.path, activeConfig.sourceBasePath);
    const line = source.startLine ? `#L${source.startLine}` : '';

    let href: string | undefined;
    if (activeConfig.vcsRoot) {
        const baseUrl = activeConfig.vcsRoot.replace(/\/+$/, '');
        href = `${baseUrl}/${trimmedPath}${line}`;
    }

    const label = <BreakableText value={`${trimmedPath}${source.startLine ? `:${source.startLine}` : ''}`}/>;

    return href ? (
        <a
            href={href}
            className="furef-breakable docfx-breakable font-mono text-[0.85em] underline decoration-fd-muted-foreground/40 underline-offset-2 hover:decoration-current"
            target="_blank"
            rel="noopener noreferrer"
        >
            {label}
        </a>
    ) : (
        <span
            className="furef-breakable docfx-breakable font-mono text-[0.85em] decoration-fd-muted-foreground/40 p-0.5">{label}</span>
    );
}

function trimMemberUid(uid: string): string {
    return uid
        .replace(/\(.*\)/g, '')
        .replace(/\{.*\}/g, '')
        .replace(/<.*>/g, '')
        .replace(/`\d+/g, '');
}

function InlineLinkList({entries, refs, context,}: {
    entries: string[];
    refs: Record<string, FRReference>;
    context: FRSourceContextValue;
}) {
    const processed = Array.from(new Set(entries.map(trimMemberUid))).map((trimmed) => {
        // Find a suitable original entry to determine if it's local
        const possibleOriginals = entries.filter((e) => trimMemberUid(e) === trimmed);
        const original =
            possibleOriginals.find((e) => {
                const typeUid = e.split('(')[0].split('{')[0].split('.').slice(0, -1).join('.');
                return context.localUids.has(typeUid) || context.localUids.has(e);
            }) ?? possibleOriginals[0];

        const typeUid = original.split('(')[0].split('{')[0].split('.').slice(0, -1).join('.');
        const isLocal = context.localUids.has(typeUid) || context.localUids.has(original);

        const label = refs[original]?.name ?? lastTypeSegment(trimmed) ?? trimmed;
        const trimmedLabel = label
            .replace(/\(.*\)/g, '')
            .replace(/\{.*\}/g, '')
            .replace(/<.*>/g, '')
            .replace(/`\d+/g, '');

        return {
            trimmed,
            original,
            isLocal,
            label: trimmedLabel,
        };
    });

    return (
        <div className="not-prose flex flex-wrap gap-2 text-sm">
            {processed.map(({trimmed, original, label}) => {
                const link = linkForUid(original, refs, context);
                return (
                    <span key={trimmed}>
            {link ? (
                <a
                    className="underline decoration-fd-muted-foreground/40 underline-offset-2 hover:decoration-current"
                    href={link}
                >
                    {code({children: label})}
                </a>
            ) : (
                code({children: label})
            )}
          </span>
                );
            })}
        </div>
    );
}

export function getItemSymbolKind(item: FRItem): string {
    if (item.display?.symbolKind) return item.display.symbolKind;
    return item.display?.kind ?? item.type ?? 'misc';
}

function FRTypeBlock({item, members, namespaceMembers = [], references, config, context, nested = false,}: {
    item: FRItem;
    members: FRItem[];
    namespaceMembers?: FRTocItem[];
    references: Record<string, FRReference>;
    config?: ResolvedFRSourceOptions;
    context: FRSourceContextValue;
    nested?: boolean;
}) {
    const activeConfig = config ?? defaultFurefOptions;
    const groupedMembers = groupMembers(members, activeConfig.collapseAllMembers);
    const signature = item.display?.signature ?? item.syntax;
    const symbolKind = item.display?.symbolKind ?? item.display?.kind ?? item.type;
    const hasInfoPanel = Boolean(
        (signature?.typeParameters && signature.typeParameters.length > 0) ||
        (signature?.parameters && signature.parameters.length > 0) ||
        (item.inheritance && item.inheritance.length > 0) ||
        (item.implements && item.implements.length > 0) ||
        item.source?.path,
    );

    return (
        <section id={uidAnchor(item.uid)} className={nested ? 'scroll-m-24 border-t pt-8' : 'scroll-m-24'}>
            {nested ? (
                <h2>
                    <a className="no-underline" href={`#${uidAnchor(item.uid)}`}>
                        {item.name ?? item.uid}
                    </a>
                </h2>
            ) : null}

            {item.summary ? <FRContent text={item.summary} refs={references} context={context}/> : null}
            {item.remarks ? <FRContent text={item.remarks} refs={references} context={context}/> : null}

            {hasInfoPanel ? (
                <div className="not-prose my-6 grid gap-2 rounded-lg border bg-fd-card p-4 text-sm">
                    {signature?.typeParameters && signature.typeParameters.length > 0 ? (
                        <div className="flex flex-row gap-2">
                            <span className="font-medium text-fd-muted-foreground">Type Parameters</span>
                            {signature.typeParameters.map((param, index) => (
                                <div className="flex flex-wrap items-baseline gap-1.5"
                                     key={`${param.id ?? 'type-param'}-${index}`}>
                                    <code className="font-mono">{param.id}</code>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {signature?.parameters && signature.parameters.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            <span className="font-medium text-fd-muted-foreground">Parameters</span>
                            <div className="grid gap-1.5 pl-4">
                                {signature.parameters.map((param, index) => (
                                    <div className="min-w-0" key={`${param.id ?? 'param'}-${index}`}>
                                        <span className="min-w-0 wrap-break-word">
                                            <span className="inline-flex min-w-0 flex-wrap items-baseline gap-1.5">
                                                <code className="font-mono">{param.id}</code>
                                                {param.type && (
                                                    <>
                                                        <span className="text-fd-muted-foreground">:</span>
                                                        {renderType(param.type, references, context, true)}
                                                    </>
                                                )}
                                                <ParameterDefault value={param.defaultValue}/>
                                            </span>
                                            {normalizeText(param.description) ? (
                                                <>
                                                    <span className="text-fd-muted-foreground">{'\u00a0-\u00a0'}</span>
                                                    <FRContent text={param.description} refs={references}
                                                               context={context} inline/>
                                                </>
                                            ) : null}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {item.inheritance && item.inheritance.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            <span className="font-medium text-fd-muted-foreground">Inheritance</span>
                            {item.inheritance.map((entry) => (
                                <span
                                    key={entry}>{renderType(entry, references, context) ?? renderLinkedLabel(entry, linkForUid(entry, references, context))}</span>
                            ))}
                        </div>
                    ) : null}

                    {item.implements && item.implements.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            <span className="font-medium text-fd-muted-foreground">Implements</span>
                            {item.implements.map((entry) => (
                                <span
                                    key={entry}>{renderType(entry, references, context) ?? renderLinkedLabel(entry, linkForUid(entry, references, context))}</span>
                            ))}
                        </div>
                    ) : null}

                    {item.source?.path ? (
                        <div className="flex flex-wrap gap-2">
                            <span className="font-medium text-fd-muted-foreground">Source</span>
                            <SourceLabel source={item.source} config={config}/>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {((item.display?.group ?? item.type) === 'Namespaces' || (namespaceMembers && namespaceMembers.length > 0)) ? (
                <NamespaceMemberSections items={namespaceMembers} baseId={uidAnchor(item.uid)} config={activeConfig}
                                         context={context} references={references}/>
            ) : null}

            {groupedMembers.map(({title, kind, members: group}) => (
                <Section id={`${uidAnchor(item.uid)}-${sectionId(title)}`} title={title} key={title}>
                    <MemberTable members={group} refs={references} kind={kind} parentType={item.type}
                                 config={activeConfig} context={context}/>
                </Section>
            ))}

            {item.inheritedMembers && item.inheritedMembers.length > 0 ? (
                <Section id={`${uidAnchor(item.uid)}-inherited-members`} title="Inherited Members">
                    <InlineLinkList entries={item.inheritedMembers} refs={references} context={context}/>
                </Section>
            ) : null}

            {item.extensionMethods && item.extensionMethods.length > 0 ? (
                <Section id={`${uidAnchor(item.uid)}-extension-methods`} title="Extension Methods">
                    <InlineLinkList entries={item.extensionMethods} refs={references} context={context}/>
                </Section>
            ) : null}
        </section>
    );
}

function FRBody({item, members, namespaceMembers, references, config, context,}: {
    item: FRItem;
    members: FRItem[];
    namespaceMembers?: FRTocItem[];
    references: Record<string, FRReference>;
    config?: ResolvedFRSourceOptions;
    context: FRSourceContextValue;
}) {
    return <FRTypeBlock item={item} members={members} namespaceMembers={namespaceMembers} references={references}
                        config={config} context={context}/>;
}

function FRSingleBody({entries, config, context,}: {
    entries: FREntry[];
    config?: ResolvedFRSourceOptions;
    context: FRSourceContextValue;
}) {
    return (
        <>
            {entries.map((entry, index) => (
                <FRTypeBlock
                    item={entry.item}
                    members={entry.members}
                    namespaceMembers={entry.namespaceMembers}
                    references={entry.references}
                    config={config}
                    context={context}
                    nested
                    key={`${entry.item.uid}-${index}`}
                />
            ))}
        </>
    );
}

function tocItemLabel(item: FRTocItem) {
    return item.name ?? item.uid ?? 'Unknown';
}

function pageMarkdown(
    item: FRItem,
    members: FRItem[],
    namespaceMembers: FRTocItem[] = [],
    config: ResolvedFRSourceOptions = defaultFurefOptions,
): string {
    const lines = [`# ${item.name ?? item.uid}`, ''];
    const signature = item.display?.signature ?? item.syntax;
    if (signature?.content) lines.push('```', signature.content, '```', '');
    if (item.summary) lines.push(item.summary, '');
    if (item.remarks) lines.push(item.remarks, '');

    if ((item.display?.group ?? item.type) === 'Namespaces' && namespaceMembers.length > 0) {
        for (const group of groupNamespaceMembers(namespaceMembers, config)) {
            lines.push(`## ${group.title}`, '');
            for (const member of group.items) {
                lines.push(`- ${tocItemLabel(member)}`);
            }
            lines.push('');
        }
    }

    for (const member of members) {
        const memberSignature = member.display?.signature ?? member.syntax;
        lines.push(`## ${member.name ?? member.uid}`, '');
        if (memberSignature?.content) lines.push('```', memberSignature.content, '```', '');
        if (member.summary) lines.push(member.summary, '');
    }

    return lines.join('\n').trim();
}

function createPageData(entry: FREntry, context: FRSourceContextValue): FRPageData {
    const markdown = pageMarkdown(entry.item, entry.members, entry.namespaceMembers, context.config);
    const title = entry.item.name ?? entry.item.uid;
    const groupedMembers = groupMembers(entry.members, context.config.collapseAllMembers);
    const namespaceGroups = ((entry.item.display?.group ?? entry.item.type) === 'Namespaces' || entry.namespaceMembers.length > 0)
        ? groupNamespaceMembers(entry.namespaceMembers, context.config)
        : [];
    const payload = {
        uid: entry.item.uid,
        kind: entry.item.display?.kind ?? entry.item.type,
        item: entry.item,
        members: entry.members,
        references: entry.references,
        markdown,
        config: context.config,
    };

    return {
        type: 'furef',
        title,
        description: undefined,
        toc: [
            ...namespaceGroups.map((group) => ({
                title: group.title,
                url: `#${uidAnchor(entry.item.uid)}-${sectionId(group.title)}`,
                depth: 2,
            })),
            ...groupedMembers.map((group) => ({
                title: group.title,
                url: `#${uidAnchor(entry.item.uid)}-${sectionId(group.title)}`,
                depth: 2,
            })),
            ...(entry.item.inheritedMembers?.length
                ? [{title: 'Inherited Members', url: `#${uidAnchor(entry.item.uid)}-inherited-members`, depth: 2}]
                : []),
            ...(entry.item.extensionMethods?.length
                ? [{title: 'Extension Methods', url: `#${uidAnchor(entry.item.uid)}-extension-methods`, depth: 2}]
                : []),
            ...(entry.item.source?.path ? [{
                title: 'Source',
                url: `#${uidAnchor(entry.item.uid)}-source`,
                depth: 2
            }] : []),
        ],
        body: () => (
            <FRBody
                item={entry.item}
                members={entry.members}
                namespaceMembers={entry.namespaceMembers}
                references={entry.references}
                config={context.config}
                context={context}
            />
        ),
        furef: payload,
        docfx: payload,
        structuredData: () => ({
            headings: [
                {id: 'overview', content: title},
                ...namespaceGroups.map((group) => ({id: sectionId(group.title), content: group.title})),
                ...groupedMembers.map((group) => ({id: sectionId(group.title), content: group.title})),
            ],
            contents: [{heading: title, content: markdown}],
        }),
    };
}

function createSinglePageData(entries: FREntry[], context: FRSourceContextValue): FRPageData {
    const markdown = entries
        .map((entry) => pageMarkdown(entry.item, entry.members, entry.namespaceMembers, context.config))
        .join('\n\n');

    const payload = {
        uid: context.config.path,
        kind: context.config.title,
        item: entries[0]?.item ?? {uid: context.config.path, name: context.config.title, type: 'Namespace'},
        members: entries.flatMap((entry) => entry.members),
        references: Object.assign({}, ...entries.map((entry) => entry.references)),
        markdown,
        config: context.config,
    };

    return {
        type: 'furef',
        title: context.config.title,
        description: undefined,
        full: true,
        toc: entries.map((entry) => ({
            title: entry.item.name ?? entry.item.uid,
            url: `#${uidAnchor(entry.item.uid)}`,
            depth: (entry.item.display?.group ?? entry.item.type) === 'Namespaces' ? 2 : 3,
        })),
        body: () => <FRSingleBody entries={entries} config={context.config} context={context}/>,
        furef: payload,
        docfx: payload,
        structuredData: () => ({
            headings: entries.map((entry) => ({
                id: uidAnchor(entry.item.uid),
                content: entry.item.name ?? entry.item.uid,
            })),
            contents: entries.map((entry) => ({
                heading: entry.item.name ?? entry.item.uid,
                content: pageMarkdown(entry.item, entry.members, entry.namespaceMembers, context.config),
            })),
        }),
    };
}

function serializeNamespaceTocToMarkdown(items: FRTocItem[], depth: number = 0): string[] {
    const lines: string[] = [];
    const indent = '  '.repeat(depth);
    for (const item of items) {
        lines.push(`${indent}- ${tocItemLabel(item)}`);
        const childNamespaces = item.items?.filter(child => (child.display?.group ?? child.type) === 'Namespaces') ?? [];
        if (childNamespaces.length > 0) {
            lines.push(...serializeNamespaceTocToMarkdown(sortTocItems(childNamespaces), depth + 1));
        }
    }
    return lines;
}

function createIndexPageData(namespaces: FRTocItem[], context: FRSourceContextValue): FRPageData {
    const markdown = [
        `# ${context.config.title}`,
        '',
        '## Namespaces',
        '',
        ...serializeNamespaceTocToMarkdown(sortTocItems(namespaces)),
    ].join('\n');

    const payload = {
        uid: context.config.path,
        kind: context.config.title,
        item: {uid: context.config.path, name: context.config.title, type: 'Namespace'},
        members: [],
        references: {},
        markdown,
        config: context.config,
    };

    return {
        type: 'furef',
        title: context.config.title,
        description: undefined,
        toc: [{title: 'Namespaces', url: '#namespaces', depth: 2}],
        body: () => (
            <Section id="namespaces" title="Namespaces">
                <SymbolLinkList items={namespaces} emptyText="No namespaces were found." context={context}/>
            </Section>
        ),
        furef: payload,
        docfx: payload,
        structuredData: () => ({
            headings: [{id: 'namespaces', content: 'Namespaces'}],
            contents: [{heading: context.config.title, content: markdown}],
        }),
    };
}

// TOC group sort order is derived from the canonical registry.
// 'Types' and 'Members' are appended as catch-alls for any group not in the registry.
const tocGroupPriority = [...TOC_GROUP_PRIORITY, 'Types', 'Members'];

function sortTocItems(items: FRTocItem[] | undefined): FRTocItem[] {
    return [...(items ?? [])]
        .sort((left, right) => {
            const leftGroup = left.display?.group ?? left.type ?? '';
            const rightGroup = right.display?.group ?? right.type ?? '';
            if (leftGroup !== rightGroup) {
                const priorityA = tocGroupPriority.indexOf(leftGroup);
                const priorityB = tocGroupPriority.indexOf(rightGroup);
                const aIdx = priorityA === -1 ? 99 : priorityA;
                const bIdx = priorityB === -1 ? 99 : priorityB;
                if (aIdx !== bIdx) {
                    return aIdx - bIdx;
                }
            }

            return (left.name ?? left.uid ?? '').localeCompare(right.name ?? right.uid ?? '', undefined, {
                numeric: true,
                sensitivity: 'base',
            });
        })
        .map((item) => ({
            ...item,
            items: sortTocItems(item.items),
        }));
}

function flattenTocItems(items: FRTocItem[] | undefined): FRTocItem[] {
    return (items ?? []).flatMap((item) => [item, ...flattenTocItems(item.items)]);
}

function namespacesFromToc(toc: FRToc): FRTocItem[] {
    return flattenTocItems(toc.items).filter((item) => item.uid && (item.display?.group ?? item.type) === 'Namespaces');
}

function createTocPageNode(node: FRTocItem, context: FRSourceContextValue) {
    if (!node.uid) return undefined;
    const url = uidToUrl(node.uid, context.config);
    const kind = context.uidToSymbolKind.get(node.uid) ?? node.type;
    const compact = context.config.compactTreeNames;

    return {
        type: 'page' as const,
        name: <TreeLabel kind={kind} compact={compact}>{node.name ?? node.uid}</TreeLabel>,
        url,
    };
}

function tocNodeToPageTree(node: FRTocItem, context: FRSourceContextValue): PageTreeNode[] {
    if (!node.uid) return [];
    const page = createTocPageNode(node, context);
    if (!page) return [];

    const children = sortTocItems(node.items).flatMap((child) => tocNodeToPageTree(child, context));
    const kind = context.uidToSymbolKind.get(node.uid) ?? node.type;
    const isNamespace = (node.display?.group ?? node.type) === 'Namespaces';
    const compact = context.config.compactTreeNames;

    if (!isNamespace && context.config.navigation.namespaces === 'toc') {
        return children;
    }

    if (children.length === 0 || context.config.mode === 'single') return [page];

    const container = isNamespace ? context.config.navigation.namespaces : 'folder';

    if (container === 'none' || container === 'toc') {
        return children;
    }

    if (container === 'header') {
        return [
            {
                type: 'separator' as const,
                name: <TreeLabel kind={kind} compact={compact}>{node.name ?? node.uid}</TreeLabel>,
            },
            ...children,
        ];
    }

    return [{
        type: 'folder',
        name: <TreeLabel kind={kind} compact={compact}>{node.name ?? node.uid}</TreeLabel>,
        defaultOpen: false,
        index: page,
        children,
    }];
}

function restructureNamespaces(items: FRTocItem[] | undefined, hierarchical: boolean): FRTocItem[] {
    if (!items) return [];
    if (!hierarchical) return items;

    const namespaces = items.filter((item) => (item.display?.group ?? item.type) === 'Namespaces');
    const nonNamespaces = items.filter((item) => (item.display?.group ?? item.type) !== 'Namespaces');

    const namespaceMap = new Map<string, FRTocItem>();
    for (const ns of namespaces) {
        if (ns.uid) {
            namespaceMap.set(ns.uid, {
                ...ns,
                items: ns.items ? [...ns.items] : [],
            });
        }
    }

    const roots: FRTocItem[] = [];

    for (const ns of namespaces) {
        if (!ns.uid) continue;
        const mappedNs = namespaceMap.get(ns.uid)!;

        // Find the longest prefix parent namespace in our map
        let parentUid: string | null = null;
        let current = ns.uid;
        while (true) {
            const lastDot = current.lastIndexOf('.');
            if (lastDot <= 0) break;
            current = current.slice(0, lastDot);
            if (namespaceMap.has(current)) {
                parentUid = current;
                break;
            }
        }

        if (parentUid) {
            const parentNs = namespaceMap.get(parentUid)!;
            const prefix = parentUid + '.';
            if (mappedNs.name && mappedNs.name.startsWith(prefix)) {
                mappedNs.name = mappedNs.name.slice(prefix.length);
            }
            parentNs.items = parentNs.items || [];
            parentNs.items.push(mappedNs);
        } else {
            roots.push(mappedNs);
        }
    }

    for (const ns of namespaceMap.values()) {
        if (ns.items) {
            ns.items = restructureNamespaces(ns.items, hierarchical);
        }
    }

    return [...roots, ...nonNamespaces];
}

function createFurefPageTree(toc: FRToc, context: FRSourceContextValue): Root {
    const children = sortTocItems(toc.items).flatMap((node) => tocNodeToPageTree(node, context));
    const rootUrl = furefRootUrl(context.config);
    const rootPage = {
        type: 'page' as const,
        name: context.config.title,
        url: rootUrl,
    };

    if (context.config.mode === 'single') {
        return {
            type: 'root',
            name: context.config.title,
            children: [rootPage],
        };
    }

    if (context.config.navigation.root === 'toc') {
        return {
            type: 'root',
            name: context.config.title,
            children: [rootPage],
        };
    }

    if (context.config.navigation.root === 'none') {
        return {
            type: 'root',
            name: context.config.title,
            children,
        };
    }

    if (context.config.navigation.root === 'header') {
        return {
            type: 'root',
            name: context.config.title,
            children: [
                {
                    type: 'separator',
                    name: context.config.title,
                },
                ...children,
            ],
        };
    }

    return {
        type: 'root',
        name: context.config.title,
        children: [
            {
                type: 'folder',
                name: context.config.title,
                defaultOpen: true,
                index: rootPage,
                children,
            },
        ],
    };
}

function normalizeExternalLinkPrefixes(value: FRSourceOptions['externalLinkPrefixes']) {
    return Object.fromEntries(
        Object.entries(value ?? {})
            .filter(([prefix, target]) => prefix.length > 0 && (typeof target === 'function' || target.length > 0))
            .sort(([left], [right]) => right.length - left.length)
            .map(([prefix, target]) => [
                prefix,
                typeof target === 'string' ? target.replace(/\/+$/g, '') : target,
            ]),
    );
}

function normalizeUidPrefixes(value: string[] | undefined) {
    return [...new Set(value?.filter((prefix) => prefix.length > 0) ?? [])]
        .sort((left, right) => right.length - left.length);
}

function isHiddenUid(uid: string | undefined, prefixes: string[]) {
    return Boolean(uid && prefixes.some((prefix) => uid === prefix || uid.startsWith(prefix)));
}

function filterTocItems(items: FRTocItem[] | undefined, hiddenUidPrefixes: string[]): FRTocItem[] {
    return (items ?? [])
        .filter((item) => !isHiddenUid(item.uid, hiddenUidPrefixes))
        .map((item) => ({
            ...item,
            items: filterTocItems(item.items, hiddenUidPrefixes),
        }));
}

function filterItemHiddenLinks(item: FRItem, hiddenUidPrefixes: string[]): FRItem {
    return {
        ...item,
        inheritance: item.inheritance?.filter((uid) => !isHiddenUid(uid, hiddenUidPrefixes)),
        inheritedMembers: item.inheritedMembers?.filter((uid) => !isHiddenUid(uid, hiddenUidPrefixes)),
        extensionMethods: item.extensionMethods?.filter((uid) => !isHiddenUid(uid, hiddenUidPrefixes)),
        implements: item.implements?.filter((uid) => !isHiddenUid(uid, hiddenUidPrefixes)),
    };
}

function filterEntries(entries: FREntry[], hiddenUidPrefixes: string[]): FREntry[] {
    return entries
        .filter((entry) => !isHiddenUid(entry.item.uid, hiddenUidPrefixes))
        .map((entry) => ({
            ...entry,
            item: filterItemHiddenLinks(entry.item, hiddenUidPrefixes),
            members: entry.members
                .filter((member) => !isHiddenUid(member.uid, hiddenUidPrefixes))
                .map((member) => filterItemHiddenLinks(member, hiddenUidPrefixes)),
            namespaceMembers: filterTocItems(entry.namespaceMembers, hiddenUidPrefixes),
        }));
}

export function createFurefSource(options: FRSourceOptions = {}, parser: FRSourceParser = parseDocfxDirectory) {
    const configuredDir = options.dir ?? options.directory ?? defaultFurefOptions.dir;
    const sourceDir = path.isAbsolute(configuredDir) ? configuredDir : path.join(/*turbopackIgnore: true*/ process.cwd(), configuredDir);
    const parsed = parser(sourceDir);
    const hiddenUidPrefixes = normalizeUidPrefixes(options.hiddenUidPrefixes);
    const entries = filterEntries(parsed.entries, hiddenUidPrefixes);
    const toc: FRToc = {
        ...parsed.toc,
        items: filterTocItems(parsed.toc.items, hiddenUidPrefixes),
    };
    const localUids = new Set<string>();
    const uidToSymbolKind = new Map<string, string>();
    const uidToSummary = new Map<string, string>();

    for (const entry of entries) {
        localUids.add(entry.item.uid);
        uidToSymbolKind.set(entry.item.uid, getItemSymbolKind(entry.item));
        if (entry.item.summary) {
            uidToSummary.set(entry.item.uid, entry.item.summary);
        }
    }

    const config: ResolvedFRSourceOptions = {
        dir: sourceDir,
        mode: options.mode ?? 'pages',
        title: options.title ?? 'API',
        baseUrl: options.baseUrl?.replace(/\/+$/g, '') ?? '',
        path: options.path === undefined ? 'api' : trimSlashes(options.path),
        navigation: {
            root: options.navigation?.root ?? 'folder',
            namespaces: options.navigation?.namespaces ?? 'folder',
        },
        localUidPrefixes: options.localUidPrefixes ?? parsed.inferredLocalPrefixes,
        hiddenUidPrefixes,
        externalLinkPrefixes: normalizeExternalLinkPrefixes(options.externalLinkPrefixes),
        sourceBasePath: options.sourceBasePath,
        vcsRoot: options.vcsRoot,
        collapseAllMembers: options.collapseAllMembers ?? false,
        expandable: options.expandable ?? true,
        hierarchicalNamespaces: options.hierarchicalNamespaces ?? true,
        showSummaryInList: options.showSummaryInList ?? true,
        compactTreeNames: options.compactTreeNames ?? false,
        memberStyle: options.memberStyle ?? 'table',
    };
    const context: FRSourceContextValue = {
        config,
        localUids,
        uidToSymbolKind,
    };
    registerFREntitySource(config, entries);

    const restructuredTocItems = restructureNamespaces(toc.items ?? [], config.hierarchicalNamespaces);

    function decorateTocGroups(items: FRTocItem[] | undefined): FRTocItem[] | undefined {
        return items?.map(item => {
            const actualKind = item.uid ? uidToSymbolKind.get(item.uid) : undefined;
            const updatedGroup = actualKind ? symbolKindGroup(actualKind, item.display?.group ?? item.type ?? 'Types') : (item.display?.group ?? item.type);
            return {
                ...item,
                display: {
                    ...item.display,
                    group: updatedGroup,
                    symbolKind: actualKind ?? item.display?.symbolKind,
                    summary: item.uid ? uidToSummary.get(item.uid) : undefined,
                },
                items: decorateTocGroups(item.items),
            };
        });
    }

    const resolvedToc: FRToc = {...toc, items: decorateTocGroups(restructuredTocItems)};

    const pages =
        config.mode === 'single'
            ? [
                {
                    type: 'page' as const,
                    path: joinUrl(config.path, 'index.tsx').replace(/^\//, ''),
                    slugs: pathSegments(config.path),
                    data: createSinglePageData(entries, context),
                },
            ]
            : [
                {
                    type: 'page' as const,
                    path: joinUrl(config.path, 'index.tsx').replace(/^\//, ''),
                    slugs: pathSegments(config.path),
                    data: createIndexPageData(
                        (resolvedToc.items ?? []).filter((item) => (item.display?.group ?? item.type) === 'Namespaces'),
                        context
                    ),
                },
                ...entries.map((entry) => {
                    let finalNamespaceMembers = entry.namespaceMembers ? [...entry.namespaceMembers] : [];

                    if (entry.item.type === 'Namespace') {
                        const parentUid = entry.item.uid;
                        // Find all namespaces from all entries
                        const allNamespaces = entries
                            .filter((e) => e.item.type === 'Namespace')
                            .map((e) => e.item);

                        // Find namespaces that are direct children of parentUid (e.g. parentUid.child with no extra dots)
                        const directChildren = allNamespaces.filter((ns) => {
                            if (ns.uid === parentUid) return false;
                            if (!ns.uid.startsWith(parentUid + '.')) return false;
                            const remaining = ns.uid.substring(parentUid.length + 1);
                            return !remaining.includes('.');
                        });

                        const directChildTocItems = directChildren.map((ns) => ({
                            name: ns.name ?? ns.uid,
                            uid: ns.uid,
                            type: 'Namespace',
                        }));

                        const existingUids = new Set(finalNamespaceMembers.map((m) => m.uid).filter(Boolean));
                        for (const childItem of directChildTocItems) {
                            if (!existingUids.has(childItem.uid)) {
                                finalNamespaceMembers.push(childItem);
                            }
                        }
                    }

                    const decoratedNamespaceMembers = finalNamespaceMembers.map((nsMember) => {
                        const actualKind = nsMember.uid ? (uidToSymbolKind.get(nsMember.uid) ?? nsMember.type) : nsMember.type;
                        const updatedGroup = actualKind ? symbolKindGroup(actualKind, nsMember.display?.group ?? nsMember.type ?? 'Types') : (nsMember.display?.group ?? nsMember.type);
                        return {
                            ...nsMember,
                            display: {
                                ...nsMember.display,
                                group: updatedGroup,
                                symbolKind: actualKind,
                                summary: nsMember.uid ? uidToSummary.get(nsMember.uid) : undefined,
                            }
                        };
                    });
                    return {
                        type: 'page' as const,
                        path: joinUrl(config.path, `${uidToSegment(entry.item.uid)}.tsx`).replace(/^\//, ''),
                        absolutePath: entry.filePath,
                        slugs: [...pathSegments(config.path), uidToSegment(entry.item.uid)],
                        data: createPageData({
                            ...entry,
                            namespaceMembers: decoratedNamespaceMembers,
                        }, context),
                    };
                }),
            ];

    const metas = [
        {
            type: 'meta' as const,
            path: joinUrl(config.path, 'meta.json').replace(/^\//, ''),
            data: {
                title: config.title,
                pages: pages.map((page) => page.slugs.at(-1) ?? ''),
            },
        },
    ];

    return {
        pages,
        metas,
        source: createSource({
            pages,
            metas,
        }),
        pageTree: createFurefPageTree(resolvedToc, context),
    };
}

export function createDocfxSource(options: FRSourceOptions = {}) {
    return createFurefSource(options, parseDocfxDirectory);
}

export function createDokkaSource(options: FRSourceOptions = {}) {
    return createFurefSource(options, parseDokkaDirectory);
}

export function getDocfxMarkdownUrl(
    uid: string,
    options: Pick<FRSourceOptions, 'baseUrl' | 'path'> = {},
) {
    const baseUrl = options.baseUrl?.replace(/\/+$/g, '') ?? defaultFurefOptions.baseUrl;
    const sourcePath = options.path === undefined ? defaultFurefOptions.path : trimSlashes(options.path);

    return joinUrl(baseUrl, sourcePath, uidToSegment(uid), 'content.md');
}

export function docfxUidToFileName(uid: string) {
    return uidToFileName(uid);
}
