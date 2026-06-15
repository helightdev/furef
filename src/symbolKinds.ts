import type {FRItem} from './types';

export type SymbolKindDef = {
    icon: string;
    cssVar: string;
    fallback: string;
    label: string;
    group?: string;
    tocRank?: number;
    memberGroup?: string;
    memberRank?: number;
};

export const SYMBOL_KINDS = {
    // ── Types ────────────────────────────────────────────────────────
    Namespace:      { icon: 'symbol-namespace',   cssVar: 'furef-color-namespace',    fallback: '#d4d4d4', label: 'Namespace',      group: 'Namespaces',      tocRank: 0 },

    StaticClass:    { icon: 'symbol-constant',    cssVar: 'furef-color-staticclass',  fallback: '#f29e74', label: 'Static Class',   group: 'Static Classes',  tocRank: 10 },
    KotlinObject:   { icon: 'symbol-constant',    cssVar: 'furef-color-kotlinobject', fallback: '#f29e74', label: 'Object',         group: 'Objects',         tocRank: 11 },
    Enum:           { icon: 'symbol-enum',        cssVar: 'furef-color-enum',         fallback: '#f29e74', label: 'Enum',           group: 'Enums',           tocRank: 12 },


    Struct:         { icon: 'symbol-class',       cssVar: 'furef-color-struct',       fallback: '#ff77b7', label: 'Struct',         group: 'Structs',         tocRank: 20 },

    SealedClass:    { icon: 'symbol-class',       cssVar: 'furef-color-sealedclass',  fallback: '#ee9d28', label: 'Sealed Class',   group: 'Classes',         tocRank: 29 },
    Class:          { icon: 'symbol-class',       cssVar: 'furef-color-class',        fallback: '#ee9d28', label: 'Class',          group: 'Classes',         tocRank: 30 },
    AbstractClass:  { icon: 'symbol-class',       cssVar: 'furef-color-abstractclass',fallback: '#ff7675', label: 'Abstract Class', group: 'Abstract Classes',tocRank: 40 },

    Interface:      { icon: 'symbol-interface',   cssVar: 'furef-color-interface',    fallback: '#4ec9b0', label: 'Interface',      group: 'Interfaces',      tocRank: 50 },

    Delegate:       { icon: 'symbol-event',       cssVar: 'furef-color-delegate',     fallback: '#b180d7', label: 'Delegate',       group: 'Delegates',       tocRank: 70 },

    // ── Members ──────────────────────────────────────────────────────
    EnumMember:     { icon: 'symbol-enum-member', cssVar: 'furef-color-enummember',   fallback: '#f29e74', label: 'Enum Member', memberGroup: 'Enum Members', memberRank: 0 },

    Constructor:    { icon: 'symbol-constructor', cssVar: 'furef-color-constructor',  fallback: '#b180d7', label: 'Constructor', memberGroup: 'Constructors', memberRank: 10 },

    Method:         { icon: 'symbol-method',      cssVar: 'furef-color-method',        fallback: '#b180d7', label: 'Method', memberGroup: 'Methods', memberRank: 30 },
    /** Abstract method (or interface method with no body) — must be overridden */
    MethodAbstract:    { icon: 'symbol-method-arrow', cssVar: 'furef-color-methodarrow',  fallback: '#ff7675', label: 'Method', memberGroup: 'Methods', memberRank: 33 },
    /** Virtual / open method — may be overridden but doesn't force it */
    MethodVirtual:  { icon: 'symbol-method-arrow', cssVar: 'furef-color-method',       fallback: '#b180d7', label: 'Method', memberGroup: 'Methods', memberRank: 32 },
    /** Overriding method — same color as a regular method, different leading icon */
    MethodOverride: { icon: 'symbol-method-arrow', cssVar: 'furef-color-methodoverride', fallback: '#b180d7', label: 'Method', memberGroup: 'Methods', memberRank: 31 },
    ExtensionMethod:{ icon: 'extensions',         cssVar: 'furef-color-extensionmethod',fallback:'#b180d7',label: 'Extension Method', group:'Extension Methods', memberGroup: 'Extension Methods', memberRank: 40 },
    Operator:       { icon: 'symbol-operator',    cssVar: 'furef-color-operator',     fallback: '#b180d7', label: 'Operator', memberGroup: 'Operators', memberRank: 50 },

    Property:       { icon: 'symbol-property',    cssVar: 'furef-color-property',     fallback: '#75beff', label: 'Property', memberGroup: 'Properties', memberRank: 20 },
    Field:          { icon: 'symbol-field',        cssVar: 'furef-color-field',        fallback: '#75beff', label: 'Field', memberGroup: 'Fields', memberRank: 21 },
    Constant:       { icon: 'symbol-constant',    cssVar: 'furef-color-constant',     fallback: '#75beff', label: 'Constant', memberGroup: 'Fields', memberRank: 22 },

    Event:          { icon: 'symbol-event',       cssVar: 'furef-color-event',        fallback: '#ee9d28', label: 'Event', memberGroup: 'Events', memberRank: 60 },
} as const satisfies Record<string, SymbolKindDef>;

