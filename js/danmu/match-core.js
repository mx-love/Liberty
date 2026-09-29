(function initLibertyDanmuMatchCore(root) {
    'use strict';

    const CONFIDENCE_RANK = Object.freeze({
        rejected: -1,
        unknown: 0,
        low: 1,
        medium: 2,
        high: 3,
        exact: 4,
    });

    const NOISE_ONLY_PATTERNS = [
        /^(?:360|480|720|1080|1440|2160|4320)p$/i,
        /^(?:4k|8k|hd|uhd|fhd|hdr|sdr)$/i,
        /^(?:h\.?26[45]|x26[45]|hevc|av1|vp9|10bit)$/i,
        /^(?:aac|ac3|eac3|dts|dolby)$/i,
        /^(?:bd|bluray|blu-ray|web-?dl|webrip)$/i,
        /^(?:国语|粤语|中字|双语|正片|高清|超清|备用)$/i,
        /^(?:线路|线路\s*\d+|备用\s*\d*)$/i,
        /^(?:cd|bd)\s*\d+$/i,
        /^\d{3,4}\s*[x×]\s*\d{3,4}$/i,
    ];

    const SPECIAL_PATTERNS = [
        ['ova', /(?:^|[^a-z])OVA(?:\s*([0-9]{1,3}))?(?:$|[^a-z])/i],
        ['oad', /(?:^|[^a-z])OAD(?:\s*([0-9]{1,3}))?(?:$|[^a-z])/i],
        ['sp', /(?:^|[^a-z])SP(?:\s*([0-9]{1,3}))?(?:$|[^a-z])/i],
        ['special', /(特别篇|特別篇)/i],
        ['extra', /(番外|总集篇|總集篇|先导片|先導片|预告|預告|花絮|加更|彩蛋)/i],
        ['movie', /(剧场版|劇場版|movie)/i],
    ];

    function normalizeNumberText(value) {
        return String(value ?? '')
            .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
            .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, ch => ({
                '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
                '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10',
            })[ch] || ch)
            .trim();
    }

    function chineseNumberToInt(value) {
        const raw = normalizeNumberText(value);
        if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);

        const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
        if (!/^[零〇一二两兩三四五六七八九十百]+$/.test(raw)) return null;

        let total = 0;
        let current = 0;
        for (const ch of raw) {
            if (Object.prototype.hasOwnProperty.call(digits, ch)) {
                current = digits[ch];
            } else if (ch === '十') {
                total += (current || 1) * 10;
                current = 0;
            } else if (ch === '百') {
                total += (current || 1) * 100;
                current = 0;
            }
        }
        return total + current || null;
    }

    function isValidEpisodeNumber(value) {
        return Number.isInteger(value)
            && value > 0
            && value <= 999
            && !(value >= 1900 && value <= 2099);
    }

    function parseDateIdentity(value) {
        const text = normalizeNumberText(value);
        const compact = text.match(/(?:第\s*)?((?:19|20)\d{2})(?:[-/.年]?)(0[1-9]|1[0-2])(?:[-/.月]?)(0[1-9]|[12]\d|3[01])(?:日)?(?:\s*(?:期|加更版?))?/);
        if (!compact) return null;
        const date = `${compact[1]}${compact[2]}${compact[3]}`;
        return {
            date,
            display: `${compact[1]}-${compact[2]}-${compact[3]}`,
            source: /期|加更/.test(text) ? 'explicit_date_issue_label' : 'date_label',
        };
    }

    function getSpecialIdentity(value) {
        const text = normalizeNumberText(value);
        for (const [kind, pattern] of SPECIAL_PATTERNS) {
            const match = text.match(pattern);
            if (match) {
                const numberedSuffix = match[1] && /^\d+$/.test(match[1])
                    ? Number.parseInt(match[1], 10)
                    : null;
                return {
                    kind,
                    number: numberedSuffix,
                    label: match[0].trim(),
                };
            }
        }
        const part = text.match(/(?:^|[\s._-])(Part\s*([12])|上篇|下篇|前篇|后篇|後篇|上|下)(?:$|[\s._-])/i);
        if (part) {
            return { kind: 'part', number: part[2] ? Number.parseInt(part[2], 10) : null, label: part[1] };
        }
        return null;
    }

    function isNoiseOnly(value) {
        const text = normalizeNumberText(value).replace(/[【】()[\]（）]/g, '').trim();
        if (!text) return false;
        return NOISE_ONLY_PATTERNS.some(pattern => pattern.test(text))
            || /^(?:正片|国语|粤语|中字|双语|高清|超清|\s)+$/.test(text);
    }

    function parseEpisodeIdentity(value, options = {}) {
        const raw = String(value ?? '');
        const text = normalizeNumberText(raw);
        const base = {
            raw,
            normalized: text,
            episodeNumber: null,
            confidence: 'unknown',
            source: 'unresolved',
            contentType: options.contentType || 'unknown',
            specialType: null,
            specialNumber: null,
            dateIdentity: null,
            usedIndexFallback: false,
        };

        if (!text) {
            if (options.allowIndexFallback && Number.isInteger(options.episodeIndex)) {
                return {
                    ...base,
                    episodeNumber: options.episodeIndex + 1,
                    confidence: 'low',
                    source: 'index_fallback_empty_label',
                    usedIndexFallback: true,
                };
            }
            return base;
        }

        const dateIdentity = parseDateIdentity(text);
        if (dateIdentity) {
            return {
                ...base,
                confidence: 'high',
                source: dateIdentity.source,
                contentType: 'variety',
                dateIdentity: dateIdentity.date,
            };
        }

        const special = getSpecialIdentity(text);
        if (special) {
            return {
                ...base,
                confidence: 'high',
                source: `special_${special.kind}`,
                contentType: special.kind === 'movie' ? 'movie' : 'special',
                specialType: special.kind,
                specialNumber: special.number,
            };
        }

        if (isNoiseOnly(text) || /^(?:19|20)\d{2}$/.test(text)) {
            return { ...base, source: 'rejected_noise_token' };
        }

        const patterns = [
            ['season_episode_label', /(?:^|[^a-z0-9])S\s*\d{1,2}\s*E\s*0*(\d{1,3})(?=$|[^a-z0-9])/i, 'high'],
            ['explicit_episode_label', /第\s*([零〇一二两兩三四五六七八九十百\d]+)\s*[集话話回]/, 'high'],
            ['explicit_issue_label', /第\s*([零〇一二两兩三四五六七八九十百\d]+)\s*期/, 'high'],
            ['ep_label', /(?:^|[^a-z0-9])EP\.?\s*0*(\d{1,3})(?=$|[^a-z0-9])/i, 'high'],
            ['e_label', /(?:^|[^a-z0-9])E\s*0*(\d{1,3})(?=$|[^a-z0-9])/i, 'high'],
            ['episode_suffix', /(?:^|[^\d])0*(\d{1,3})\s*[集话話回](?:$|[^\d])/, 'high'],
        ];

        for (const [source, pattern, confidence] of patterns) {
            const match = text.match(pattern);
            if (!match) continue;
            const episodeNumber = chineseNumberToInt(match[1]);
            if (!isValidEpisodeNumber(episodeNumber)) continue;
            return {
                ...base,
                episodeNumber,
                confidence,
                source,
                contentType: source === 'explicit_issue_label' ? 'variety' : (options.contentType || 'series'),
            };
        }

        if (/^0*\d{1,3}$/.test(text)) {
            const episodeNumber = Number.parseInt(text, 10);
            if (isValidEpisodeNumber(episodeNumber)) {
                return {
                    ...base,
                    episodeNumber,
                    confidence: 'medium',
                    source: 'pure_numeric_label',
                    contentType: options.contentType || 'series',
                };
            }
        }

        if (options.allowIndexFallback
            && Number.isInteger(options.episodeIndex)
            && options.contentType !== 'movie') {
            return {
                ...base,
                episodeNumber: options.episodeIndex + 1,
                confidence: 'low',
                source: 'index_fallback_unstructured_label',
                usedIndexFallback: true,
            };
        }

        return base;
    }

    function parseSeasonIdentity(value) {
        const raw = String(value ?? '');
        const text = normalizeNumberText(raw);
        const patterns = [
            ['explicit_chinese_season', /第\s*([零〇一二两兩三四五六七八九十百\d]+)\s*季/i],
            ['season_word', /(?:^|[^a-z])Season\s*([0-9]{1,2})(?=$|[^a-z0-9])/i],
            ['s_label', /(?:^|[^a-z0-9])S\s*([0-9]{1,2})(?=$|[^a-z0-9])/i],
        ];
        for (const [source, pattern] of patterns) {
            const match = text.match(pattern);
            if (!match) continue;
            const season = chineseNumberToInt(match[1]);
            if (Number.isInteger(season) && season > 0 && season <= 99) {
                return { raw, season, confidence: 'high', source, candidates: [] };
            }
        }

        const candidates = [];
        const trailing = text.match(/^(.+?)([2-9])$/);
        if (trailing && trailing[1].trim().length >= 2) {
            candidates.push({
                season: Number.parseInt(trailing[2], 10),
                baseTitle: trailing[1].trim(),
                confidence: 'low',
                source: 'title_trailing_digit_candidate',
            });
        }
        return { raw, season: null, confidence: 'unknown', source: 'unresolved', candidates };
    }

    function extractYear(value) {
        const match = normalizeNumberText(value).match(/(?:^|[^\d])((?:19|20)\d{2})(?=$|[^\d])/);
        return match ? Number.parseInt(match[1], 10) : null;
    }

    function normalizeTitle(value) {
        return normalizeNumberText(value)
            .replace(/【[^】]*】|\[[^\]]*\]/g, ' ')
            .replace(/[（(]\s*(?:完|全集|更新至[^）)]*|高清|蓝光|国语|粤语|中字|双语)\s*[）)]/gi, ' ')
            .replace(/第\s*[零〇一二两兩三四五六七八九十百\d]+\s*季/gi, ' ')
            .replace(/(?:^|\s)Season\s*\d{1,2}(?=$|\s)/gi, ' ')
            .replace(/(?:^|\s)S\s*\d{1,2}(?=$|\s|E)/gi, ' ')
            .replace(/(?:^|\s)(?:1080p|720p|2160p|4k|8k|h26[45]|hevc|av1|10bit|hdr|bd|bluray|web-?dl|webrip)(?=$|\s)/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeComparableTitle(value) {
        return normalizeTitle(value)
            .toLowerCase()
            .replace(/(?:19|20)\d{2}/g, '')
            .replace(/[【】\[\]（）(){}<>《》「」『』·・.。:：,，、;；!！?？'"“”‘’_\-—/\\|\s]/g, '');
    }

    function inferContentType(rawTitle, rawEpisodeName, rawRemarks) {
        const combined = `${rawTitle || ''} ${rawRemarks || ''}`;
        const episode = String(rawEpisodeName || '').trim();
        if (/(综艺|真人秀|晚会|盛典)/.test(combined) || parseDateIdentity(episode) || /第.+期/.test(episode)) return 'variety';
        if (/(电影|劇場版|剧场版|movie)/i.test(combined)) return 'movie';
        if (SPECIAL_PATTERNS.some(([, pattern]) => pattern.test(episode))) return 'special';
        if (/^(?:正片|HD|高清|国语|粤语|1080P|4K)$/i.test(episode)) return 'movie';
        if (/第.+[集话話]|(?:^|[^a-z])EP?\s*\d+/i.test(episode)) return 'series';
        return 'unknown';
    }

    function getTitleSimilarity(left, right) {
        const a = normalizeComparableTitle(left);
        const b = normalizeComparableTitle(right);
        if (!a || !b) return { score: 0, mode: 'missing' };
        if (a === b) return { score: 1, mode: 'exact' };
        if (a.includes(b) || b.includes(a)) {
            const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
            return { score: Math.max(0.75, ratio), mode: 'contains' };
        }
        const aSet = new Set(a);
        const bSet = new Set(b);
        let intersection = 0;
        aSet.forEach(ch => { if (bSet.has(ch)) intersection += 1; });
        const score = (2 * intersection) / (aSet.size + bSet.size || 1);
        return { score, mode: score >= 0.72 ? 'similar' : 'different' };
    }

    function createPlaybackContext(input = {}) {
        const rawTitle = String(input.rawTitle ?? input.title ?? '');
        const rawEpisodeName = String(input.rawEpisodeName ?? input.episodeName ?? '');
        const rawRemarks = String(input.rawRemarks ?? '');
        const rawSourceName = String(input.rawSourceName ?? '');
        const episodeIndex = Number.isInteger(input.episodeIndex) ? input.episodeIndex : null;
        const normalizedTitle = normalizeTitle(rawTitle);
        const contentType = input.contentType || inferContentType(rawTitle, rawEpisodeName, rawRemarks);
        const seasonInfo = parseSeasonIdentity(rawTitle);
        const episodeInfo = parseEpisodeIdentity(rawEpisodeName, {
            contentType,
            episodeIndex,
            allowIndexFallback: input.allowIndexFallback !== false,
        });
        const suppliedYear = Number.parseInt(input.year, 10);
        const year = Number.isInteger(suppliedYear) && suppliedYear >= 1900 && suppliedYear <= 2099
            ? suppliedYear
            : extractYear(`${rawTitle} ${rawRemarks}`);
        const titleCandidates = [{
            title: normalizedTitle,
            season: seasonInfo.season,
            confidence: 'high',
            source: 'normalized_raw_title',
        }];
        seasonInfo.candidates.forEach(candidate => {
            titleCandidates.push({
                title: normalizeTitle(candidate.baseTitle),
                season: candidate.season,
                confidence: candidate.confidence,
                source: candidate.source,
            });
        });

        return {
            title: rawTitle,
            rawTitle,
            rawEpisodeName,
            rawRemarks,
            rawSourceName,
            rawEpisodeIndex: episodeIndex,
            normalizedTitle,
            baseTitle: normalizedTitle,
            titleConfidence: normalizedTitle ? 'high' : 'unknown',
            titleSource: 'raw_title',
            titleCandidates,
            year,
            yearConfidence: year ? (Number.isInteger(suppliedYear) ? 'high' : 'medium') : 'unknown',
            yearSource: year ? (Number.isInteger(suppliedYear) ? 'upstream_year' : 'title_or_remarks') : 'unresolved',
            season: seasonInfo.season,
            seasonConfidence: seasonInfo.confidence,
            seasonSource: seasonInfo.source,
            seasonCandidates: seasonInfo.candidates,
            episodeNumber: episodeInfo.episodeNumber,
            episodeConfidence: episodeInfo.confidence,
            episodeSource: episodeInfo.source,
            episodeIndex,
            episodeName: rawEpisodeName,
            episodeIdentity: episodeInfo,
            contentType: episodeInfo.contentType !== 'unknown' ? episodeInfo.contentType : contentType,
            sourceCode: String(input.sourceCode || ''),
            platformHint: String(input.platformHint || input.platform || ''),
            platformConfidence: input.platformConfidence || 'unknown',
            duration: Number.isFinite(Number(input.duration)) ? Number(input.duration) : 0,
            episodeCount: Number.isFinite(Number(input.episodeCount)) ? Number(input.episodeCount) : 0,
            playUrl: String(input.playUrl || ''),
            vodId: String(input.vodId || ''),
        };
    }

    function formatSeasonEpisode(season, episode) {
        if (!season || !episode) return '';
        return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    }

    function buildMatchQueries(context, maxQueries = 8) {
        const titleCandidates = Array.isArray(context.titleCandidates) && context.titleCandidates.length
            ? context.titleCandidates
            : [{ title: context.normalizedTitle || context.title, season: context.season, confidence: 'high' }];
        const bases = [];
        const addBase = parts => {
            const value = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            if (value && !bases.includes(value)) bases.push(value);
        };
        const episode = Number(context.episodeNumber || context.episode || 0) || null;
        const isRegularEpisode = episode && !context.episodeIdentity?.dateIdentity && !context.episodeIdentity?.specialType;

        for (const candidate of titleCandidates) {
            const title = normalizeTitle(candidate.title);
            if (!title) continue;
            const reliableSeason = candidate.season
                && CONFIDENCE_RANK[candidate.confidence || context.seasonConfidence] >= CONFIDENCE_RANK.medium;
            const seasonEpisode = reliableSeason && isRegularEpisode
                ? formatSeasonEpisode(candidate.season, episode)
                : '';

            if (seasonEpisode && context.year) addBase([title, context.year, seasonEpisode]);
            if (seasonEpisode) addBase([title, seasonEpisode]);
            if (isRegularEpisode && context.year) addBase([title, context.year, `第${episode}集`]);
            if (isRegularEpisode) addBase([title, `第${episode}集`]);
            if (context.episodeIdentity?.dateIdentity) addBase([title, context.episodeIdentity.dateIdentity]);
            if (context.episodeIdentity?.specialType) {
                const special = context.episodeIdentity.specialNumber
                    ? `${context.episodeIdentity.specialType.toUpperCase()} ${context.episodeIdentity.specialNumber}`
                    : context.episodeIdentity.specialType.toUpperCase();
                addBase([title, special]);
            }
            if (!isRegularEpisode || context.contentType === 'movie') {
                if (context.year) addBase([title, context.year]);
                addBase([title]);
            }
        }

        const queries = [];
        const trustedPlatform = context.platformHint
            && CONFIDENCE_RANK[context.platformConfidence] >= CONFIDENCE_RANK.high;
        for (const base of bases) {
            if (trustedPlatform) queries.push(`${base} @${context.platformHint}`);
            queries.push(base);
        }
        return [...new Set(queries)].slice(0, Math.max(1, maxQueries));
    }

    function confidenceFromScore(score, exactEpisode) {
        if (score >= 92 && exactEpisode) return 'exact';
        if (score >= 75) return 'high';
        if (score >= 62) return 'medium';
        return 'low';
    }

    function validateApiMatches(matches, context, options = {}) {
        const queryIndex = Number.isInteger(options.queryIndex) ? options.queryIndex : 0;
        const targetEpisodeNumber = Number(context.episodeNumber || context.episode || 0) || null;
        const targetTitle = context.normalizedTitle || context.title || '';
        const targetYear = Number(context.year || 0) || null;
        const targetSeason = Number(context.season || 0) || null;
        const targetSeasonReliable = targetSeason
            && CONFIDENCE_RANK[context.seasonConfidence || 'unknown'] >= CONFIDENCE_RANK.medium;

        const analyzed = (Array.isArray(matches) ? matches : [])
            .filter(match => match && match.episodeId)
            .map((match, index) => {
                const episodeInfo = parseEpisodeIdentity(match.episodeTitle || '', { allowIndexFallback: false });
                const candidateYear = extractYear(`${match.animeTitle || ''} ${match.episodeTitle || ''}`);
                const candidateSeasonInfo = parseSeasonIdentity(`${match.animeTitle || ''} ${match.episodeTitle || ''}`);
                const titleSimilarity = getTitleSimilarity(targetTitle, match.animeTitle || '');
                const reasons = [];
                let rejected = false;
                let score = Math.max(0, 8 - queryIndex * 2 - index);

                if (targetEpisodeNumber && episodeInfo.episodeNumber) {
                    if (targetEpisodeNumber !== episodeInfo.episodeNumber) {
                        rejected = true;
                        reasons.push(`episode_mismatch:${episodeInfo.episodeNumber}`);
                    } else {
                        score += 42;
                        reasons.push('episode_exact');
                    }
                } else if (targetEpisodeNumber) {
                    score += 8;
                    reasons.push('episode_unverified');
                }

                if (titleSimilarity.mode === 'exact') score += 35;
                else if (titleSimilarity.mode === 'contains') score += 28;
                else if (titleSimilarity.score >= 0.72) score += 20;
                else if (match.animeTitle) {
                    rejected = true;
                    reasons.push('title_mismatch');
                }

                if (targetYear && candidateYear) {
                    if (targetYear !== candidateYear) {
                        rejected = true;
                        reasons.push(`year_mismatch:${candidateYear}`);
                    } else {
                        score += 10;
                        reasons.push('year_exact');
                    }
                }

                if (targetSeasonReliable && candidateSeasonInfo.season) {
                    if (targetSeason !== candidateSeasonInfo.season) {
                        rejected = true;
                        reasons.push(`season_mismatch:${candidateSeasonInfo.season}`);
                    } else {
                        score += 7;
                        reasons.push('season_exact');
                    }
                }

                const confidence = rejected
                    ? 'rejected'
                    : confidenceFromScore(score, Boolean(targetEpisodeNumber && episodeInfo.episodeNumber === targetEpisodeNumber));
                return {
                    match,
                    score,
                    confidence,
                    accepted: !rejected && CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK.medium,
                    reasons,
                    parsedEpisodeNumber: episodeInfo.episodeNumber,
                    episodeSource: episodeInfo.source,
                    titleSimilarity,
                    candidateYear,
                    candidateSeason: candidateSeasonInfo.season,
                };
            })
            .sort((a, b) => b.score - a.score);

        const selected = analyzed.find(item => item.accepted) || null;
        return {
            match: selected?.match || null,
            confidence: selected?.confidence || (analyzed.length ? 'rejected' : 'unknown'),
            score: selected?.score || 0,
            reason: selected ? selected.reasons.join(',') : (analyzed[0]?.reasons.join(',') || 'no_candidates'),
            analyzed,
        };
    }

    function resolveEpisodeFromList(episodes, context, options = {}) {
        const list = Array.isArray(episodes) ? episodes : [];
        const targetNumber = Number(context.episodeNumber || context.episode || 0) || null;
        const parsed = list.map((episode, index) => {
            const title = episode?.episodeTitle || episode?.title || episode?.name || '';
            return { episode, index, title, identity: parseEpisodeIdentity(title, { allowIndexFallback: false }) };
        });

        if (context.episodeIdentity?.dateIdentity) {
            const exactDate = parsed.find(item => item.identity.dateIdentity === context.episodeIdentity.dateIdentity);
            if (exactDate) return { ...exactDate, confidence: 'exact', reason: 'date_identity_exact' };
        }
        if (context.episodeIdentity?.specialType) {
            const exactSpecial = parsed.find(item => item.identity.specialType === context.episodeIdentity.specialType
                && item.identity.specialNumber === context.episodeIdentity.specialNumber
                && (context.episodeIdentity.specialNumber !== null
                    || item.identity.normalized === context.episodeIdentity.normalized));
            if (exactSpecial) return { ...exactSpecial, confidence: 'high', reason: 'special_identity_match' };
        }
        if (targetNumber) {
            const exact = parsed.find(item => item.identity.episodeNumber === targetNumber);
            if (exact) return { ...exact, confidence: 'exact', reason: 'episode_number_exact' };
            if (parsed.some(item => item.identity.episodeNumber !== null)) {
                return { episode: null, confidence: 'rejected', reason: 'explicit_episode_mismatch', parsed };
            }
        }

        const allowIndexFallback = options.allowIndexFallback !== false
            && context.episodeConfidence === 'low'
            && context.episodeIdentity?.usedIndexFallback
            && Number.isInteger(context.episodeIndex)
            && !context.episodeIdentity?.specialType
            && !context.episodeIdentity?.dateIdentity;
        if (allowIndexFallback && context.episodeIndex >= 0 && context.episodeIndex < list.length) {
            const item = parsed[context.episodeIndex];
            return { ...item, confidence: 'low', reason: 'index_fallback_no_episode_metadata' };
        }
        return { episode: null, confidence: 'rejected', reason: 'episode_unresolved', parsed };
    }

    function isSessionSourceCompatible(source, context) {
        if (!source || !context) return { compatible: false, reason: 'missing_source_or_context' };
        if (source.selectedBy !== 'manual' && CONFIDENCE_RANK[source.confidence || 'unknown'] < CONFIDENCE_RANK.medium) {
            return { compatible: false, reason: 'auto_source_confidence_too_low' };
        }
        const title = getTitleSimilarity(source.normalizedTitle || source.animeTitle || '', context.normalizedTitle || context.title || '');
        if (title.mode === 'different' || (title.mode === 'similar' && title.score < 0.85)) {
            return { compatible: false, reason: 'title_changed' };
        }
        if (source.year && context.year && Number(source.year) !== Number(context.year)) {
            return { compatible: false, reason: 'year_conflict' };
        }
        const sourceSeasonReliable = source.season
            && CONFIDENCE_RANK[source.seasonConfidence || 'unknown'] >= CONFIDENCE_RANK.medium;
        const contextSeasonReliable = context.season
            && CONFIDENCE_RANK[context.seasonConfidence || 'unknown'] >= CONFIDENCE_RANK.medium;
        if (sourceSeasonReliable && contextSeasonReliable && Number(source.season) !== Number(context.season)) {
            return { compatible: false, reason: 'season_conflict' };
        }
        if (Array.isArray(source.episodes) && source.episodes.length) {
            const resolved = resolveEpisodeFromList(source.episodes, context);
            if (!resolved.episode) return { compatible: false, reason: `episode_mapping_${resolved.reason}` };
        }
        return { compatible: true, reason: source.selectedBy === 'manual' ? 'manual_source_validated' : 'source_validated' };
    }

    function createSessionSource(info = {}, context = {}) {
        const selectedBy = info.selectedBy || 'auto';
        let confidence = typeof info.confidence === 'string' ? info.confidence : 'unknown';
        const score = Number(info.confidenceScore ?? info.score ?? info.confidence);
        if ((typeof info.confidence !== 'string' || CONFIDENCE_RANK[confidence] === undefined) && Number.isFinite(score)) {
            confidence = score >= 90 ? 'exact' : score >= 75 ? 'high' : score >= 60 ? 'medium' : 'low';
        }
        if (selectedBy === 'manual') confidence = 'exact';
        if (selectedBy !== 'manual' && !(CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK.medium)) return null;

        const episodes = Array.isArray(info.episodes) ? info.episodes : [];
        return {
            animeId: info.animeId,
            animeTitle: info.animeTitle || info.sourceName || '',
            sourceName: info.sourceName || info.animeTitle || '',
            selectedBy,
            confidence,
            confidenceScore: Number.isFinite(score) ? score : 0,
            normalizedTitle: context.normalizedTitle || '',
            baseTitle: context.baseTitle || context.normalizedTitle || '',
            year: context.year || null,
            season: context.season || null,
            seasonConfidence: context.seasonConfidence || 'unknown',
            episodes,
            episodeCount: episodes.length || Number(info.episodeCount || 0),
            updatedAt: Date.now(),
        };
    }

    root.LibertyDanmuMatchCore = Object.freeze({
        CONFIDENCE_RANK,
        normalizeNumberText,
        chineseNumberToInt,
        isNoiseOnly,
        parseEpisodeIdentity,
        parseSeasonIdentity,
        extractYear,
        normalizeTitle,
        normalizeComparableTitle,
        inferContentType,
        getTitleSimilarity,
        createPlaybackContext,
        buildMatchQueries,
        validateApiMatches,
        resolveEpisodeFromList,
        isSessionSourceCompatible,
        createSessionSource,
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
