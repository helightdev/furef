import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface FRBreadcrumbProps {
    slugs: string[];
    title: string;
    source: {
        getPage: (slugs: string[]) => any;
    };
    rootUrl?: string;
    rootName?: string;
}

export function FRBreadcrumb({
    slugs,
    title,
    source,
    rootUrl = '/reference',
    rootName = 'API Reference',
}: FRBreadcrumbProps) {
    const items: { name: string; url?: string }[] = [
        { name: rootName, url: rootUrl }
    ];

    if (slugs.length > 0) {
        const firstSegment = slugs[0];
        const rootPage = source.getPage([firstSegment]);
        const sourceName = rootPage?.data?.title ?? firstSegment;
        
        if (slugs.length === 1) {
            items.push({ name: sourceName });
        } else {
            items.push({ name: sourceName, url: `${rootUrl}/${firstSegment}` });
            
            // Split the second segment of the slug (the dotted namespace/type UID) by dots
            const parts = slugs[1].split('.');
            let current = '';
            let lastMatchedFullName = '';
            
            for (let i = 0; i < parts.length - 1; i++) {
                current = current ? `${current}.${parts[i]}` : parts[i];
                // Check if this namespace/package has a registered page
                const pageExists = source.getPage([firstSegment, current]);
                if (pageExists) {
                    let displayName = current;
                    if (lastMatchedFullName) {
                        // Display name is the current package segment relative to the parent prefix
                        displayName = current.substring(lastMatchedFullName.length + 1);
                    }
                    items.push({
                        name: displayName,
                        url: `${rootUrl}/${firstSegment}/${current}`
                    });
                    lastMatchedFullName = current;
                }
            }
            
            // Subtract the matched parent prefix from the leaf name if it's repeated
            let leafDisplayName = title;
            if (leafDisplayName.includes('.') && lastMatchedFullName && leafDisplayName.startsWith(lastMatchedFullName)) {
                leafDisplayName = leafDisplayName.substring(lastMatchedFullName.length + 1);
            }
            items.push({ name: leafDisplayName });
        }
    }

    return (
        <div className="flex flex-row items-center gap-1.5 text-sm text-fd-muted-foreground mb-4 select-none min-w-0 flex-wrap">
            {items.map((item, index) => (
                <div key={index} className="flex items-center gap-1.5 min-w-0">
                    {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                    {index === items.length - 1 ? (
                        <span className="truncate text-fd-foreground font-medium">{item.name}</span>
                    ) : item.url ? (
                        <Link href={item.url} className="hover:text-fd-foreground transition-colors truncate">
                            {item.name}
                        </Link>
                    ) : (
                        <span className="truncate">{item.name}</span>
                    )}
                </div>
            ))}
        </div>
    );
}