export type SymbolKind = keyof typeof SYMBOL_KINDS;

export function resolveSymbolKind(kind: string | undefined): {
    icon: string;
    color: string;
    label: string;
} {
    if (kind && kind in SYMBOL_KINDS) {
        const def = SYMBOL_KINDS[kind as SymbolKind];
        return {
            icon: def.icon,
            color: `var(--${def.cssVar}, ${def.fallback})`,
            label: def.label,
        };
    }
    return {
        icon: 'symbol-misc',
        color: 'var(--color-fd-muted-foreground)',
        label: kind ?? 'Symbol',
    };
}

export function symbolKindGroup(kind: string | undefined, fallback = 'Types'): string {
    if (kind && kind in SYMBOL_KINDS) {
        return (SYMBOL_KINDS[kind as SymbolKind] as SymbolKindDef).group ?? fallback;
    }
    return fallback;
}

export function memberGroupForSymbolKind(kind: string | undefined, fallback = 'Members'): string {
    if (kind && kind in SYMBOL_KINDS) {
        const def = SYMBOL_KINDS[kind as SymbolKind] as SymbolKindDef;
        return def.memberGroup ?? fallback;
    }
    return fallback;
}

export const TOC_GROUP_PRIORITY: string[] = (() => {
    const seen = new Set<string>();
    const entries: Array<{ group: string; rank: number }> = [];
    for (const raw of Object.values(SYMBOL_KINDS)) {
        const def = raw as SymbolKindDef;
        if (def.group && !seen.has(def.group)) {
            seen.add(def.group);
            entries.push({ group: def.group, rank: def.tocRank ?? 999 });
        }
    }
    entries.sort((a, b) => a.rank - b.rank);
    return entries.map((e) => e.group);
})();

export const MEMBER_GROUP_PRIORITY = [
    'Enum Members',
    'Fields',
    'Properties',
    'Events',
    'Constructors',
    'Methods',
    'Members',
    'Operators',
    'Extension Methods',
];

export type MemberGroup = {
    title: string;
    kind: string;
    members: FRItem[];
};

function memberGroupTitle(member: FRItem): string {
    return member.display?.memberGroup ?? member.display?.group ?? 'Members';
}

function memberSymbolKind(member: FRItem): string | undefined {
    return member.display?.symbolKind ?? member.display?.kind ?? member.type;
}

function memberGroupRank(group: string): number {
    const rank = MEMBER_GROUP_PRIORITY.indexOf(group);
    return rank === -1 ? 99 : rank;
}

function memberKindRank(kind: string | undefined): number {
    if (kind && kind in SYMBOL_KINDS) {
        return (SYMBOL_KINDS[kind as SymbolKind] as SymbolKindDef).memberRank ?? 99;
    }
    return 99;
}

function memberSectionTitle(title: string, group: FRItem[], hasStaticMembers: boolean) {
    if (!hasStaticMembers) return title;
    return group[0]?.display?.isStatic ? `Static ${title}` : `Instance ${title}`;
}

export function sortMembers(members: FRItem[]): FRItem[] {
    return [...members].sort((a, b) => {
        const groupA = memberGroupTitle(a);
        const groupB = memberGroupTitle(b);

        if (groupA !== groupB) {
            const groupRank = memberGroupRank(groupA) - memberGroupRank(groupB);
            if (groupRank !== 0) return groupRank;
        }

        const staticA = Boolean(a.display?.isStatic);
        const staticB = Boolean(b.display?.isStatic);
        if (staticA !== staticB) return staticA ? -1 : 1;

        const kindRank = memberKindRank(memberSymbolKind(a)) - memberKindRank(memberSymbolKind(b));
        if (kindRank !== 0) return kindRank;

        return (a.name ?? a.uid).localeCompare(b.name ?? b.uid);
    });
}

export function groupMembers(members: FRItem[], collapseAllMembers = false): MemberGroup[] {
    const sortedMembers = sortMembers(members);

    if (collapseAllMembers) {
        return [{title: 'Members', kind: 'Members', members: sortedMembers}];
    }

    const baseGroups = Map.groupBy(sortedMembers, memberGroupTitle);
    const groups: MemberGroup[] = [];

    for (const [kind, group] of baseGroups.entries()) {
        if (kind === 'Extension Methods') {
            groups.push({title: kind, kind, members: group});
            continue;
        }

        const hasStaticMembers = group.some((member) => member.display?.isStatic);
        const hasInstanceMembers = group.some((member) => !member.display?.isStatic);

        if (!hasStaticMembers) {
            groups.push({title: kind, kind, members: group});
            continue;
        }

        if (!hasInstanceMembers) {
            groups.push({title: `Static ${kind}`, kind, members: group});
            continue;
        }

        const staticMembers = group.filter((member) => member.display?.isStatic);
        const instanceMembers = group.filter((member) => !member.display?.isStatic);
        groups.push({title: memberSectionTitle(kind, staticMembers, true), kind, members: staticMembers});
        groups.push({title: memberSectionTitle(kind, instanceMembers, true), kind, members: instanceMembers});
    }

    return groups;
}
