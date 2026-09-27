export type EpubManifestImage = {
    id?: string;
    href?: string;
    "media-type"?: string;
    properties?: string[];
};

/** Pick a deterministic image when an EPUB has no standards-compliant cover declaration. */
export function selectEpubCoverCandidate(items: EpubManifestImage[]): EpubManifestImage | null {
    const images = items.filter((item) => {
        const type = (item["media-type"] ?? "").toLowerCase();
        const href = (item.href ?? "").toLowerCase();
        return type.startsWith("image/") && !/(?:logo|icon|sprite|ornament|decor|figure|fig[-_])/i.test(href);
    });
    if (images.length === 0) return null;
    const score = (item: EpubManifestImage) => {
        const id = (item.id ?? "").toLowerCase();
        const href = (item.href ?? "").toLowerCase();
        const props = item.properties ?? [];
        let value = 0;
        if (props.includes("cover-image")) value += 1000;
        if (/cover/.test(id)) value += 300;
        if (/(^|[/_-])cover(?:[-_0-9.]|$)/.test(href)) value += 200;
        if (/(^|[/_-])front(?:[-_0-9.]|$)/.test(href)) value += 100;
        return value;
    };
    return images.map((item, index) => ({ item, index, value: score(item) }))
        .sort((a, b) => b.value - a.value || a.index - b.index)[0]?.item ?? null;
}
