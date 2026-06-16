import type React from 'react';

export type FRSourceMode = 'pages' | 'single';
export type FRNavigationContainer = 'folder' | 'header' | 'none' | 'toc';

export type FRNavigationOptions = {
    root?: FRNavigationContainer;
    namespaces?: FRNavigationContainer;
};

export type FRExternalLinkResolver = (qualifiedId: string, prefix: string) => string | undefined;
export type FRExternalLinkTarget = string | FRExternalLinkResolver;

export type FRSourceOptions = {
    dir?: string;
    directory?: string;
    mode?: FRSourceMode;
    title?: string;
    baseUrl?: string;
    path?: string;
    navigation?: FRNavigationOptions;
    localUidPrefixes?: string[];
    hiddenUidPrefixes?: string[];
    externalLinkPrefixes?: Record<string, FRExternalLinkTarget>;
    sourceBasePath?: string;
    vcsRoot?: string;
    collapseAllMembers?: boolean;
    expandable?: boolean;
    hierarchicalNamespaces?: boolean;
    showSummaryInList?: boolean;
    compactTreeNames?: boolean;
    memberStyle?: 'table' | 'card';
};

export type ResolvedFRSourceOptions = {
    dir: string;
    mode: FRSourceMode;
    title: string;
    baseUrl: string;
    path: string;
    navigation: Required<FRNavigationOptions>;
    localUidPrefixes: string[];
    hiddenUidPrefixes: string[];
    externalLinkPrefixes: Record<string, FRExternalLinkTarget>;
    sourceBasePath?: string;
    vcsRoot?: string;
    collapseAllMembers: boolean;
    expandable: boolean;
    hierarchicalNamespaces: boolean;
    showSummaryInList: boolean;
    compactTreeNames: boolean;
    memberStyle: 'table' | 'card';
};

export type FRSourceContextValue = {
    config: ResolvedFRSourceOptions;
    localUids: Set<string>;
    localUidUrls: Map<string, string>;
    uidToSymbolKind: Map<string, string>;
};

export type FRSignature = {
    content?: string;
    parameters?: Array<{ id?: string; type?: string; defaultValue?: string; description?: string }>;
    typeParameters?: Array<{ id?: string; description?: string }>;
    return?: { type?: string; description?: string };
};

export type FRBadge = {
    key: string;
    text: string;
    icon: string;
    color: string;
    label: string;
};

export type FRDetailSection = {
    title?: string;
    items?: Array<{ label?: string; type?: string; description?: string }>;
    content?: string;
};

export type FRDisplay = {
    kind?: string;
    kindLabel?: string;
    group?: string;
    groupTitle?: string;
    memberGroup?: string;
    symbolKind?: string;
    symbolText?: string;
    badges?: FRBadge[];
    leadingBadges?: FRBadge[];
    isStatic?: boolean;
    valueType?: string;
    signature?: FRSignature;
    details?: FRDetailSection[];
    hasDetails?: boolean;
    summary?: string;
};

export type FRItem = {
    uid: string;
    id?: string;
    parent?: string;
    name?: string;
    nameWithType?: string;
    fullName?: string;
    type?: string;
    namespace?: string;
    summary?: string;
    remarks?: string;
    example?: unknown[];
    syntax?: FRSignature;
    display?: FRDisplay;
    isExtensionMethod?: boolean;
    inheritance?: string[];
    inheritedMembers?: string[];
    extensionMethods?: string[];
    implements?: string[];
    source?: {
        path?: string;
        startLine?: number;
    };
    assemblies?: string[];
    children?: string[];
};

export type FRReference = {
    uid: string;
    definition?: string;
    href?: string;
    name?: string;
    fullName?: string;
    isExternal?: boolean;
};

export type FRTocItem = {
    uid?: string;
    name?: string;
    type?: string;
    display?: FRDisplay;
    items?: FRTocItem[];
};

export type FRToc = {
    items?: FRTocItem[];
};

export type FREntry = {
    item: FRItem;
    members: FRItem[];
    namespaceMembers: FRTocItem[];
    references: Record<string, FRReference>;
    filePath: string;
};

export type ParsedFRSource = {
    toc: FRToc;
    entries: FREntry[];
    inferredLocalPrefixes: string[];
};

export type FRSourceParser = (dir: string) => ParsedFRSource;

export type FRPagePayload = {
    uid: string;
    kind?: string;
    item: FRItem;
    members: FRItem[];
    references: Record<string, FRReference>;
    markdown: string;
    config: ResolvedFRSourceOptions;
};

export type FRPageData = {
    type: 'furef';
    title: string;
    description?: string;
    full?: boolean;
    toc: Array<{ title: string; url: string; depth: number }>;
    body: React.ComponentType;
    furef: FRPagePayload;
    docfx: FRPagePayload;
    structuredData: () => {
        headings: Array<{ id: string; content: string }>;
        contents: Array<{ heading: string | undefined; content: string }>;
    };
};
