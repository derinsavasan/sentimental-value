#!/usr/bin/env node
/**
 * One-time TMDB enrichment script.
 * Reads CSVs, fetches TMDB metadata, and writes enriched CSVs with extra columns:
 * TitleCanonical, ReleaseYear, Runtime, TMDBLanguage, TMDBPoster, TMDBGenres.
 *
 * Usage:
 *   TMDB_API_KEY=your_key_here node scripts/enrich_tmdb.js
 *
 * Notes:
 * - Uses a local JSON cache (.tmdb_cache.json) to avoid refetching.
 * - Automatically loops until all titles are enriched (no per-run cap).
 * - Uses a cache to avoid refetching; re-running will only fetch missing titles.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const fetch = require('node-fetch');

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const CACHE_FILE = path.join(__dirname, '.tmdb_cache.json');
const OMDB_API_KEY = '708ff10b'; // provided key for OMDB fallback
const INPUTS = [
  { in: path.join(__dirname, '..', 'data', 'NetflixMovies_added.csv'), out: path.join(__dirname, '..', 'data', 'NetflixMovies_enriched.csv'), type: 'movie' },
  { in: path.join(__dirname, '..', 'data', 'NetflixTV_added.csv'), out: path.join(__dirname, '..', 'data', 'NetflixTV_enriched.csv'), type: 'tv' }
];

if (!TMDB_API_KEY) {
  console.error('Missing TMDB_API_KEY env var. Example: TMDB_API_KEY=... node scripts/enrich_tmdb.js');
  process.exit(1);
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      return new Map(JSON.parse(raw));
    }
  } catch (e) {
    console.warn('Could not load cache:', e.message);
  }
  return new Map();
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify([...cache.entries()]), 'utf8');
  } catch (e) {
    console.warn('Could not save cache:', e.message);
  }
}

async function tmdbFetch(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  return res.json();
}

async function omdbFetch({ imdbId, title, year }) {
  if (!OMDB_API_KEY) return null;
  const params = new URLSearchParams({ apikey: OMDB_API_KEY });
  if (imdbId) params.set('i', imdbId);
  else if (title) params.set('t', title);
  if (year) params.set('y', year);
  const url = `https://www.omdbapi.com/?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.Response === 'False') return null;
  return {
    title: json.Title || '',
    year: (json.Year || '').slice(0, 4),
    language: json.Language || '',
    poster: json.Poster && json.Poster !== 'N/A' ? json.Poster : '',
    genres: json.Genre || ''
  };
}

async function fetchMeta(title, type, cache, imdbId = '', yearHint = '', langHint = '') {
  const key = `${type}:${title.trim().toLowerCase()}:${imdbId.trim().toLowerCase()}:${yearHint}:${langHint}`;
  const cached = cache.get(key);
  if (cached && cached.TMDBCountry) return cached;

  // Prefer direct IMDb lookup if available
  let best = null;
  let resolvedType = type;
  if (imdbId) {
    const findUrl = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?external_source=imdb_id&language=en-US&api_key=${TMDB_API_KEY}`;
    const found = await tmdbFetch(findUrl);
    const candidates = (found?.movie_results || []).concat(found?.tv_results || []);
    best = candidates[0];
    if (best) resolvedType = best.media_type || (found?.tv_results?.length ? 'tv' : 'movie');
  }

  // Fallback to title search
  if (!best) {
    const searchType = type === 'tv' ? 'tv' : 'movie';
    const params = new URLSearchParams({
      query: title,
      include_adult: 'false',
      language: 'en-US',
    });
    if (yearHint) {
      if (searchType === 'tv') params.set('first_air_date_year', yearHint);
      else params.set('year', yearHint);
    }
    const searchUrl = `https://api.themoviedb.org/3/search/${searchType}?${params.toString()}&api_key=${TMDB_API_KEY}`;
    const search = await tmdbFetch(searchUrl);
    best = search?.results?.[0];
    resolvedType = searchType;
  }

  if (!best) {
    cache.set(key, null);
    return null;
  }

  const detailUrl = `https://api.themoviedb.org/3/${resolvedType}/${best.id}?language=en-US&api_key=${TMDB_API_KEY}`;
  const detail = await tmdbFetch(detailUrl);
  const runtime = detail?.runtime || (detail?.episode_run_time ? detail.episode_run_time[0] : null);
  const releaseDate = detail?.release_date || detail?.first_air_date || best.release_date || best.first_air_date;
  const year = releaseDate ? releaseDate.slice(0, 4) : '';
  const country = detail?.production_countries?.[0]?.iso_3166_1 || detail?.origin_country?.[0] || '';
  let meta = {
    TitleCanonical: best.title || best.name || best.original_title || best.original_name || title,
    ReleaseYear: year,
    Runtime: runtime || '',
    TMDBLanguage: detail?.original_language || best.original_language || '',
    TMDBPoster: best.poster_path ? `https://image.tmdb.org/t/p/w500${best.poster_path}` : '',
    TMDBGenres: (detail?.genres || []).map(g => g.name).join('|'),
    TMDBCountry: country
  };

  // OMDB fallback for missing fields
  if (OMDB_API_KEY && (!meta.TMDBPoster || !meta.ReleaseYear || !meta.TMDBLanguage || !meta.TMDBGenres)) {
    // First try with IMDb id
    let omdb = await omdbFetch({ imdbId, title, year: year || yearHint });
    // If still missing poster/language, try title-only OMDB lookup
    if ((!omdb || (!omdb.poster && !omdb.language)) && title) {
      omdb = await omdbFetch({ title, year: year || yearHint });
    }
    if (omdb) {
      meta = {
        ...meta,
        TitleCanonical: meta.TitleCanonical || omdb.title || title,
        ReleaseYear: meta.ReleaseYear || omdb.year || '',
        TMDBLanguage: meta.TMDBLanguage || (omdb.language.split(',')[0] || '').trim(),
        TMDBPoster: meta.TMDBPoster || omdb.poster || '',
        TMDBGenres: meta.TMDBGenres || omdb.genres.replace(/, /g, '|') || '',
        TMDBCountry: meta.TMDBCountry || (omdb.country ? omdb.country.split(',')[0].trim() : '')
      };
    }
  }

  // If no country yet, try OMDB to fill country even if other fields are present
  if (!meta.TMDBCountry && OMDB_API_KEY) {
    const omdb = await omdbFetch({ imdbId, title, year: year || yearHint });
    if (omdb?.country) {
      meta.TMDBCountry = omdb.country.split(',')[0].trim();
    }
  }

  cache.set(key, meta);
  return meta;
}

async function enrichFile(inputPath, outputPath, type, cache) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });

  // Build list of unique titles to fetch
  const toFetch = [];
  rows.forEach(row => {
    const title = row.Title || row.primaryTitle || row.originalTitle || row.name || '';
    const imdbId = row.tconst || row['externals.imdb'] || '';
    const yearHint = (row['Release Date'] || row.startYear || row.premiered || '').toString().slice(0, 4);
    const langHint = row.language || row.Language || '';
    const key = `${type}:${title.trim().toLowerCase()}:${imdbId.trim().toLowerCase()}:${yearHint}:${langHint}`;
    if (title && !cache.has(key)) toFetch.push({ key, title, imdbId, yearHint, langHint });
  });

  let processed = 0;
  for (const item of toFetch) {
    await fetchMeta(item.title, type, cache, item.imdbId, item.yearHint, item.langHint);
    processed++;
    if (processed % 50 === 0) {
      saveCache(cache);
      console.log(`Fetched ${processed}/${toFetch.length} for ${path.basename(inputPath)}`);
    }
  }

  const enrichedRows = rows.map(row => {
    const title = row.Title || row.primaryTitle || row.originalTitle || row.name || '';
    const imdbId = row.tconst || row['externals.imdb'] || '';
    const yearHint = (row['Release Date'] || row.startYear || row.premiered || '').toString().slice(0, 4);
    const langHint = row.language || row.Language || '';
    const key = `${type}:${title.trim().toLowerCase()}:${imdbId.trim().toLowerCase()}:${yearHint}:${langHint}`;
    const meta = cache.get(key);
    const placeholderPoster = 'https://via.placeholder.com/500x750?text=No+Poster';
    const fallbackLanguage = langHint || 'Unknown';
    const fallbackGenres = (row.genres || '').replace(/, /g, '|') || 'Unknown';
    const fallbackCountry = row.country || row.Country || row.dvdCountry || '';
    return {
      ...row,
      TitleCanonical: meta?.TitleCanonical || row.Title || title,
      ReleaseYear: meta?.ReleaseYear || row.ReleaseYear || yearHint || 'Unknown',
      Runtime: meta?.Runtime || row.Runtime || row.runtimeMinutes || row.averageRuntime || row.runtime || '',
      TMDBLanguage: meta?.TMDBLanguage || row.TMDBLanguage || fallbackLanguage,
      TMDBPoster: meta?.TMDBPoster || row.TMDBPoster || placeholderPoster,
      TMDBGenres: meta?.TMDBGenres || row.TMDBGenres || fallbackGenres,
      TMDBCountry: meta?.TMDBCountry || row.TMDBCountry || fallbackCountry
    };
  });

  const output = stringify(enrichedRows, { header: true });
  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`Wrote enriched file: ${outputPath}`);
}

(async () => {
  const cache = loadCache();
  for (const f of INPUTS) {
    await enrichFile(f.in, f.out, f.type, cache);
    saveCache(cache);
  }
  saveCache(cache);
  console.log('Done. Re-run will only fetch any remaining uncached titles (should be none).');
})();
