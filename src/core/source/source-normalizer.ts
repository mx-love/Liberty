import type { MediaType } from '../types/media.js';
import type { ParsedEpisodeInfo } from '../types/episode.js';
import type {
    SourceEpisode,
    SourcePlayGroup,
    SourceRecord,
} from '../types/source.js';
import { parseEpisode } from '../episode/episode-parser.js';
import { parseTitle } from '../identity/title-parser.js';

export interface SourceNormalizerContext {
    readonly sourceKey: string;
    readonly sourceName?: string;
    readonly fetchedAt?: number;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
    '&amp;': '&',
    '&nbsp;': ' ',
    '&#36;': '$',
    '&quot;': '"',
    '&#39;': "'",
};

function stringValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value);
}

function cleanText(value: unknown): string {
    let result = stringValue(value).replace(/<[^>]*>/g, ' ');
    for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
        result = result.replaceAll(entity, replacement);
    }
    return result.replace(/\s+/g, ' ').trim();
}

function splitPeople(value: unknown): readonly string[] {
    const seen = new Set<string>();
    return cleanText(value)
        .split(/[,，、/|;；]+/)
        .map((item) => item.trim())
        .filter((item) => {
            if (!item || seen.has(item)) return false;
            seen.add(item);
            return true;
        });
}

function parseYear(value: unknown): number | null {
    const match = cleanText(value).match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
    return match ? Number(match[1]) : null;
}

function classifyMediaType(category: unknown): MediaType {
    const value = cleanText(category).toLowerCase();
    if (!value) return 'unknown';
    if (/(动漫|动画|anime)/i.test(value)) return 'anime';
    if (/(综艺|真人秀|variety)/i.test(value)) return 'variety';
    if (/(纪录片|纪录|documentary)/i.test(value)) return 'documentary';
    if (/(电影|影片|movie)/i.test(value)) return 'movie';
    if (/(电视剧|连续剧|剧集|欧美剧|国产剧|日韩剧|tv)/i.test(value)) return 'series';
    return 'unknown';
}

export function parseSourceEpisodeNumber(
    rawEpisodeName: unknown,
    mediaType: MediaType = 'unknown',
): ParsedEpisodeInfo {
    return parseEpisode(stringValue(rawEpisodeName), { mediaType });
}

function isPlayableUrl(value: string): boolean {
    return /^https?:\/\//i.test(value.trim());
}

function parseEpisodeEntry(
    rawEntry: string,
    rawIndex: number,
    group: Pick<SourcePlayGroup, 'sourceKey' | 'vodId' | 'rawIndex' | 'displayName'>,
    mediaType: MediaType,
): SourceEpisode | null {
    if (!rawEntry.trim()) return null;

    const separatorIndex = rawEntry.indexOf('$');
    const rawName = separatorIndex >= 0 ? rawEntry.slice(0, separatorIndex) : '';
    const playUrl = (separatorIndex >= 0 ? rawEntry.slice(separatorIndex + 1) : rawEntry).trim();
    if (!isPlayableUrl(playUrl)) return null;

    const cleanedName = cleanText(rawName);
    return {
        sourceKey: group.sourceKey,
        vodId: group.vodId,
        playGroup: group.displayName,
        playGroupIndex: group.rawIndex,
        rawIndex,
        rawEpisodeName: rawName,
        displayName: cleanedName || `播放项 ${rawIndex + 1}`,
        rawEntry,
        playUrl,
        parsedEpisodeInfo: parseSourceEpisodeNumber(rawName, mediaType),
        canonicalEpisodeId: null,
        mappingState: 'unmapped',
        mappingEvidence: [],
    };
}

export function parseAppleCmsPlaySources(
    sourceKey: string,
    vodId: string,
    vodPlayFrom: unknown,
    vodPlayUrl: unknown,
    mediaType: MediaType = 'unknown',
): readonly SourcePlayGroup[] {
    const rawFrom = stringValue(vodPlayFrom);
    const rawUrl = stringValue(vodPlayUrl);
    if (!rawUrl) return [];

    const groupNames = rawFrom.split('$$$');
    return rawUrl
        .split('$$$')
        .map((rawValue, rawIndex): SourcePlayGroup | null => {
            const rawName = groupNames[rawIndex] ?? '';
            const displayName = cleanText(rawName) || `播放源 ${rawIndex + 1}`;
            const groupBase = { sourceKey, vodId, rawIndex, displayName };
            const episodes = rawValue
                .split('#')
                .map((entry, episodeIndex) => parseEpisodeEntry(entry, episodeIndex, groupBase, mediaType))
                .filter((episode): episode is SourceEpisode => episode !== null);

            if (episodes.length === 0) return null;
            return {
                ...groupBase,
                rawName,
                rawValue,
                episodes,
            };
        })
        .filter((group): group is SourcePlayGroup => group !== null);
}

export class SourceNormalizer {
    static normalize(raw: Readonly<Record<string, unknown>>, context: SourceNormalizerContext): SourceRecord {
        const vodId = stringValue(raw.vod_id).trim();
        const rawTitle = stringValue(raw.vod_name);
        const rawYear = stringValue(raw.vod_year);
        const rawDirector = stringValue(raw.vod_director);
        const rawActors = stringValue(raw.vod_actor);
        const rawArea = stringValue(raw.vod_area);
        const rawLanguage = stringValue(raw.vod_lang);
        const rawCategory = stringValue(raw.type_name ?? raw.vod_class);
        const rawRemarks = stringValue(raw.vod_remarks);
        const rawDescription = stringValue(raw.vod_content);
        const rawCover = stringValue(raw.vod_pic);
        const vodPlayFrom = stringValue(raw.vod_play_from);
        const vodPlayUrl = stringValue(raw.vod_play_url);
        const mediaType = classifyMediaType(rawCategory);
        const parsedTitle = parseTitle(rawTitle);
        const parsedRemarks = parseTitle(rawRemarks);

        return {
            sourceKey: context.sourceKey,
            sourceName: context.sourceName ?? context.sourceKey,
            vodId,
            rawTitle,
            rawYear,
            rawDirector,
            rawActors,
            rawArea,
            rawLanguage,
            rawCategory,
            rawRemarks,
            rawDescription,
            rawCover,
            rawPlaySources: { vodPlayFrom, vodPlayUrl },
            rawData: { ...raw },
            normalizedTitle: cleanText(rawTitle).normalize('NFKC').toLowerCase(),
            normalizedActors: splitPeople(rawActors),
            normalizedDirector: splitPeople(rawDirector),
            parsedYear: parseYear(rawYear),
            parsedSeason: parsedTitle.season ?? parsedRemarks.season,
            mediaType,
            playGroups: parseAppleCmsPlaySources(context.sourceKey, vodId, vodPlayFrom, vodPlayUrl, mediaType),
            fetchedAt: context.fetchedAt ?? Date.now(),
        };
    }
}
