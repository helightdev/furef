# furef

furef turns DocFX or Dokka output into a Fumadocs source for Next.js documentation sites.

## Public API

Import the React/source API from the package entrypoint:

```ts
import {
  createDocfxSource,
  createDokkaSource,
  createFurefSource,
  isFRPageData,
  SourceLabel,
  SymbolBadge,
} from 'furef';
```

Import the stylesheet once from your app layout or global stylesheet:

```ts
import 'furef/styles.css';
```

### Source Factories

`createFurefSource(options?, parser?)`

Creates a Fumadocs-compatible source from parsed reference output. The default parser is DocFX.

`createDocfxSource(options?)`

Creates a source from a DocFX directory.

`createDokkaSource(options?)`

Creates a source from a Dokka directory.

Each source factory returns:

```ts
{
  pages,
  metas,
  source,
  pageTree,
}
```

### Options

```ts
type FRSourceOptions = {
  dir?: string;
  directory?: string;
  mode?: 'pages' | 'single';
  title?: string;
  baseUrl?: string;
  path?: string;
  navigation?: {
    root?: 'folder' | 'header' | 'none' | 'toc';
    namespaces?: 'folder' | 'header' | 'none' | 'toc';
  };
  localUidPrefixes?: string[];
  hiddenUidPrefixes?: string[];
  externalLinkPrefixes?: Record<string, string | ((qualifiedId: string, prefix: string) => string | undefined)>;
  sourceBasePath?: string;
  vcsRoot?: string;
  collapseAllMembers?: boolean;
  expandable?: boolean;
  hierarchicalNamespaces?: boolean;
  showSummaryInList?: boolean;
  compactTreeNames?: boolean;
  memberStyle?: 'table' | 'card';
};
```

`hiddenUidPrefixes` removes matching UIDs from generated pages, navigation, namespace/member lists, and search content:

```ts
createDokkaSource({
  hiddenUidPrefixes: [
    'com.example.internal',
    'com.example.generated.',
  ],
});
```

`externalLinkPrefixes` maps unresolved UID/type prefixes to external links.

String values are treated as URL bases. The matched prefix is replaced by the URL base, so it is not added again:

```ts
createDocfxSource({
  externalLinkPrefixes: {
    'Vendor.Api.': 'https://docs.example.com/api',
  },
});
```

With this config, `Vendor.Api.Widget` links to `https://docs.example.com/api/Widget`.

Function values receive the full qualified ID and the matched prefix, and return the final link:

```ts
createDocfxSource({
  externalLinkPrefixes: {
    'Vendor.Api.': (qualifiedId, prefix) => {
      const name = qualifiedId.slice(prefix.length);
      return `https://docs.example.com/search?q=${encodeURIComponent(name)}`;
    },
  },
});
```

### Parsers

`parseDocfxDirectory(dir)`

Parses DocFX YAML output and returns `ParsedFRSource`.

`parseDokkaDirectory(dir)`

Parses Dokka HTML output and returns `ParsedFRSource`.

Parser result shape:

```ts
type ParsedFRSource = {
  toc: FRToc;
  entries: FREntry[];
  inferredLocalPrefixes: string[];
};
```

### Components And Helpers

`SymbolBadge`

Renders the symbol icon/badge used by reference pages.

`SourceLabel`

Renders a source-file label and link when source metadata is available.

`FRBreadcrumb`

Renders breadcrumbs for furef pages.

`FREntityCodeLink`, `FREntitySymbolLink`, and `FREntityCardLink`

Render links to reference entities from MDX or other React sources. Pass the qualified `uid`; `path`, `kind`, `label`, and `summary` are inferred from created furef sources when available. If the same UID exists in more than one source, pass `path` to disambiguate. Optional `baseUrl` and `mode` follow the source URL behavior.

```mdx
<FREntityCodeLink uid="Vendor.Api.Widget" />

<FREntitySymbolLink
  uid="Vendor.Api.Widget"
  kind="Class"
  label="Widget"
/>

<FREntityCardLink
  uid="Vendor.Api.Widget"
  kind="Class"
  label="Widget"
  summary="Reusable widget API."
/>
```

`isFRPageData(data)`

Type guards for furef page payloads.

`getItemSymbolKind(item)`

Returns the resolved symbol kind for an item.

`getDocfxMarkdownUrl(uid, options?)`

Builds a markdown content URL for a DocFX UID.

`docfxUidToFileName(uid)`

Converts a DocFX UID to the matching YAML file name.

Utility exports:

```ts
joinUrl
normalizeText
pathSegments
sectionId
trimSlashes
uidAnchor
uidToFileName
uidToSegment
```

### Public Types

Core types:

```ts
FRSourceOptions
ResolvedFRSourceOptions
FRSourceParser
ParsedFRSource
FRExternalLinkResolver
FRExternalLinkTarget
FRPageData
FRSourceContextValue
FRItem
FRReference
FREntry
FRToc
FRTocItem
FRSignature
FRBadge
FRDisplay
FRDetailSection
FREntityLinkProps
```

DocFX raw input types:

```ts
DocfxSignature
DocfxItem
DocfxReference
DocfxEntry
DocfxToc
DocfxTocItem
```
