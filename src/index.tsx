export {
    createDocfxSource,
    createDokkaSource,
    createFurefSource,
    docfxUidToFileName,
    getDocfxMarkdownUrl,
    getItemSymbolKind,
    isFRPageData,
    SourceLabel,
    SymbolBadge,
} from './source';

export { FRBreadcrumb } from './components/breadcrumb';
export { FREntityCardLink, FREntityCodeLink, FREntitySymbolLink, registerFREntitySource } from './components/entity-link';
export type { FREntityLinkProps } from './components/entity-link';

export type {
    FREntry,
    FRBadge,
    FRDetailSection,
    FRDisplay,
    FRExternalLinkResolver,
    FRExternalLinkTarget,
    FRItem,
    FRNavigationContainer,
    FRNavigationOptions,
    FRPageData,
    FRReference,
    FRSignature,
    FRSourceContextValue,
    FRSourceMode,
    FRSourceOptions,
    FRSourceParser,
    FRToc,
    FRTocItem,
    ParsedFRSource,
    ResolvedFRSourceOptions,
} from './types';

export type {
    DocfxEntry,
    DocfxItem,
    DocfxReference,
    DocfxSignature,
    DocfxToc,
    DocfxTocItem,
} from './docfx';

export {parseDocfxDirectory} from './docfx';
export {parseDokkaDirectory} from './dokka';
export {joinUrl, normalizeText, pathSegments, sectionId, trimSlashes, uidAnchor, uidToFileName, uidToSegment} from './utils';
