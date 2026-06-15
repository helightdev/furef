export type DocfxSignature = {
    content?: string;
    parameters?: Array<{ id?: string; type?: string; defaultValue?: string; description?: string }>;
    typeParameters?: Array<{ id?: string; description?: string }>;
    return?: { type?: string; description?: string };
};

export type DocfxItem = {
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
    syntax?: DocfxSignature;
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

export type DocfxReference = {
    uid: string;
    definition?: string;
    href?: string;
    name?: string;
    fullName?: string;
    isExternal?: boolean;
};

export type DocfxTocItem = {
    uid?: string;
    name?: string;
    type?: string;
    items?: DocfxTocItem[];
};

export type DocfxToc = {
    items?: DocfxTocItem[];
};

export type DocfxEntry = {
    item: DocfxItem;
    members: DocfxItem[];
    namespaceMembers: DocfxTocItem[];
    references: Record<string, DocfxReference>;
    filePath: string;
};
